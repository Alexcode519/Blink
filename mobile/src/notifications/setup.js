import messaging from '@react-native-firebase/messaging'
import { Alert } from 'react-native'
import { api } from '../api/client'

export async function setupPushNotifications() {
  // Request permission (iOS requires this; Android 13+ requires it too)
  const authStatus = await messaging().requestPermission()
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL

  if (!enabled) return

  // Get the FCM token and register it with the backend
  const fcmToken = await messaging().getToken()
  if (fcmToken) {
    try {
      await api.post('/users/fcm-token', { fcmToken })
    } catch {}
  }

  // Refresh token if it changes
  messaging().onTokenRefresh(async (newToken) => {
    try { await api.post('/users/fcm-token', { fcmToken: newToken }) } catch {}
  })

  // Handle notification tapped while app was in background/quit
  messaging().onNotificationOpenedApp(remoteMessage => {
    console.log('Notification opened app:', remoteMessage)
  })

  // Handle foreground notifications (show an alert since app is open)
  messaging().onMessage(async remoteMessage => {
    const { title, body } = remoteMessage.notification ?? {}
    if (title) Alert.alert(title, body)
  })
}
