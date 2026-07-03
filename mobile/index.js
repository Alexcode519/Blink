/**
 * @format
 */

import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import messaging from '@react-native-firebase/messaging';
import { displayBackgroundNotification } from './src/notifications/setup';

// Background/quit state data-only message handler — plays sound, checks recipient
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await displayBackgroundNotification(remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);
