import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export function registerBackgroundHandler() {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    const data  = remoteMessage.data ?? {}
    const title = data.title ?? remoteMessage.notification?.title ?? 'Blink'
    const body  = data.body  ?? remoteMessage.notification?.body  ?? 'New message'

    // Never play a notification for a message you sent yourself
    const sender     = data.senderUsername ?? ''
    const myUsername = await AsyncStorage.getItem('username')
    if (sender && myUsername && sender.toLowerCase() === myUsername.toLowerCase()) return

    await notifee.createChannel({ id: 'blink_messages', name: 'Messages', importance: AndroidImportance.HIGH })
    await notifee.displayNotification({
      title,
      body,
      data,
      android: {
        channelId: 'blink_messages',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    })
  })
}
