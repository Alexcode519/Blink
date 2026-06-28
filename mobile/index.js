/**
 * @format
 */

import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import messaging from '@react-native-firebase/messaging';
import { displayMessageNotification } from './src/notifications/setup';

// Background/quit state data-only message handler
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  await displayMessageNotification(remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);
