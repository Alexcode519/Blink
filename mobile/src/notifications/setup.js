import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import { getActiveChat } from './activeChat'

// Audible channel — used when the app is in background/killed
async function ensureChannel() {
  await notifee.createChannel({
    id: 'blink_messages',
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    vibration: true,
  })
}

// Truly silent channel (LOW = no sound, no vibration) — used when app is in foreground
async function ensureSilentChannel() {
  await notifee.createChannel({
    id: 'blink_messages_silent',
    name: 'Messages (in-app)',
    importance: AndroidImportance.LOW,
    vibration: false,
  })
}

// Returns true if this device should suppress this notification
async function shouldSuppress(data) {
  const myUsername        = await AsyncStorage.getItem('username')
  const intendedRecipient = (data.recipientUsername ?? '').toLowerCase()
  const sender            = (data.senderUsername ?? '').toLowerCase()
  const me                = (myUsername ?? '').toLowerCase()
  // If we know who this is for and it's not us → suppress
  if (intendedRecipient && me && intendedRecipient !== me) return true
  // Belt-and-suspenders: if sender is ourselves → suppress
  if (sender && me && sender === me) return true
  return false
}

// Notification ID per sender so opening a chat can cancel it
export function notifIdForSender(senderUsername) {
  return `chat_${senderUsername}`
}

export function notifIdForGroup(groupId) {
  return `group_${groupId}`
}

// Called from foreground onMessage — shows silently (app is already open)
export async function displayMessageNotification(remoteMessage) {
  try {
    await ensureSilentChannel()
    const data    = remoteMessage.data ?? {}
    const title   = data.title ?? 'Blink'
    const body    = data.body  ?? 'New message'
    const isGroup = data.type === 'new_group_message'
    const sender  = data.senderUsername ?? ''
    const groupId = data.groupId ?? ''

    const isChatMessage = data.type === 'new_group_message' || !!data.senderUsername
    if (!isChatMessage) return
    if (await shouldSuppress(data)) return

    // Skip if user is already looking at that conversation
    const activeKey = isGroup ? `group:${groupId}` : sender
    if (activeKey && activeKey === getActiveChat()) return

    await notifee.displayNotification({
      id: isGroup ? notifIdForGroup(groupId) : notifIdForSender(sender),
      title,
      body,
      data,
      android: {
        channelId: 'blink_messages_silent',
        importance: AndroidImportance.LOW,
        pressAction: { id: 'default' },
      },
    })
  } catch (e) {
    console.warn('displayMessageNotification error:', e.message)
  }
}

// Called from background/quit handler — shows with sound (app is not visible)
export async function displayBackgroundNotification(remoteMessage) {
  try {
    await ensureChannel()
    const data    = remoteMessage.data ?? {}
    const title   = data.title ?? remoteMessage.notification?.title ?? 'Blink'
    const body    = data.body  ?? remoteMessage.notification?.body  ?? 'New message'
    const isGroup = data.type === 'new_group_message'
    const sender  = data.senderUsername ?? ''
    const groupId = data.groupId ?? ''

    const isChatMessage = data.type === 'new_group_message' || !!data.senderUsername
    if (!isChatMessage) return
    if (await shouldSuppress(data)) return

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
    console.warn('displayBackgroundNotification error:', e.message)
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

    // Foreground messages — silent (app is already open)
    messaging().onMessage(async (remoteMessage) => {
      await displayMessageNotification(remoteMessage)
    })
  } catch (e) {
    console.warn('setupPushNotifications error:', e.message)
  }
}
