import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'
import * as Keychain from 'react-native-keychain'

const KEYCHAIN_SERVICE = 'blink_keypair'

export async function generateAndStoreKeyPair() {
  const keyPair = nacl.box.keyPair()
  await Keychain.setGenericPassword(
    'privateKey',
    encodeBase64(keyPair.secretKey),
    { service: KEYCHAIN_SERVICE }
  )
  return { publicKey: encodeBase64(keyPair.publicKey) }
}

async function loadPrivateKey() {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE })
  if (!creds) throw new Error('No private key found — re-register')
  return decodeBase64(creds.password)
}

export async function encryptForRecipient(plaintext, recipientPublicKeyB64) {
  const privateKey = await loadPrivateKey()
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64)
  const nonce = nacl.randomBytes(nacl.box.nonceLength)
  const ciphertext = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    recipientPublicKey,
    privateKey
  )
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
  if (!decrypted) throw new Error('Decryption failed')
  return new TextDecoder().decode(decrypted)
}
