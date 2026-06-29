import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import { api } from '../api/client'

async function ensureChannel() {
  await notifee.createChannel({
    id: 'blink_messages',
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
  })
}

// Notification ID per sender so opening a chat can cancel it
export function notifIdForSender(senderUsername) {
  return `chat_${senderUsername}`
}

export async function displayMessageNotification(remoteMessage) {
  try {
    await ensureChannel()
    const data   = remoteMessage.data ?? {}
    const title  = data.title ?? 'Blink'
    const body   = data.body  ?? 'New message'
    const sender = data.senderUsername ?? ''
    await notifee.displayNotification({
      id: notifIdForSender(sender),
      title,
      body,
      android: {
        channelId: 'blink_messages',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    })
  } catch (e) {
    console.warn('displayMessageNotification error:', e.message)
  }
}

export async function setupPushNotifications() {
  try {
    await ensureChannel()
    await notifee.requestPermission()
    const authStatus = await messaging().requestPermission()
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL

    if (!enabled) return

    const fcmToken = await messaging().getToken()
    if (fcmToken) {
      try { await api.post('/users/fcm-token', { fcmToken }) } catch (e) {
        console.warn('FCM save failed:', e.message)
      }
    }

    messaging().onTokenRefresh(async (t) => {
      try { await api.post('/users/fcm-token', { fcmToken: t }) } catch {}
    })

    // Foreground messages
    messaging().onMessage(async (remoteMessage) => {
      await displayMessageNotification(remoteMessage)
    })
  } catch (e) {
    console.warn('setupPushNotifications error:', e.message)
  }
}
