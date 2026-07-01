/**
 * Gossip sync protocol over BLE GATT.
 *
 * Message types (all fit in ≤500 bytes — within our 512-byte MTU):
 *   {"t":"offer","ids":["id1","id2",...]}           — I have these queued
 *   {"t":"want","ids":["id1",...]}                   — send me these
 *   {"t":"msg","id":"...","to":"...","c":"...","n":"...","ct":"text","addedAt":0,"ttl":0}
 *
 * Flow (both sides run simultaneously — each is both server and central):
 *   A connects to B → A sends offer → B sends want + B sends its own offer
 *   A sends requested msgs → B delivers any addressed to B, relays rest
 */

import { NativeModules } from 'react-native'
import { getQueue, mergeEntries, dequeue } from './RelayQueue'

const { BleModule } = NativeModules
const MAX_PAYLOAD = 480 // leave headroom below 512-byte MTU

// Active session state per peer address
const sessions = {}

function safe(obj) {
  try { return JSON.stringify(obj) } catch { return null }
}

function parse(raw) {
  try { return JSON.parse(raw) } catch { return null }
}

async function write(address, obj) {
  const payload = safe(obj)
  if (!payload || payload.length > MAX_PAYLOAD) {
    console.warn(`[Mesh] Payload too large or invalid for ${address}: ${payload?.length}`)
    return false
  }
  try { await BleModule.writeGatt(address, payload); return true }
  catch (e) { console.warn(`[Mesh] write failed: ${e.message}`); return false }
}

// Called when we (central) have connected to a peer and discovered their service
export async function onPeerConnected(address, onProgress) {
  const queue = await getQueue()
  const ids = queue.map(e => e.id)
  const existing = sessions[address] ?? {}
  sessions[address] = { ...existing, queue, state: 'offered', onProgress }
  onProgress?.(`Sync: sending offer (${ids.length} msgs)`)
  await write(address, { t: 'offer', ids })

  // Send any pending want list that arrived via the server path before
  // our client connection was ready
  const pendingWant = existing.pendingWant
  if (pendingWant?.length) {
    onProgress?.(`Sending want for ${pendingWant.length} msgs (deferred)`)
    await write(address, { t: 'want', ids: pendingWant })
    sessions[address].pendingWant = null
  }
}

// Called when data arrives over GATT — both central and peripheral paths
export async function onData(address, rawData, myKeyHash, onProgress, onDelivered) {
  const msg = parse(rawData)
  if (!msg?.t) return

  const log = onProgress ?? ((s) => console.log(`[Mesh:${address.slice(-5)}] ${s}`))

  switch (msg.t) {
    case 'offer': {
      // Received a peer's offer list — figure out what we want
      const queue = await getQueue()
      const haveIds = new Set(queue.map(e => e.id))
      const want = (msg.ids ?? []).filter(id => !haveIds.has(id))
      log(`Peer has ${msg.ids?.length ?? 0} msgs, we want ${want.length}`)

      if (want.length) {
        // Try immediately — by the time we receive the peer's offer as their
        // client write to our server, our own client connection is typically ready
        const ok = await write(address, { t: 'want', ids: want })
        if (ok) {
          log(`Want sent (${want.length} msgs)`)
        } else {
          // Client not ready yet — defer to onPeerConnected
          sessions[address] = { ...sessions[address], pendingWant: want }
          log(`Want deferred (${want.length} msgs)`)
        }
      }

      // Send our own offer so peer can request from us
      const ourIds = queue.map(e => e.id)
      if (ourIds.length) await write(address, { t: 'offer', ids: ourIds })
      break
    }

    case 'want': {
      // Always read fresh — session.queue may be stale if msgs were added after connect
      const queue = await getQueue()
      const wanted = msg.ids ?? []
      log(`Peer wants ${wanted.length} msgs — sending...`)
      let sent = 0
      for (const id of wanted) {
        const entry = queue.find(e => e.id === id)
        if (!entry) { log(`${id.slice(0,8)} not found locally`); continue }
        const ok = await write(address, { t: 'msg', id: entry.id, to: entry.recipientKeyHash, c: entry.ciphertext, n: entry.nonce, ct: entry.contentType, addedAt: entry.addedAt, ttl: entry.ttl })
        if (ok) sent++
      }
      log(`Sent ${sent}/${wanted.length} msgs to peer`)
      break
    }

    case 'msg': {
      // Received a relayed message
      const { id, to, c, n, ct, addedAt, ttl } = msg
      if (!id || !to || !c || !n) break

      if (to === myKeyHash) {
        // This message is for ME — deliver to JS caller
        log(`📨 Received message for me! id=${id.slice(0, 8)}`)
        await dequeue(id) // remove from relay queue if we had it
        onDelivered?.({ id, ciphertext: c, nonce: n, contentType: ct })
      } else {
        // Relay it onwards — add to our queue
        const added = await mergeEntries([{ id, recipientKeyHash: to, ciphertext: c, nonce: n, contentType: ct, addedAt, ttl }])
        if (added) log(`Relaying msg ${id.slice(0, 8)} (not for me)`)
      }
      break
    }

    default:
      break
  }
}

export function clearSession(address) {
  delete sessions[address]
}
