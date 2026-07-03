import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import { getActiveChat } from './activeChat'

// High-importance channel WITH sound — used by the background/killed handler
async function ensureChannel() {
  await notifee.createChannel({
    id: 'blink_messages',
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
  })
}

// Silent channel — heads-up popup but NO sound, used when the app is in foreground
async function ensureSilentChannel() {
  await notifee.createChannel({
    id: 'blink_messages_silent',
    name: 'Messages (in-app)',
    importance: AndroidImportance.DEFAULT,
    vibration: false,
    sound: 'null', // explicit null sound string silences the channel on most devices
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
    await ensureSilentChannel()
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

    // Only show notification if this device is the intended recipient
    const myUsername = await AsyncStorage.getItem('username')
    const intendedRecipient = data.recipientUsername ?? ''
    if (intendedRecipient && myUsername && intendedRecipient.toLowerCase() !== myUsername.toLowerCase()) return
    // Also suppress if sender is myself (belt-and-suspenders for group notifications)
    if (sender && myUsername && sender.toLowerCase() === myUsername.toLowerCase()) return

    // Skip the popup if the user is already looking at that conversation
    const activeKey = isGroup ? `group:${groupId}` : sender
    if (activeKey && activeKey === getActiveChat()) return

    await notifee.displayNotification({
      id: isGroup ? notifIdForGroup(groupId) : notifIdForSender(sender),
      title,
      body,
      data,
      android: {
        channelId: 'blink_messages_silent',
        importance: AndroidImportance.DEFAULT,
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
    await ensureSilentChannel()
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

    // Foreground messages — shown silently (sound plays only when app is backgrounded)
    messaging().onMessage(async (remoteMessage) => {
      await displayMessageNotification(remoteMessage)
    })
  } catch (e) {
    console.warn('setupPushNotifications error:', e.message)
  }
}
