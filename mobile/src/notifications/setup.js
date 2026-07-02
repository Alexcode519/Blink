import messaging from '@react-native-firebase/messaging'
import notifee, { AndroidImportance } from '@notifee/react-native'
import { api } from '../api/client'
import { getActiveChat } from './activeChat'
import { decryptFromSender } from '../crypto/keys'
import AsyncStorage from '@react-native-async-storage/async-storage'
import RNFS from 'react-native-fs'

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

// Pre-decrypt a view-once media message in the background so ChatScreen finds it ready.
async function prefetchViewOnce(messageId, senderUsername, contentType) {
  try {
    const existing = await AsyncStorage.getItem(`blink_vo_${messageId}`)
    if (existing) return // already cached
    const { ciphertext, nonce } = await api.get(`/messages/${messageId}/ciphertext`)
    // Need sender's public key to decrypt
    const { publicKey } = await api.get(`/users/${senderUsername}`)
    const decoded = await decryptFromSender(ciphertext, nonce, publicKey)
    const ext = contentType === 'image' ? 'jpg' : 'mp4'
    const path = `${RNFS.CachesDirectoryPath}/blink_media_${messageId}.${ext}`
    await RNFS.writeFile(path, decoded, 'base64')
    await AsyncStorage.setItem(`blink_vo_${messageId}`, `file://${path}`)
  } catch (e) {
    // Silent — ChatScreen will fall back to decrypting on open
  }
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

    // Pre-decrypt view-once media in background so it's ready when user opens chat
    if (data.viewOnce === 'true' && data.messageId && (data.contentType === 'image' || data.contentType === 'video') && sender) {
      prefetchViewOnce(data.messageId, sender, data.contentType).catch(() => {})
    }

    // Only show foreground banners for actual chat messages — save/extend requests
    // are handled by in-chat polling modals, so a tappable banner would just confuse navigation
    const isChatMessage = data.type === 'new_group_message' || !!data.senderUsername
    if (!isChatMessage) return

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
