import { cert, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccountPath = join(__dirname, '../firebase-service-account.json')

let messaging = null

if (existsSync(serviceAccountPath)) {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
  initializeApp({ credential: cert(serviceAccount) })
  messaging = getMessaging()
  console.log('Firebase Admin initialized')
} else {
  console.warn('firebase-service-account.json not found — push notifications disabled')
}

export async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!messaging || !fcmToken) return
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      data,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'blink_messages' },
      },
    })
  } catch (err) {
    console.error('FCM send error:', err.message)
  }
}
