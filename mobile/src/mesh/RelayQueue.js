import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'blink_relay_queue'
const DEFAULT_TTL_MS = 72 * 60 * 60 * 1000 // 72 hours

// Add a message to the relay queue (idempotent — deduped by id)
export async function enqueue({ id, recipientKeyHash, ciphertext, nonce, contentType }) {
  const queue = await getQueue()
  if (queue.find(e => e.id === id)) return
  queue.push({ id, recipientKeyHash, ciphertext, nonce, contentType, addedAt: Date.now(), ttl: DEFAULT_TTL_MS })
  await AsyncStorage.setItem(KEY, JSON.stringify(queue))
}

// Get all non-expired queue entries
export async function getQueue() {
  const raw = await AsyncStorage.getItem(KEY)
  const all = raw ? JSON.parse(raw) : []
  const now = Date.now()
  const valid = all.filter(e => e.addedAt + e.ttl > now)
  if (valid.length !== all.length) await AsyncStorage.setItem(KEY, JSON.stringify(valid))
  return valid
}

// Remove a successfully delivered entry
export async function dequeue(id) {
  const queue = await getQueue()
  await AsyncStorage.setItem(KEY, JSON.stringify(queue.filter(e => e.id !== id)))
}

// Merge incoming entries from a peer (ignoring ones we already have)
export async function mergeEntries(entries) {
  const queue = await getQueue()
  const existing = new Set(queue.map(e => e.id))
  const fresh = entries.filter(e => !existing.has(e.id) && e.addedAt + e.ttl > Date.now())
  if (!fresh.length) return 0
  await AsyncStorage.setItem(KEY, JSON.stringify([...queue, ...fresh]))
  return fresh.length
}
