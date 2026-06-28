/**
 * @format
 */

import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';

// Handle FCM messages when app is in background or quit
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  const title = remoteMessage.notification?.title ?? 'Blink';
  const body  = remoteMessage.notification?.body  ?? 'New message';
  await notifee.createChannel({ id: 'blink_messages', name: 'Messages', importance: AndroidImportance.HIGH });
  await notifee.displayNotification({
    title,
    body,
    android: { channelId: 'blink_messages', importance: AndroidImportance.HIGH, pressAction: { id: 'default' } },
  });
});

AppRegistry.registerComponent(appName, () => App);
