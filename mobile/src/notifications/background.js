import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'

export function registerBackgroundHandler() {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const title = remoteMessage.data?.title ?? remoteMessage.notification?.title ?? 'Blink'
    const body  = remoteMessage.data?.body  ?? remoteMessage.notification?.body  ?? 'New message'
    await notifee.createChannel({ id: 'blink_messages', name: 'Messages', importance: AndroidImportance.HIGH })
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
