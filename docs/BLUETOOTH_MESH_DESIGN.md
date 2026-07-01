# Bluetooth Mesh Relay — Design Doc

## Goal

Let Blink deliver messages between nearby devices when neither has internet access — protest/disaster-resilience use case. Messages hop device-to-device over Bluetooth LE until they reach the recipient directly, or reach a device that regains internet and can bridge them to the normal server-backed flow.

## Why this is a different category of feature

Everything shipped so far in this app is a screen plus a couple of REST endpoints — buildable and testable same-day. This is not that. It needs:
- A native BLE module (JS alone can't do peer discovery or background advertising)
- A store-and-forward routing protocol with no central coordinator
- Reconciliation between mesh-delivered messages and the existing server-backed history
- New permission/battery/UX surface area on Android

Realistic estimate: multi-session build, not a one-shot. This doc exists so the next work session can pick up a concrete plan instead of re-deriving the architecture.

## Why the existing E2E model is actually a good fit

Messages are already opaque encrypted ciphertext blobs (`nacl.box` for 1:1, `nacl.secretbox` for groups) by the time they leave the sender's device. Mesh nodes relaying someone else's message never need to decrypt it — they just move bytes. The crypto model doesn't change; only the transport does.

## Architecture: epidemic (gossip) store-and-forward

No fixed routing tables, no need to know the shape of the mesh. Standard delay-tolerant-network approach:

1. **Discovery**: each device advertises a Blink-specific BLE service UUID while also scanning for it. Two Blink devices in range detect each other within seconds.
2. **Queue**: each device keeps a local relay queue — messages addressed to *other* people that this device is temporarily carrying. Each entry: `{ messageId, destinationPublicKeyHash, ciphertext, nonce, contentType, hopCount, createdAt }`.
3. **Sync on contact**: when two devices connect (GATT), they exchange a compact list of message IDs they're each holding (not the full payloads). Each device requests whatever IDs it doesn't already have. This naturally spreads messages across the mesh as devices move past each other.
4. **Delivery**: if a synced message's `destinationPublicKeyHash` matches the receiving device's own key, it's decrypted and dropped into the normal chat UI exactly like a server-delivered message — the rest of the app doesn't need to know it arrived over Bluetooth.
5. **Expiry**: `hopCount` and a TTL (e.g. 72h) bound how long a message keeps circulating, so the mesh doesn't grow unbounded.
6. **Bridging**: any device that regains internet connectivity acts as a gateway — it pushes everything in its relay queue to the real backend (so the recipient gets it the normal way if they're online elsewhere) and pulls down anything new for people it's still in mesh contact with.

## Native module choice

Android-only (matches current app scope) simplifies this a lot — iOS background BLE peripheral/advertising restrictions are a much bigger headache and aren't relevant here.

- **Scanning + GATT client**: [`react-native-ble-plx`](https://github.com/dotintent/react-native-ble-plx) — mature, actively maintained, handles connections/characteristics cleanly.
- **Peripheral advertising**: `react-native-ble-plx` doesn't do peripheral/advertiser mode. Need [`react-native-ble-advertiser`](https://github.com/mauricekraus/react-native-ble-advertiser) or a small custom native module wrapping Android's `BluetoothLeAdvertiser` directly — likely the latter, since advertiser libraries in this space are thin and inconsistently maintained. Budget time for writing this natively.
- Both need runtime permission handling for Android 12+ (`BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`) and `ACCESS_FINE_LOCATION` on pre-12 devices (BLE scan requires it at the OS level even though this app doesn't use location otherwise — worth a clear in-app explanation so it doesn't read as a privacy regression).

## Known constraints to design around up front

- **Range**: BLE is short-range (~10-30m realistically, less indoors). Mesh density matters — this is a crowd/protest tool, not a long-haul one.
- **Battery**: continuous BLE scan+advertise is a real drain. Needs a duty-cycled scan window (e.g. scan 5s every 30s) rather than always-on, with a clear user-facing toggle (default off) rather than silently running.
- **Background limits**: Android increasingly restricts background BLE for battery/privacy reasons (Doze mode, background execution limits). A foreground service with a persistent notification ("Blink mesh relay active") is likely required for this to work reliably when the app isn't in the foreground — that's a deliberate, visible tradeoff to design the UX around, not hide.
- **Metadata exposure**: advertising a Blink-specific service UUID makes "this person has Blink open" detectable to anyone scanning nearby. Worth deciding whether that's acceptable for the threat model (likely yes, since the alternative — no mesh at all — is worse for the offline use case) but it should be a documented, conscious tradeoff.
- **Message size**: BLE GATT MTU is small (typically ~20-512 bytes per write depending on negotiation). Large payloads (images/video) need chunking — probably **out of scope for v1**; ship text-only mesh relay first.

## Phased plan

- **Phase 0 — Spike**: prove `react-native-ble-plx` can discover + connect two real Android devices reliably in this environment. No app integration yet. This determines whether the rest of the plan is viable on the actual hardware available.
- **Phase 1 — Direct exchange**: two devices in range, no multi-hop. When in range, allow sending a text message directly over BLE if the recipient is the connected peer. Proves the crypto/transport integration without the routing complexity.
- **Phase 2 — Mesh relay**: add the local queue + gossip sync described above, so messages hop through intermediate devices.
- **Phase 3 — Bridge**: reconcile mesh-delivered messages with the server-backed history once connectivity returns; avoid duplicate display if a message arrives both via mesh and later via server sync.
- **Phase 4 — UX**: opt-in toggle (default off), foreground-service notification, "delivered via mesh" indicator on messages, permission onboarding copy that explains *why* location permission is requested.

## Phase 0 spike — findings (completed)

Ran a time-boxed spike against the real hardware available: a Samsung Galaxy Note 9 (Android 10, API 29, real BLE hardware) and a Pixel 8 emulator (API 34, virtual BLE).

**What was confirmed:**
- Note 9 has full BLE hardware support (`android.hardware.bluetooth_le` confirmed, Bluetooth fully on)
- Custom Kotlin native module (wrapping `BluetoothLeScanner` directly, no third-party library) **works** — 5 real nearby BLE devices discovered within 5 seconds of scan start, strongest at -50 dBm. Scan started clean, stopped clean, events fired correctly into React Native JS layer.
- Location permission flow works correctly on API 29 — runtime prompt appeared, user-granted, subsequent scans proceed without re-asking.
- The `react-native-ble-plx` 3.5 library path is blocked by the existing app's build environment (NDK 27 + CMake 3.22 incompatibility). Two distinct blockers hit in sequence:
  1. CMake 3.22's LTO test uses `-fuse-ld=gold` which NDK 27 removed → solved by installing CMake 3.31.6 and pinning it via `local.properties`
  2. ble-plx 3.5 generates a codegen JNI directory at build time that Gradle's autolinking cmake expects to already exist, creating a circular dependency that no task ordering resolved
- The emulator's virtual BLE (rootcanal) is isolated from real radio — a real device cannot detect emulator BLE advertisements, making the emulator useless as a BLE test partner

**What this means for next steps:**

Option A (recommended): Use `react-native-ble-plx` **2.x** (pre-New-Architecture). The 2.x branch does not have the codegen/cmake complexity, uses a standard JVM bridge, and is well-tested. Likely builds cleanly without any cmake changes.

Option B: Write a thin custom Kotlin native module wrapping Android's `BluetoothLeScanner` directly (~150 lines of Kotlin + JS bridge). No cmake, no codegen, full control. Most robust long-term.

Either way, actual two-device BLE discovery needs two real Android phones — the emulator cannot substitute.

## Recommended first step

Phase 0 validation with two real phones using either Option A or Option B above before committing to the full mesh routing implementation.
