import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform, Image, Modal, Pressable, PermissionsAndroid,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary, launchCamera } from 'react-native-image-picker'
import { pickerGuard } from '../utils/pickerGuard'
import RNFS from 'react-native-fs'
import Video from 'react-native-video'
import { saveToLibrary } from '../library/storage'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'
import Icon from 'react-native-vector-icons/Feather'
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
  const [recipientAvatar, setRecipientAvatar] = useState(null)
  const [saveRequest, setSaveRequest] = useState(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [recipientStatus, setRecipientStatus] = useState(null) // { online, lastSeen, isTyping }
  const typingTimerRef = useRef(null)
  const pendingSaves = useRef({})
  const listRef  = useRef(null)
  const inputRef = useRef(null)
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
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: false })
          inputRef.current?.focus()
        }, 150)
      }
    }).catch(() => {})
    api.get(`/users/${recipientUsername}`)
      .then(({ publicKey, avatar }) => {
        if (publicKey) recipientPublicKeyRef.current = publicKey
        if (avatar) setRecipientAvatar(`data:image/jpeg;base64,${avatar}`)
      })
      .catch(() => {})
      .then(() => loadHistory())
      .finally(() => pollInbox())
    // Mark incoming messages as read and dismiss notification
    api.post(`/messages/read/${recipientUsername}`, {}).catch(() => {})
    notifee.cancelNotification(notifIdForSender(recipientUsername)).catch(() => {})
    const inboxTimer    = setInterval(pollInbox, POLL_INTERVAL)
    const senderTimer   = setInterval(pollSaveRequests, POLL_INTERVAL)
    const receiptTimer  = setInterval(pollReadReceipts, POLL_INTERVAL)
    const statusTimer   = setInterval(pollStatus, 2000)
    pollStatus()
    return () => {
      clearInterval(inboxTimer); clearInterval(senderTimer)
      clearInterval(receiptTimer); clearInterval(statusTimer)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    }
  }, [])

  const pollStatus = useCallback(async () => {
    try {
      const status = await api.get(`/users/status/${recipientUsername}`)
      setRecipientStatus(status)
    } catch {}
  }, [recipientUsername])

  function handleTyping(val) {
    setText(val)
    if (!val.trim()) return
    // Debounce: send typing event at most once every 2s
    if (typingTimerRef.current) return
    api.post(`/users/typing/${recipientUsername}`, {}).catch(() => {})
    typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null }, 2000)
  }

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
        const { status, expiresAt } = await api.get(`/messages/save-requests/${info.requestId}/status`)
        if (status === 'approved') {
          delete pendingSaves.current[messageId]
          await saveToDevice(info.payload, info.contentType, info.label, expiresAt)
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
          return { id: m.id, from: sender, payload, contentType, label, mine: true, status, createdAt: m.created_at }
        }
        try {
          let payload = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKeyRef.current)
          const ct = m.content_type
          if (ct === 'image' || ct === 'video') {
            const ext = ct === 'image' ? 'jpg' : 'mp4'
            const uri = await saveMediaFile(m.id, payload, ext)
            if (uri) payload = uri
          }
          return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered', createdAt: m.created_at }
        } catch {
          return { id: m.id, from: sender, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered', createdAt: m.created_at }
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
            return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered', createdAt: m.created_at }
          } catch {
            return { id: m.id, from: sender, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered', createdAt: m.created_at }
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
    const tempMsg = { id: tempId, from: myUsername, payload: displayPayload, contentType, label, mine: true, status: 'sending', createdAt: new Date().toISOString() }
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
    pickerGuard.start()
    const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280, saveToPhotos: false })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    // Brief pause so the app fully resumes before accessing Keychain
    await new Promise(r => setTimeout(r, 500))
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName ?? 'photo')
  }

  async function pickPhoto() {
    setShowAttachMenu(false)
    pickerGuard.start()
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280 })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName)
  }

  async function pickVideo() {
    setShowAttachMenu(false)
    pickerGuard.start()
    const result = await launchImageLibrary({ mediaType: 'video', includeBase64: false })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'video', asset.fileName ?? 'video')
  }

  async function pickDocument() {
    setShowAttachMenu(false)
    pickerGuard.start()
    const result = await launchImageLibrary({ mediaType: 'mixed', includeBase64: false })
    pickerGuard.end()
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

  async function saveToDevice(payload, contentType, label, expiresAt) {
    try {
      await saveToLibrary({ payload, contentType, label, fromUsername: recipientUsername, expiresAt: expiresAt ?? null })
      const msg = expiresAt
        ? `Added to your Blink Library. Expires ${new Date(expiresAt).toLocaleString()}.`
        : 'Added to your Blink Library.'
      Alert.alert('Saved', msg)
    } catch (err) {
      Alert.alert('Save failed', err.message)
    }
  }

  function formatLastSeen(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  }

  function formatTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (isToday) return time
    if (isYesterday) return `Yesterday ${time}`
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
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
          {!item.mine && (
            recipientAvatar
              ? <Image source={{ uri: recipientAvatar }} style={styles.avatarThumb} />
              : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{recipientUsername[0]?.toUpperCase()}</Text></View>
          )}
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
        <View style={[styles.tickRow, !item.mine && styles.tickRowTheirs]}>
          {!!item.createdAt && (
            <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
          )}
          {item.mine && <StatusTick status={item.status} />}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatarRow}>
            {recipientAvatar
              ? <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
              : <View style={styles.headerAvatarPlaceholder}><Text style={styles.headerAvatarInitial}>{recipientUsername[0]?.toUpperCase()}</Text></View>
            }
            <Text style={styles.headerTitle}>{recipientUsername}</Text>
          </View>
          {recipientStatus && (
            <Text style={[styles.headerStatus, recipientStatus.isTyping && styles.headerTyping]}>
              {recipientStatus.isTyping
                ? 'typing...'
                : recipientStatus.online
                  ? 'online'
                  : recipientStatus.lastSeen
                    ? `last seen ${formatLastSeen(recipientStatus.lastSeen)}`
                    : ''}
            </Text>
          )}
        </View>
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
          <Icon name="paperclip" size={22} color="#888" />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={handleTyping}
          placeholder="Message…"
          placeholderTextColor="#555"
          onSubmitEditing={sendText}
          returnKeyType="send"
          multiline
          autoFocus
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
              <View style={styles.menuIconWrap}><Icon name="camera" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickPhoto}>
              <View style={styles.menuIconWrap}><Icon name="image" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Photo from gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickVideo}>
              <View style={styles.menuIconWrap}><Icon name="video" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickDocument}>
              <View style={styles.menuIconWrap}><Icon name="file" size={20} color="#fff" /></View>
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
          onDecide={async (decision, expiresHours) => {
            try { await api.patch(`/messages/save-requests/${saveRequest.id}`, { decision, expiresHours }) } catch {}
            setSaveRequest(null)
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0a' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  headerCenter:        { alignItems: 'center', flex: 1 },
  headerAvatarRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar:        { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  headerAvatarInitial: { color: '#fff', fontSize: 13, fontWeight: '700' },
  headerTitle:         { color: '#fff', fontSize: 17, fontWeight: '600' },
  headerStatus:  { color: '#555', fontSize: 12, marginTop: 1 },
  headerTyping:  { color: '#4f6ef7' },
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
  bubble:        { maxWidth: '88%', borderRadius: 16, padding: 10 },
  mine:          { backgroundColor: '#4f6ef7' },
  theirs:        { backgroundColor: '#1f1f1f' },
  bubbleText:    { color: '#fff', fontSize: 15, lineHeight: 20 },
  saveBtn:       { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 },
  tickRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, marginRight: 4 },
  tickRowTheirs: { justifyContent: 'flex-start', marginLeft: 4 },
  timestamp:     { color: '#555', fontSize: 11 },
  tick:          { color: '#888', fontSize: 13 },
  tickRead:      { color: '#4fc3f7', fontSize: 13 },
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
  menuIconWrap:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  menuLabel:     { color: '#fff', fontSize: 16 },
  menuCancel:    { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  menuCancelText:{ color: '#4f6ef7', fontSize: 16 },
})
