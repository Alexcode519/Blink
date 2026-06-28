import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform, Image, Modal, Pressable,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import RNFS from 'react-native-fs'
import Video from 'react-native-video'
import { saveToLibrary } from '../library/storage'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'

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

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => setMyUsername(u ?? ''))
    RNFS.exists(AVATAR_PATH).then(exists => {
      if (exists) setMyAvatar(`file://${AVATAR_PATH}?t=${Date.now()}`)
    })
    // Fetch latest public key, then load history, then start polling
    api.get(`/users/${recipientUsername}`)
      .then(({ publicKey }) => { if (publicKey) recipientPublicKeyRef.current = publicKey })
      .catch(() => {})
      .then(() => loadHistory())
      .finally(() => pollInbox())
    const inboxTimer  = setInterval(pollInbox, POLL_INTERVAL)
    const senderTimer = setInterval(pollSaveRequests, POLL_INTERVAL)
    return () => { clearInterval(inboxTimer); clearInterval(senderTimer) }
  }, [])

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

  const loadHistory = useCallback(async () => {
    try {
      const { messages: history } = await api.get(`/messages/history/${recipientUsername}`)
      if (!history.length) return
      const decoded = await Promise.all(history.map(async (m) => {
        const isMine = m.senderUsername === (await AsyncStorage.getItem('username'))
        if (isMine) {
          const cached = await AsyncStorage.getItem(`blink_sent_${m.id}`)
          const { payload, contentType, label } = cached ? JSON.parse(cached) : { payload: '[Sent]', contentType: m.content_type, label: null }
          return { id: m.id, from: m.senderUsername, payload, contentType, label, mine: true, status: 'delivered' }
        }
        try {
          const plaintext = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKeyRef.current)
          return { id: m.id, from: m.senderUsername, payload: plaintext, contentType: m.content_type, mine: false, status: 'delivered' }
        } catch {
          return { id: m.id, from: m.senderUsername, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered' }
        }
      }))
      setMessages(decoded)
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
    } catch {}
  }, [recipientUsername])

  const pollInbox = useCallback(async () => {
    try {
      const { messages: incoming } = await api.get('/messages/inbox')
      if (!incoming.length) return
      const decrypted = await Promise.all(
        incoming.map(async (m) => {
          try {
            const plaintext = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKeyRef.current)
            return { id: m.id, from: m.senderUsername, payload: plaintext, contentType: m.content_type, mine: false, status: 'delivered' }
          } catch {
            return { id: m.id, from: m.senderUsername, payload: '[Could not decrypt]', contentType: 'text', mine: false, status: 'delivered' }
          }
        })
      )
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const fresh = decrypted.filter(m => !existingIds.has(m.id))
        if (!fresh.length) return prev
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        return [...prev, ...fresh]
      })
    } catch {}
  }, [recipientPublicKey])

  async function sendPayload(payload, contentType, label) {
    try {
      const { ciphertext, nonce } = await encryptForRecipient(payload, recipientPublicKeyRef.current)
      const { messageId } = await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType })
      const id = messageId ?? Date.now().toString()
      const msg = { id, from: myUsername, payload, contentType, label, mine: true, status: 'sent' }
      // Cache sent message locally so it survives re-open
      const cacheKey = `blink_sent_${id}`
      AsyncStorage.setItem(cacheKey, JSON.stringify({ payload, contentType, label }))
      setMessages(prev => [...prev, msg])
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function sendText() {
    if (!text.trim()) return
    await sendPayload(text.trim(), 'text')
    setText('')
  }

  async function pickPhoto() {
    setShowAttachMenu(false)
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.7 })
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
    if (status === 'sent') return <Text style={styles.tick}>✓</Text>
    if (status === 'delivered') return <Text style={[styles.tick, styles.tickDelivered]}>✓✓</Text>
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
              <Image source={{ uri: `data:image/jpeg;base64,${item.payload}` }} style={styles.imagePreview} resizeMode="cover" />
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
            <TouchableOpacity style={styles.menuItem} onPress={pickPhoto}>
              <Text style={styles.menuIcon}>🖼️</Text>
              <Text style={styles.menuLabel}>Photo</Text>
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
  tickRow:       { marginTop: 2, marginRight: 4 },
  tick:          { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  tickDelivered: { color: '#a0c4ff' },
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
