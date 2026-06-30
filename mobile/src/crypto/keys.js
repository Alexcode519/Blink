import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'
import * as Keychain from 'react-native-keychain'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEYCHAIN_SERVICE = 'blink_keypair'
const STORAGE_KEY = 'blink_private_key_backup'

export async function syncPublicKey() {
  const privateKey = await loadPrivateKey()
  const keyPair = nacl.box.keyPair.fromSecretKey(privateKey)
  return encodeBase64(keyPair.publicKey)
}

export async function generateAndStoreKeyPair() {
  const keyPair = nacl.box.keyPair()
  const privateKeyB64 = encodeBase64(keyPair.secretKey)
  const publicKeyB64 = encodeBase64(keyPair.publicKey)

  // Clear any existing key first — Keychain persists across reinstalls
  // which causes mismatches if server has a newer public key
  try { await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE }) } catch {}
  try {
    await Keychain.setGenericPassword('privateKey', privateKeyB64, { service: KEYCHAIN_SERVICE })
  } catch (e) {
    console.warn('Keychain store failed:', e.message)
  }
  await AsyncStorage.setItem(STORAGE_KEY, privateKeyB64)

  return { publicKey: publicKeyB64 }
}

async function loadPrivateKey() {
  // AsyncStorage is always written by generateAndStoreKeyPair — use it as source of truth
  const backup = await AsyncStorage.getItem(STORAGE_KEY)
  if (backup) return decodeBase64(backup)
  // Fall back to Keychain if AsyncStorage is empty
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE })
    if (creds && creds.password) return decodeBase64(creds.password)
  } catch (e) {
    console.warn('Keychain load failed:', e.message)
  }
  throw new Error('No private key found — re-register')
}

export async function encryptForRecipient(plaintext, recipientPublicKeyB64) {
  const privateKey = await loadPrivateKey()
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64)
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const encoded = Uint8Array.from(
    unescape(encodeURIComponent(plaintext)), c => c.charCodeAt(0)
  )
  const ciphertext = nacl.box(encoded, nonce, recipientPublicKey, privateKey)
  return { ciphertext: encodeBase64(ciphertext), nonce: encodeBase64(nonce) }
}

// ── Group key helpers ─────────────────────────────────────────────────────────
// Encrypt the 32-byte group secret key for a specific member using pairwise NaCl box.
export async function encryptGroupKey(groupKeyBytes, recipientPublicKeyB64) {
  const privateKey = await loadPrivateKey()
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64)
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const ciphertext = nacl.box(groupKeyBytes, nonce, recipientPublicKey, privateKey)
  return { encryptedGroupKey: encodeBase64(ciphertext), keyNonce: encodeBase64(nonce) }
}

// Decrypt the group key using the key-sender's public key and our private key.
export async function decryptGroupKey(encryptedGroupKeyB64, keyNonceB64, keySenderPublicKeyB64) {
  const privateKey = await loadPrivateKey()
  const senderPublicKey = decodeBase64(keySenderPublicKeyB64)
  const decrypted = nacl.box.open(
    decodeBase64(encryptedGroupKeyB64),
    decodeBase64(keyNonceB64),
    senderPublicKey,
    privateKey
  )
  if (!decrypted) throw new Error('Group key decryption failed')
  return decrypted  // raw Uint8Array (32 bytes)
}

// Encrypt a message payload with the shared group key (secretbox = symmetric).
export function encryptWithGroupKey(plaintext, groupKeyBytes) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const encoded = Uint8Array.from(unescape(encodeURIComponent(plaintext)), c => c.charCodeAt(0))
  const ciphertext = nacl.secretbox(encoded, nonce, groupKeyBytes)
  return { ciphertext: encodeBase64(ciphertext), nonce: encodeBase64(nonce) }
}

// Decrypt a group message with the shared group key.
export function decryptWithGroupKey(ciphertextB64, nonceB64, groupKeyBytes) {
  const decrypted = nacl.secretbox.open(
    decodeBase64(ciphertextB64),
    decodeBase64(nonceB64),
    groupKeyBytes
  )
  if (!decrypted) throw new Error('Group message decryption failed')
  const CHUNK = 4096
  let str = ''
  for (let i = 0; i < decrypted.length; i += CHUNK) {
    str += String.fromCharCode(...decrypted.subarray(i, i + CHUNK))
  }
  return decodeURIComponent(escape(str))
}

// ── Pairwise helpers ──────────────────────────────────────────────────────────
export async function decryptFromSender(ciphertextB64, nonceB64, senderPublicKeyB64) {
  const privateKey = await loadPrivateKey()
  const senderPublicKey = decodeBase64(senderPublicKeyB64)
  const decrypted = nacl.box.open(
    decodeBase64(ciphertextB64),
    decodeBase64(nonceB64),
    senderPublicKey,
    privateKey
  )
  if (!decrypted) throw new Error('Decryption failed — key mismatch')
  // Build string in chunks — spread operator hits max-arg limit on large payloads (e.g. voice notes)
  const CHUNK = 4096
  let str = ''
  for (let i = 0; i < decrypted.length; i += CHUNK) {
    str += String.fromCharCode(...decrypted.subarray(i, i + CHUNK))
  }
  return decodeURIComponent(escape(str))
}

// ── Safety number (key fingerprint) ────────────────────────────────────────
function compareBytes(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

// Deterministic regardless of which side computes it — both public keys are
// sorted before hashing so alex→sash and sash→alex produce the same number.
export function computeSafetyNumber(myPublicKeyB64, theirPublicKeyB64) {
  const a = decodeBase64(myPublicKeyB64)
  const b = decodeBase64(theirPublicKeyB64)
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a]
  const combined = new Uint8Array(first.length + second.length)
  combined.set(first, 0)
  combined.set(second, first.length)
  const digest = nacl.hash(combined) // 64-byte SHA-512

  let numeric = ''
  for (let i = 0; i < 12; i++) {
    const chunk = digest.slice(i * 5, i * 5 + 5)
    const value = chunk.reduce((acc, byte) => (acc * 256 + byte) % 100000, 0)
    numeric += value.toString().padStart(5, '0')
  }
  return numeric // 60 digits, grouped by 5 for display
}
