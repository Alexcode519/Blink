import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'
import * as Keychain from 'react-native-keychain'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEYCHAIN_SERVICE = 'blink_keypair'
const STORAGE_KEY = 'blink_private_key_backup'

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
  // Try up to 3 times — camera/gallery activities can briefly suspend the JS context
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 300))
    try {
      const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE })
      if (creds && creds.password) return decodeBase64(creds.password)
    } catch (e) {
      console.warn('Keychain load failed (attempt', attempt + 1, '):', e.message)
    }
    const backup = await AsyncStorage.getItem(STORAGE_KEY)
    if (backup) return decodeBase64(backup)
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
  return decodeURIComponent(escape(String.fromCharCode(...decrypted)))
}
