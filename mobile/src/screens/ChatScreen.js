import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform, Image, Modal, Pressable, PermissionsAndroid,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import RNFS from 'react-native-fs'
import { CameraRoll } from '@react-native-camera-roll/camera-roll'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'

const POLL_INTERVAL = 3000

export default function ChatScreen({ route }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [myUsername, setMyUsername] = useState('')
  const [saveRequest, setSaveRequest] = useState(null)   // pending request shown to sender
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  // track pending save requests we sent, keyed by messageId → { requestId, payload, contentType, label }
  const pendingSaves = useRef({})

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => setMyUsername(u ?? ''))
    const inboxTimer  = setInterval(pollInbox, POLL_INTERVAL)
    const senderTimer = setInterval(pollSaveRequests, POLL_INTERVAL)
    pollInbox()
    return () => {
      clearInterval(inboxTimer)
      clearInterval(senderTimer)
    }
  }, [])

  // Receiver polls their outbox for messages they sent, checks save-request status
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

  // Sender polls for pending save requests from recipients
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { requests } = await api.get('/messages/save-requests/pending')
        if (requests?.length && !saveRequest) {
          setSaveRequest(requests[0])
        }
      } catch {}
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [saveRequest])

  const pollInbox = useCallback(async () => {
    try {
      const { messages: incoming } = await api.get('/messages/inbox')
      if (!incoming.length) return
      const decrypted = await Promise.all(
        incoming.map(async (m) => {
          try {
            const plaintext = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKey)
            return { id: m.id, from: m.senderUsername, payload: plaintext, contentType: m.content_type, mine: false }
          } catch {
            return { id: m.id, from: m.senderUsername, payload: '[Could not decrypt]', contentType: 'text', mine: false }
          }
        })
      )
      setMessages(prev => [...prev, ...decrypted])
    } catch {}
  }, [recipientPublicKey])

  async function sendPayload(payload, contentType, label) {
    try {
      const { ciphertext, nonce } = await encryptForRecipient(payload, recipientPublicKey)
      await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType })
      setMessages(prev => [...prev, {
        id: Date.now().toString(), from: myUsername,
        payload, contentType, label, mine: true,
      }])
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
    const contentType = asset.type?.startsWith('image/') ? 'image'
      : asset.type?.startsWith('video/') ? 'video'
      : 'document'
    await sendPayload(base64, contentType, asset.fileName ?? 'file')
  }

  async function requestSave(message) {
    if (message.contentType === 'text') return
    try {
      const { requestId } = await api.post(`/messages/${message.id}/save-request`, {})
      pendingSaves.current[message.id] = {
        requestId,
        payload: message.payload,
        contentType: message.contentType,
        label: message.label,
      }
      Alert.alert('Save requested', 'Waiting for the sender to approve.')
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function saveToDevice(payload, contentType, label) {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
        )
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission denied', 'Storage permission is required to save files.')
          return
        }
      }

      const ext = contentType === 'image' ? 'jpg' : contentType === 'video' ? 'mp4' : 'bin'
      const filename = label ?? `blink_${Date.now()}.${ext}`
      const destPath = `${RNFS.CachesDirectoryPath}/${filename}`
      await RNFS.writeFile(destPath, payload, 'base64')

      if (contentType === 'image' || contentType === 'video') {
        await CameraRoll.saveAsset(`file://${destPath}`, {
          type: contentType === 'image' ? 'photo' : 'video',
        })
        Alert.alert('Saved', `${contentType === 'image' ? 'Photo' : 'Video'} saved to your gallery.`)
      } else {
        const downloadsPath = `${RNFS.DownloadDirectoryPath}/${filename}`
        await RNFS.moveFile(destPath, downloadsPath)
        Alert.alert('Saved', `File saved to Downloads: ${filename}`)
      }
    } catch (err) {
      Alert.alert('Save failed', err.message)
    }
  }

  function renderBubble(item) {
    const isImage = item.contentType === 'image'
    const isVideo = item.contentType === 'video'
    const isDoc   = item.contentType === 'document'
    const canSave = !item.mine && (isImage || isVideo || isDoc)

    return (
      <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
        {isImage && (
          <Image
            source={{ uri: `data:image/jpeg;base64,${item.payload}` }}
            style={styles.imagePreview}
            resizeMode="cover"
          />
        )}
        {isVideo && (
          <View style={styles.mediaChip}>
            <Text style={styles.mediaIcon}>🎥</Text>
            <Text style={styles.mediaLabel}>{item.label ?? 'Video'}</Text>
          </View>
        )}
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
          <TouchableOpacity onPress={() => requestSave(item)} style={styles.saveRow}>
            <Text style={styles.saveBtn}>⬇ Request save</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{recipientUsername}</Text>

      <FlatList
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => renderBubble(item)}
        contentContainerStyle={{ padding: 16 }}
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
            try {
              await api.patch(`/messages/save-requests/${saveRequest.id}`, { decision })
            } catch {}
            setSaveRequest(null)
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0a' },
  header:        { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  bubble:        { maxWidth: '75%', borderRadius: 14, padding: 10, marginBottom: 8 },
  mine:          { backgroundColor: '#4f6ef7', alignSelf: 'flex-end' },
  theirs:        { backgroundColor: '#1f1f1f', alignSelf: 'flex-start' },
  bubbleText:    { color: '#fff', fontSize: 15 },
  saveRow:       { marginTop: 6 },
  saveBtn:       { color: '#aaa', fontSize: 12 },
  imagePreview:  { width: 200, height: 200, borderRadius: 10 },
  mediaChip:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  mediaIcon:     { fontSize: 20 },
  mediaLabel:    { color: '#fff', fontSize: 14, flexShrink: 1 },
  inputRow:      { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  iconBtn:       { padding: 8 },
  iconText:      { fontSize: 20 },
  input:         { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 8 },
  sendBtn:       { paddingHorizontal: 12 },
  sendText:      { color: '#4f6ef7', fontWeight: '600' },
  menuOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  menuSheet:     { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  menuTitle:     { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  menuItem:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  menuIcon:      { fontSize: 24, width: 32 },
  menuLabel:     { color: '#fff', fontSize: 16 },
  menuCancel:    { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  menuCancelText:{ color: '#4f6ef7', fontSize: 16 },
})
