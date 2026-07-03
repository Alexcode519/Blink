import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import { getActiveChat } from './activeChat'

async function ensureChannel() {
  await notifee.createChannel({
    id: 'blink_messages',
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
  })
}

// Notification ID per sender so opening a chat can cancel it
export function notifIdForSender(senderUsername) {
  return `chat_${senderUsername}`
}

export function notifIdForGroup(groupId) {
  return `group_${groupId}`
}

export async function displayMessageNotification(remoteMessage) {
  try {
    await ensureChannel()
    const data    = remoteMessage.data ?? {}
    const title   = data.title ?? 'Blink'
    const body    = data.body  ?? 'New message'
    const isGroup = data.type === 'new_group_message'
    const sender  = data.senderUsername ?? ''
    const groupId = data.groupId ?? ''

    // Only show foreground banners for actual chat messages — save/extend requests
    // are handled by in-chat polling modals, so a tappable banner would just confuse navigation
    const isChatMessage = data.type === 'new_group_message' || !!data.senderUsername
    if (!isChatMessage) return

    // Never notify for messages you sent yourself
    const myUsername = await AsyncStorage.getItem('username')
    if (sender && myUsername && sender === myUsername) return

    // Skip the popup if the user is already looking at that conversation
    const activeKey = isGroup ? `group:${groupId}` : sender
    if (activeKey && activeKey === getActiveChat()) return

    await notifee.displayNotification({
      id: isGroup ? notifIdForGroup(groupId) : notifIdForSender(sender),
      title,
      body,
      data,
      android: {
        channelId: 'blink_messages',
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
    })
  } catch (e) {
    console.warn('displayMessageNotification error:', e.message)
  }
}

export async function setupPushNotifications() {
  try {
    await ensureChannel()
    await notifee.requestPermission()
    const authStatus = await messaging().requestPermission()
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL

    if (!enabled) return

    const fcmToken = await messaging().getToken()
    if (fcmToken) {
      try { await api.post('/users/fcm-token', { fcmToken }) } catch (e) {
        console.warn('FCM save failed:', e.message)
      }
    }

    messaging().onTokenRefresh(async (t) => {
      try { await api.post('/users/fcm-token', { fcmToken: t }) } catch {}
    })

    // Foreground messages
    messaging().onMessage(async (remoteMessage) => {
      await displayMessageNotification(remoteMessage)
    })
  } catch (e) {
    console.warn('setupPushNotifications error:', e.message)
  }
}
