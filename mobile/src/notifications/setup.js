import messaging from '@react-native-firebase/messaging'
import { Alert, Platform } from 'react-native'
import { api } from '../api/client'

export async function setupPushNotifications() {
  // Request permission (required on iOS and Android 13+)
  const authStatus = await messaging().requestPermission()
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL

  if (!enabled) {
    Alert.alert(
      'Notifications disabled',
      'Enable notifications in Settings to receive messages when the app is closed.',
    )
    return
  }

  // Get FCM token and register with backend
  const fcmToken = await messaging().getToken()
  if (fcmToken) {
    try { await api.post('/users/fcm-token', { fcmToken }) } catch {}
  }

  // Re-register if token rotates
  messaging().onTokenRefresh(async (newToken) => {
    try { await api.post('/users/fcm-token', { fcmToken: newToken }) } catch {}
  })

  // Foreground: show a system-style alert (in-app banner)
  messaging().onMessage(async (remoteMessage) => {
    const title = remoteMessage.notification?.title ?? remoteMessage.data?.title ?? 'Blink'
    const body  = remoteMessage.notification?.body  ?? remoteMessage.data?.body  ?? 'New message'
    Alert.alert(title, body)
  })
}
