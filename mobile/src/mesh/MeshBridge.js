/**
 * Phase 4: Bridge mesh-relayed messages to the normal server route
 * when internet connectivity is restored.
 *
 * Queue entry schema (full form, for bridgeable entries):
 * {
 *   id, recipientKeyHash, ciphertext, nonce, contentType, addedAt, ttl,
 *   // Optional — set when I originated or received via mesh with full metadata:
 *   senderUsername, recipientUsername,
 *   mine: boolean  // true if I was the original sender
 * }
 */

import NetInfo from '@react-native-community/netinfo'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import { getQueue, dequeue } from './RelayQueue'
import { decryptFromSender, syncPublicKey } from '../crypto/keys'

let _unsubscribe = null
let _interval = null
let _onBridged = null

const AUTO_SYNC_MS = 30000 // sync every 30s when online and queue non-empty

// Call once at app startup.
export function startMeshBridge(onBridged) {
  _onBridged = onBridged

  // Sync immediately on connectivity restore
  _unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      bridgeNow().catch(() => {})
    }
  })

  // Also sync on a regular interval
  _interval = setInterval(async () => {
    const state = await NetInfo.fetch()
    if (!state.isConnected || !state.isInternetReachable) return
    const queue = await getQueue()
    if (!queue.length) return
    bridgeNow().catch(() => {})
  }, AUTO_SYNC_MS)
}

export function stopMeshBridge() {
  _unsubscribe?.()
  if (_interval) { clearInterval(_interval); _interval = null }
}

// Attempt to bridge all queued messages immediately (can be called manually too)
export async function bridgeNow() {
  const queue = await getQueue()
  if (!queue.length) return

  const myPk = await syncPublicKey()
  const myUsername = await AsyncStorage.getItem('username')
  if (!myUsername) return

  const toUpload = []
  const toDequeue = []

  for (const entry of queue) {
    if (!entry.senderUsername || !entry.recipientUsername) continue // test entries, skip
    toUpload.push({
      id:               entry.id,
      senderUsername:   entry.senderUsername,
      recipientUsername:entry.recipientUsername,
      ciphertext:       entry.ciphertext,
      nonce:            entry.nonce,
      contentType:      entry.contentType,
    })
  }

  if (!toUpload.length) return

  try {
    const { results } = await api.post('/messages/mesh-relay', { messages: toUpload })
    let bridged = 0
    for (const r of results) {
      if (r.ok) { await dequeue(r.id); bridged++ }
    }
    _onBridged?.(bridged, results.filter(r => !r.ok).length)
  } catch {}
}

// Enqueue a message for mesh relay — called by ChatScreen when send fails
export async function queueForMeshRelay({ id, senderUsername, recipientUsername, recipientPublicKey, ciphertext, nonce, contentType }) {
  const { enqueue } = require('./RelayQueue')
  // Use first 16 chars of recipient public key as hash (matches BleTestScreen)
  const recipientKeyHash = recipientPublicKey?.slice(0, 16) ?? recipientUsername
  await enqueue({ id, recipientKeyHash, ciphertext, nonce, contentType, senderUsername, recipientUsername })
}
