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
  try {
    await ensureChannel()

    await notifee.requestPermission()
    const authStatus = await messaging().requestPermission()
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL

    console.log('Push permission enabled:', enabled, 'status:', authStatus)
    if (!enabled) return

    const fcmToken = await messaging().getToken()
    console.log('FCM token:', fcmToken ? fcmToken.substring(0, 20) + '...' : 'NONE')
    if (fcmToken) {
      try {
        await api.post('/users/fcm-token', { fcmToken })
        console.log('FCM token saved to backend OK')
      } catch (e) {
        console.warn('FCM save failed:', e.message)
      }
    }

    messaging().onTokenRefresh(async (t) => {
      try { await api.post('/users/fcm-token', { fcmToken: t }) } catch {}
    })

    messaging().onMessage(async (remoteMessage) => {
      const title = remoteMessage.data?.title ?? remoteMessage.notification?.title ?? 'Blink'
      const body  = remoteMessage.data?.body  ?? remoteMessage.notification?.body  ?? 'New message'
      await notifee.displayNotification({
        title,
        body,
        android: { channelId: 'blink_messages', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } },
      })
    })
  } catch (e) {
    console.warn('setupPushNotifications error:', e.message)
  }
}
