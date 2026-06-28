import { cert, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccountPath = join(__dirname, '../firebase-service-account.json')

let messaging = null

try {
  let serviceAccount = null

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Prefer env var (used on Railway)
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  } else if (existsSync(serviceAccountPath)) {
    // Fallback to local file (used in dev)
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
  }

  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount) })
    messaging = getMessaging()
    console.log('Firebase Admin initialized')
  } else {
    console.warn('Firebase service account not found — push notifications disabled')
  }
} catch (err) {
  console.error('Firebase init error:', err.message)
}

export async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!messaging || !fcmToken) return
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: {
        priority: 'high',
        notification: { channelId: 'blink_messages', sound: 'default' },
      },
    })
  } catch (err) {
    console.error('FCM send error:', err.message)
  }
}
