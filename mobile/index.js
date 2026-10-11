/**
 * @format
 */

import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
const appName = "main";

console.log('INDEX: Starting registration...');

try {
  const messaging = require('@react-native-firebase/messaging').default;
  const { displayBackgroundNotification } = require('./src/notifications/setup');
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    await displayBackgroundNotification(remoteMessage);
  });
  console.log('INDEX: Firebase handler registered');
} catch (e) {
  console.warn('Firebase background handler skipped:', e.message);
}

console.log('INDEX: Registering component...');
AppRegistry.registerComponent(appName, () => App);
console.log('INDEX: Done');
