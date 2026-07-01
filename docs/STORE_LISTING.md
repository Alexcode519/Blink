# Blink — Play Store Listing

## App name
Blink: Encrypted Messenger

## Short description (80 chars)
End-to-end encrypted messaging with offline Bluetooth mesh relay

## Full description (4000 chars)
Blink is a privacy-first messaging app built on true end-to-end encryption. Every message, photo, voice note and file you send is encrypted on your device before it leaves — Blink's servers never see your content, and neither does anyone else.

**End-to-end encrypted, always**
Your encryption keys are generated on your device and never uploaded anywhere. Messages are encrypted using NaCl (the gold standard in modern cryptography), the same technology trusted by security researchers worldwide.

**Verify your contacts**
Tap the shield icon in any conversation to see a unique Safety Number — a fingerprint of your contact's encryption key. Compare it in person to confirm your conversation is private and can't be intercepted.

**Disappearing messages**
Set a global timer to auto-delete all messages after 1, 5, 10, or 24 hours. Or long-press any message you sent and choose 🔥 Burn after to set a per-message countdown — the message vanishes from both sides when the timer runs out.

**View-once photos and videos**
Send a photo or video that can only be opened once. After the recipient views it, the content is wiped from our servers and can never be recovered. True view-once, not just hidden.

**Groups with full encryption**
Create encrypted group chats where every message is protected by a shared key that the server never sees. Group admins can add and remove members, and the group photo and name are customisable.

**Message requests**
You decide who can reach you. First messages from unknown contacts land in a requests inbox — approve or block with one tap.

**Offline mesh relay**
No internet? Blink can relay messages between nearby devices over Bluetooth. When a device with an internet connection comes within range, it bridges relayed messages back to the normal delivery path — useful in areas with limited connectivity.

**Panic wipe**
Set a secret duress pattern alongside your normal unlock. Drawing the duress pattern wipes locally cached chats instantly while unlocking the app normally — indistinguishable from a real unlock.

**Open design, no tracking**
Blink collects no analytics, no ad identifiers, and no behavioural data. The app has no ads and no third-party SDKs beyond push notifications (Firebase Cloud Messaging for delivery only).

## Category
Social / Communication

## Content rating
Everyone (no objectionable content)

## Privacy policy URL
https://blink-app.example.com/privacy  (replace with your actual URL)

---

# Privacy Policy (inline version for reference)

## Blink Privacy Policy

**What we collect:**
- Your username and password hash (bcrypt) — stored on our servers to authenticate you
- Your public encryption key — shared with contacts so they can encrypt messages for you
- Encrypted message ciphertext — stored temporarily until delivered, then deleted
- FCM token — used only to deliver push notifications

**What we never collect:**
- Message content (all content is encrypted before reaching our servers)
- Your contacts or address book
- Location data
- Device identifiers or advertising IDs
- Browsing history or behaviour

**Data retention:**
- Messages are deleted from our servers once delivered (or after your configured disappearing-messages window)
- View-once media ciphertext is wiped immediately after the recipient opens it
- You can delete your account at any time, which removes all stored data

**Third parties:**
- Google Firebase Cloud Messaging (FCM) — push notification delivery only
- No analytics, no advertising, no data brokers

**Contact:**
For privacy questions: [your email here]
