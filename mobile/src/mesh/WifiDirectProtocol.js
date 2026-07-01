/**
 * Wi-Fi Direct gossip relay — ~200m range, no MTU limit.
 * Runs the same offer/want/msg protocol as BLE but over a TCP socket.
 *
 * Flow:
 *  1. BLE discovers ★ Blink peer → connectToPeer(wifiAddress)
 *  2. Android negotiates group owner; both sides open TCP socket
 *  3. Both sides run gossip protocol via WifiP2pData events
 *  4. Disconnect when sync complete or on timeout
 */

import { NativeModules, NativeEventEmitter } from 'react-native'
import { getQueue, mergeEntries, dequeue } from './RelayQueue'

const { WifiDirectModule } = NativeModules
const emitter = WifiDirectModule ? new NativeEventEmitter(WifiDirectModule) : null

let _isReady = false
let _isServer = false
let _myKeyHash = ''
let _onProgress = null
let _onDelivered = null
let _subs = []

const MAX_PAYLOAD = 60000 // TCP has no MTU limit like BLE — generous cap

function log(msg) { _onProgress?.(msg); console.log('[WifiDirect]', msg) }

async function safe(obj) {
  try {
    const s = JSON.stringify(obj)
    return s.length <= MAX_PAYLOAD ? s : null
  } catch { return null }
}

async function send(obj) {
  const payload = await safe(obj)
  if (!payload) { log('Payload too large, skipping'); return false }
  try { await WifiDirectModule.sendData(payload); return true }
  catch (e) { log(`Send error: ${e.message}`); return false }
}

// ── Protocol handlers ─────────────────────────────────────────────────────

async function handleOffer(ids) {
  const queue = await getQueue()
  const haveIds = new Set(queue.map(e => e.id))
  const want = (ids ?? []).filter(id => !haveIds.has(id))
  log(`Peer has ${ids?.length ?? 0} msgs, we want ${want.length}`)
  if (want.length) await send({ t: 'want', ids: want })
  const ourIds = queue.map(e => e.id)
  if (ourIds.length) await send({ t: 'offer', ids: ourIds })
}

async function handleWant(ids) {
  const queue = await getQueue()
  log(`Peer wants ${ids.length} msgs`)
  let sent = 0
  for (const id of ids) {
    const entry = queue.find(e => e.id === id)
    if (!entry) continue
    const ok = await send({ t: 'msg', id: entry.id, to: entry.recipientKeyHash,
      c: entry.ciphertext, n: entry.nonce, ct: entry.contentType,
      addedAt: entry.addedAt, ttl: entry.ttl })
    if (ok) sent++
  }
  log(`Sent ${sent}/${ids.length} msgs`)
}

async function handleMsg(msg) {
  const { id, to, c, n, ct, addedAt, ttl } = msg
  if (!id || !to || !c || !n) return
  if (to === _myKeyHash) {
    log(`📨 Message for me: ${id.slice(0, 8)}`)
    await dequeue(id)
    _onDelivered?.({ id, ciphertext: c, nonce: n, contentType: ct })
  } else {
    const added = await mergeEntries([{ id, recipientKeyHash: to, ciphertext: c, nonce: n,
      contentType: ct, addedAt, ttl: ttl ?? 72 * 3600 * 1000 }])
    if (added) log(`Relaying msg ${id.slice(0, 8)} (not for me)`)
  }
}

async function onSocketReady(isServer) {
  _isReady = true
  _isServer = isServer
  log(`TCP socket ready (${isServer ? 'server/group-owner' : 'client'})`)
  // Both sides send their offer immediately
  const queue = await getQueue()
  const ids = queue.map(e => e.id)
  log(`Sending offer (${ids.length} msgs)`)
  await send({ t: 'offer', ids })
}

async function onData(rawData) {
  try {
    const msg = JSON.parse(rawData)
    switch (msg.t) {
      case 'offer': await handleOffer(msg.ids); break
      case 'want':  await handleWant(msg.ids ?? []); break
      case 'msg':   await handleMsg(msg); break
    }
  } catch (e) { log(`Parse error: ${e.message}`) }
}

// ── Public API ────────────────────────────────────────────────────────────

export function initWifiDirect(myKeyHash, onProgress, onDelivered) {
  if (!WifiDirectModule) return
  _myKeyHash   = myKeyHash
  _onProgress  = onProgress
  _onDelivered = onDelivered

  WifiDirectModule.setup()

  _subs = [
    emitter.addListener('WifiP2pInitialized',    () => log('Wi-Fi Direct ready')),
    emitter.addListener('WifiP2pDiscoveryStarted',() => log('Peer discovery started (~200m range)')),
    emitter.addListener('WifiP2pPeersChanged',   e  => {
      const peers = e.peers ?? []
      log(`Wi-Fi Direct peers nearby: ${peers.length}`)
      // Emit for BleTestScreen to show — caller can connect to any of these
      onProgress?.(`wifi_peers:${JSON.stringify(peers)}`)
    }),
    emitter.addListener('WifiP2pConnected',      e  => log(`Connected (${e.isGroupOwner ? 'owner' : 'client'})`)),
    emitter.addListener('WifiP2pSocketReady',    e  => onSocketReady(e.isServer)),
    emitter.addListener('WifiP2pData',           e  => onData(e.data)),
    emitter.addListener('WifiP2pDisconnected',   () => { _isReady = false; log('Disconnected') }),
    emitter.addListener('WifiP2pError',          e  => log(`Error: ${e.error}`)),
  ]
}

export function startWifiDirectDiscovery() { WifiDirectModule?.startDiscovery() }
export function stopWifiDirectDiscovery()  { WifiDirectModule?.stopDiscovery() }

export function connectWifiPeer(deviceAddress) {
  log(`Connecting to Wi-Fi peer: ${deviceAddress}`)
  WifiDirectModule?.connectToPeer(deviceAddress)
}

export function disconnectWifi() {
  _isReady = false
  WifiDirectModule?.disconnect()
}

export function destroyWifiDirect() {
  _subs.forEach(s => s.remove())
  _subs = []
  WifiDirectModule?.destroy()
}

export function isWifiDirectReady() { return _isReady }
