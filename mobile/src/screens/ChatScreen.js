import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform, Image, Modal, Pressable, PermissionsAndroid,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary, launchCamera } from 'react-native-image-picker'
import RNFS from 'react-native-fs'
import Video from 'react-native-video'
import { saveToLibrary } from '../library/storage'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'
import notifee from '@notifee/react-native'
import { notifIdForSender } from '../notifications/setup'

const POLL_INTERVAL = 3000
const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`

export default function ChatScreen({ route, navigation }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [myUsername, setMyUsername] = useState('')
  const [myAvatar, setMyAvatar] = useState(null)
  const [saveRequest, setSaveRequest] = useState(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const pendingSaves = useRef({})
  const listRef = useRef(null)
  const recipientPublicKeyRef = useRef(recipientPublicKey)

  const CACHE_KEY = `blink_chat_${recipientUsername}`

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => setMyUsername(u ?? ''))
    RNFS.exists(AVATAR_PATH).then(exists => {
      if (exists) setMyAvatar(`file://${AVATAR_PATH}?t=${Date.now()}`)
    })
    // Load local cache instantly, then fetch fresh from server
    AsyncStorage.getItem(CACHE_KEY).then(cached => {
      if (cached) {
        const msgs = JSON.parse(cached)
        setMessages(msgs)
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
      }
    }).catch(() => {})
    api.get(`/users/${recipientUsername}`)
      .then(({ publicKey }) => { if (publicKey) recipientPublicKeyRef.current = publicKey })
      .catch(() => {})
      .then(() => loadHistory())
      .finally(() => pollInbox())
    // Mark incoming messages as read and dismiss notification
    api.post(`/messages/read/${recipientUsername}`, {}).catch(() => {})
    notifee.cancelNotification(notifIdForSender(recipientUsername)).catch(() => {})
    const inboxTimer    = setInterval(pollInbox, POLL_INTERVAL)
    const senderTimer   = setInterval(pollSaveRequests, POLL_INTERVAL)
    const receiptTimer  = setInterval(pollReadReceipts, POLL_INTERVAL)
    return () => { clearInterval(inboxTimer); clearInterval(senderTimer); clearInterval(receiptTimer) }
  }, [])

  const pollReadReceipts = useCallback(async () => {
    try {
      const { readIds } = await api.get(`/messages/read-receipts/${recipientUsername}`)
      if (!readIds?.length) return
      const readSet = new Set(readIds)
      setMessages(prev => {
        const updated = prev.map(m =>
          m.mine && readSet.has(m.id) && m.status !== 'read'
            ? { ...m, status: 'read' }
            : m
        )
        const changed = updated.some((m, i) => m.status !== prev[i].status)
        return changed ? updated : prev
      })
    } catch {}
  }, [recipientUsername])

  const pollSaveRequests = useCallback(async () => {
    const entries = Object.entries(pendingSaves.current)
    if (!entries.length) return
    for (const [messageId, info] of entries) {
      try {
        const { status } = await api.get(`/messages/save-requests/${info.requestId}/status`)
        if (status === 'approved') {
          delete pendingSaves.current[messageId]
          await saveToDevice(info.payload, info.contentType, info.label)
        } else if (status === 'denied') {
          delete pendingSaves.current[messageId]
          Alert.alert('Save denied', 'The sender did not allow saving this file.')
        }
      } catch {}
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { requests } = await api.get('/messages/save-requests/pending')
        if (requests?.length && !saveRequest) setSaveRequest(requests[0])
      } catch {}
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [saveRequest])

  const saveMediaFile = useCallback(async (id, base64, ext) => {
    const path = `${RNFS.CachesDirectoryPath}/blink_media_${id}.${ext}`
    try {
      await RNFS.writeFile(path, base64, 'base64')
      return `file://${path}`
    } catch { return null }
  }, [])

  const saveCache = useCallback((msgs) => {
    // Images/video already converted to file:// paths — safe to store
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(msgs)).catch(() => {})
  }, [CACHE_KEY])

  const loadHistory = useCallback(async () => {
    try {
      const myUser = await AsyncStorage.getItem('username')
      const [{ messages: history }, receipts] = await Promise.all([
        api.get(`/messages/history/${recipientUsername}`),
        api.get(`/messages/read-receipts/${recipientUsername}`).catch(() => ({ readIds: [] })),
      ])
      if (!history.length) return
      const readSet = new Set(receipts?.readIds ?? [])
      const decoded = await Promise.all(history.map(async (m) => {
        // Postgres lowercases unquoted aliases: senderUsername → senderusername
        const sender = m.senderusername ?? m.senderUsername ?? m.sender_username ?? ''
        const isMine = sender === myUser
        if (isMine) {
          const cached = await AsyncStorage.getItem(`blink_sent_${m.id}`)
          const { payload, contentType, label } = cached
            ? JSON.parse(cached)
            : { payload: '[Sent]', contentType: m.content_type, label: null }
          const status = readSet.has(m.id) ? 'read' : 'delivered'
          return { id: m.id, from: sender, payload, contentType, label, mine: true, status }
        }
        try {
          let payload = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKeyRef.current)
          const ct = m.content_type
          if (ct === 'image' || ct === 'video') {
            const ext = ct === 'image' ? 'jpg' : 'mp4'
            const uri = await saveMediaFile(m.id, payload, ext)
            if (uri) payload = uri
          }
          return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered' }
        } catch {
          return { id: m.id, from: sender, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered' }
        }
      }))
      setMessages(prev => {
        // Keep any pending sent messages not yet in server history
        const historyIds = new Set(decoded.map(m => m.id))
        const pendingSent = prev.filter(m => m.mine && !historyIds.has(m.id))
        const merged = [...decoded, ...pendingSent]
        saveCache(merged)
        return merged
      })
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
    } catch {}
  }, [recipientUsername, saveCache])

  const pollInbox = useCallback(async () => {
    try {
      const { messages: incoming } = await api.get('/messages/inbox')
      if (!incoming.length) return
      // Mark them read since the screen is open
      api.post(`/messages/read/${recipientUsername}`, {}).catch(() => {})
      const decrypted = await Promise.all(
        incoming.map(async (m) => {
          const sender = m.senderusername ?? m.senderUsername ?? ''
          try {
            let payload = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKeyRef.current)
            const ct = m.content_type
            if (ct === 'image' || ct === 'video') {
              const ext = ct === 'image' ? 'jpg' : 'mp4'
              const uri = await saveMediaFile(m.id, payload, ext)
              if (uri) payload = uri
            }
            return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered' }
          } catch {
            return { id: m.id, from: sender, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered' }
          }
        })
      )
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const fresh = decrypted.filter(m => !existingIds.has(m.id))
        if (!fresh.length) return prev
        const next = [...prev, ...fresh]
        saveCache(next)
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        return next
      })
    } catch {}
  }, [recipientPublicKey])

  async function sendPayload(payload, contentType, label) {
    // Add a temporary message immediately so it appears without waiting for the server
    const tempId = `temp_${Date.now()}`
    let displayPayload = payload
    if (contentType === 'image' || contentType === 'video') {
      const ext = contentType === 'image' ? 'jpg' : 'mp4'
      const uri = await saveMediaFile(tempId, payload, ext)
      if (uri) displayPayload = uri
    }
    const tempMsg = { id: tempId, from: myUsername, payload: displayPayload, contentType, label, mine: true, status: 'sending' }
    setMessages(prev => [...prev, tempMsg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

    try {
      const { ciphertext, nonce } = await encryptForRecipient(payload, recipientPublicKeyRef.current)
      const { messageId } = await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType })
      const id = messageId ?? tempId

      // Rename local media file to final id
      if (contentType === 'image' || contentType === 'video') {
        const ext = contentType === 'image' ? 'jpg' : 'mp4'
        const finalUri = await saveMediaFile(id, payload, ext)
        if (finalUri) displayPayload = finalUri
      }

      AsyncStorage.setItem(`blink_sent_${id}`, JSON.stringify({ payload: displayPayload, contentType, label })).catch(() => {})

      // Replace temp message with confirmed one
      setMessages(prev => {
        const next = prev.map(m => m.id === tempId
          ? { ...m, id, payload: displayPayload, status: 'sent' }
          : m
        )
        saveCache(next)
        return next
      })
    } catch (err) {
      // Remove the temp message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId))
      Alert.alert('Error', err.message)
    }
  }

  async function sendText() {
    if (!text.trim()) return
    const msg = text.trim()
    setText('')  // clear immediately so it feels instant
    await sendPayload(msg, 'text')
  }

  async function takePhoto() {
    setShowAttachMenu(false)
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission denied', 'Camera permission is required to take photos.')
        return
      }
    }
    const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280, saveToPhotos: false })
    if (result.didCancel || !result.assets?.[0]) return
    // Brief pause so the app fully resumes before accessing Keychain
    await new Promise(r => setTimeout(r, 500))
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName ?? 'photo')
  }

  async function pickPhoto() {
    setShowAttachMenu(false)
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280 })
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName)
  }

  async function pickVideo() {
    setShowAttachMenu(false)
    const result = await launchImageLibrary({ mediaType: 'video', includeBase64: false })
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'video', asset.fileName ?? 'video')
  }

  async function pickDocument() {
    setShowAttachMenu(false)
    const result = await launchImageLibrary({ mediaType: 'mixed', includeBase64: false })
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    const contentType = asset.type?.startsWith('image/') ? 'image' : asset.type?.startsWith('video/') ? 'video' : 'document'
    await sendPayload(base64, contentType, asset.fileName ?? 'file')
  }

  async function requestSave(message) {
    if (message.contentType === 'text') return
    try {
      const { requestId } = await api.post(`/messages/${message.id}/save-request`, {})
      pendingSaves.current[message.id] = { requestId, payload: message.payload, contentType: message.contentType, label: message.label }
      Alert.alert('Save requested', 'Waiting for the sender to approve.')
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function saveToDevice(payload, contentType, label) {
    try {
      await saveToLibrary({ payload, contentType, label, fromUsername: recipientUsername })
      Alert.alert('Saved', 'Added to your Blink Library.')
    } catch (err) {
      Alert.alert('Save failed', err.message)
    }
  }

  function StatusTick({ status }) {
    if (status === 'sending')   return <Text style={styles.tick}>○</Text>
    if (status === 'sent')      return <Text style={styles.tick}>✓</Text>
    if (status === 'delivered') return <Text style={styles.tick}>✓✓</Text>
    if (status === 'read')      return <Text style={[styles.tick, styles.tickRead]}>✓✓</Text>
    return null
  }

  function renderBubble(item) {
    const isImage = item.contentType === 'image'
    const isVideo = item.contentType === 'video'
    const isDoc   = item.contentType === 'document'
    const canSave = !item.mine && (isImage || isVideo || isDoc)

    return (
      <View style={item.mine ? styles.mineOuter : styles.theirsOuter}>
        <View style={[styles.bubbleWrap, item.mine ? styles.mineWrap : styles.theirsWrap]}>
          {item.mine && (
            myAvatar
              ? <Image source={{ uri: myAvatar }} style={styles.avatarThumb} />
              : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{myUsername[0]?.toUpperCase()}</Text></View>
          )}
          <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
            {isImage && (
              <Image
                source={{ uri: item.payload.startsWith('file://') ? item.payload : `data:image/jpeg;base64,${item.payload}` }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
            )}
            {isVideo && (() => {
              const path = `${RNFS.CachesDirectoryPath}/vid_${item.id}.mp4`
              RNFS.writeFile(path, item.payload, 'base64').catch(() => {})
              return (
                <Video
                  source={{ uri: `file://${path}` }}
                  style={styles.videoPreview}
                  controls
                  resizeMode="cover"
                  paused
                />
              )
            })()}
            {isDoc && (
              <View style={styles.mediaChip}>
                <Text style={styles.mediaIcon}>📄</Text>
                <Text style={styles.mediaLabel}>{item.label ?? 'Document'}</Text>
              </View>
            )}
            {!isImage && !isVideo && !isDoc && (
              <Text style={styles.bubbleText}>{item.payload}</Text>
            )}
            {canSave && (
              <TouchableOpacity onPress={() => requestSave(item)}>
                <Text style={styles.saveBtn}>⬇ Save</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {item.mine && (
          <View style={styles.tickRow}>
            <StatusTick status={item.status} />
          </View>
        )}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{recipientUsername}</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => renderBubble(item)}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
      />

      <View style={styles.inputRow}>
        <TouchableOpacity onPress={() => setShowAttachMenu(true)} style={styles.iconBtn}>
          <Text style={styles.iconText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor="#555"
          onSubmitEditing={sendText}
          returnKeyType="send"
          multiline
        />
        <TouchableOpacity onPress={sendText} style={styles.sendBtn}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showAttachMenu} animationType="slide" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setShowAttachMenu(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>Send attachment</Text>
            <TouchableOpacity style={styles.menuItem} onPress={takePhoto}>
              <Text style={styles.menuIcon}>📷</Text>
              <Text style={styles.menuLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickPhoto}>
              <Text style={styles.menuIcon}>🖼️</Text>
              <Text style={styles.menuLabel}>Photo from gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickVideo}>
              <Text style={styles.menuIcon}>🎥</Text>
              <Text style={styles.menuLabel}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickDocument}>
              <Text style={styles.menuIcon}>📄</Text>
              <Text style={styles.menuLabel}>File</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCancel} onPress={() => setShowAttachMenu(false)}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {saveRequest && (
        <SaveRequestModal
          request={saveRequest}
          onDecide={async (decision) => {
            try { await api.patch(`/messages/save-requests/${saveRequest.id}`, { decision }) } catch {}
            setSaveRequest(null)
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0a' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  headerTitle:   { color: '#fff', fontSize: 17, fontWeight: '600' },
  backBtn:       { width: 36 },
  backText:      { color: '#4f6ef7', fontSize: 22 },
  mineOuter:        { alignItems: 'flex-end', marginBottom: 6 },
  theirsOuter:      { alignItems: 'flex-start', marginBottom: 6 },
  bubbleWrap:       { flexDirection: 'row', alignItems: 'flex-end' },
  mineWrap:         { justifyContent: 'flex-end' },
  theirsWrap:       { justifyContent: 'flex-start' },
  avatarThumb:      { width: 28, height: 28, borderRadius: 14, marginLeft: 6 },
  avatarPlaceholder:{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  avatarInitial:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  bubble:        { maxWidth: '75%', borderRadius: 16, padding: 10 },
  mine:          { backgroundColor: '#4f6ef7' },
  theirs:        { backgroundColor: '#1f1f1f' },
  bubbleText:    { color: '#fff', fontSize: 15, lineHeight: 20 },
  saveBtn:       { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 },
  tickRow:       { marginTop: 2, marginRight: 4, alignItems: 'flex-end' },
  tick:     { color: '#888', fontSize: 13 },
  tickRead: { color: '#4fc3f7', fontSize: 13 },
  imagePreview:  { width: 200, height: 200, borderRadius: 10 },
  videoPreview:  { width: 220, height: 160, borderRadius: 10 },
  mediaChip:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  mediaIcon:     { fontSize: 20 },
  mediaLabel:    { color: '#fff', fontSize: 14, flexShrink: 1 },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  iconBtn:       { padding: 8, paddingBottom: 10 },
  iconText:      { fontSize: 20 },
  input:         { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 8, maxHeight: 100 },
  sendBtn:       { paddingHorizontal: 8, paddingBottom: 10 },
  sendText:      { color: '#4f6ef7', fontWeight: '600', fontSize: 15 },
  menuOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  menuSheet:     { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  menuTitle:     { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  menuItem:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  menuIcon:      { fontSize: 24, width: 32 },
  menuLabel:     { color: '#fff', fontSize: 16 },
  menuCancel:    { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  menuCancelText:{ color: '#4f6ef7', fontSize: 16 },
})
