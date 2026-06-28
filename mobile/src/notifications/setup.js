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

export async function setupPushNotifications() {
  await ensureChannel()

  // Request permission (required on iOS and Android 13+)
  await notifee.requestPermission()
  const authStatus = await messaging().requestPermission()
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL

  if (!enabled) return

  // Get FCM token and register with backend
  const fcmToken = await messaging().getToken()
  if (fcmToken) {
    try { await api.post('/users/fcm-token', { fcmToken }) } catch {}
  }

  // Re-register if token rotates
  messaging().onTokenRefresh(async (newToken) => {
    try { await api.post('/users/fcm-token', { fcmToken: newToken }) } catch {}
  })

  // Foreground: show a proper heads-up notification banner (data-only messages)
  messaging().onMessage(async (remoteMessage) => {
    const title = remoteMessage.data?.title ?? remoteMessage.notification?.title ?? 'Blink'
    const body  = remoteMessage.data?.body  ?? remoteMessage.notification?.body  ?? 'New message'
    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId: 'blink_messages',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    })
  })
}
