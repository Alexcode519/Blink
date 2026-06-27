import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'

const POLL_INTERVAL = 3000

export default function ChatScreen({ route }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [myUsername, setMyUsername] = useState('')
  const [saveRequest, setSaveRequest] = useState(null)

  useEffect(() => {
    // Prevent screenshots on Android
    if (Platform.OS === 'android') {
      try { require('react-native-flag-secure-android').activate() } catch {}
    }
    AsyncStorage.getItem('username').then(u => setMyUsername(u ?? ''))
    const interval = setInterval(pollInbox, POLL_INTERVAL)
    pollInbox()
    return () => {
      clearInterval(interval)
      if (Platform.OS === 'android') {
        try { require('react-native-flag-secure-android').deactivate() } catch {}
      }
    }
  }, [])

  const pollInbox = useCallback(async () => {
    try {
      const { messages: incoming } = await api.get('/messages/inbox')
      if (!incoming.length) return
      const decrypted = await Promise.all(
        incoming.map(async (m) => {
          try {
            const plaintext = await decryptFromSender(m.ciphertext, m.nonce, recipientPublicKey)
            return { id: m.id, from: m.senderUsername, text: plaintext, contentType: m.content_type, mine: false }
          } catch {
            return { id: m.id, from: m.senderUsername, text: '[Could not decrypt]', mine: false }
          }
        })
      )
      setMessages(prev => [...prev, ...decrypted])
    } catch {}
  }, [recipientPublicKey])

  async function sendText() {
    if (!text.trim()) return
    const { ciphertext, nonce } = await encryptForRecipient(text.trim(), recipientPublicKey)
    await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType: 'text' })
    setMessages(prev => [...prev, { id: Date.now().toString(), from: myUsername, text: text.trim(), mine: true }])
    setText('')
  }

  async function sendImage() {
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true })
    if (result.didCancel || !result.assets?.[0]?.base64) return
    const { ciphertext, nonce } = await encryptForRecipient(result.assets[0].base64, recipientPublicKey)
    await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType: 'image' })
    setMessages(prev => [...prev, { id: Date.now().toString(), from: myUsername, text: '[Image sent]', mine: true }])
  }

  async function requestSave(messageId) {
    const { requestId } = await api.post(`/messages/${messageId}/save-request`, {})
    Alert.alert('Save requested', 'Waiting for the sender to approve.')
    pollSaveDecision(requestId)
  }

  async function pollSaveDecision(requestId) {
    const timer = setInterval(async () => {
      try {
        const { status } = await api.get(`/messages/save-requests/${requestId}/status`)
        if (status === 'approved') {
          clearInterval(timer)
          Alert.alert('Approved', 'The sender allowed you to save this.')
        } else if (status === 'denied') {
          clearInterval(timer)
          Alert.alert('Denied', 'The sender did not allow saving.')
        }
      } catch {}
    }, POLL_INTERVAL)
  }

  function renderMessage({ item }) {
    return (
      <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
        <Text style={styles.bubbleText}>{item.text}</Text>
        {!item.mine && (
          <TouchableOpacity onPress={() => requestSave(item.id)}>
            <Text style={styles.saveBtn}>Request save</Text>
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
        renderItem={renderMessage}
        contentContainerStyle={{ padding: 16 }}
      />
      <View style={styles.inputRow}>
        <TouchableOpacity onPress={sendImage} style={styles.iconBtn}>
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
      {saveRequest && (
        <SaveRequestModal
          request={saveRequest}
          onDecide={async (decision) => {
            await api.patch(`/messages/save-requests/${saveRequest.id}`, { decision })
            setSaveRequest(null)
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0a0a0a' },
  header:     { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  bubble:     { maxWidth: '75%', borderRadius: 14, padding: 10, marginBottom: 8 },
  mine:       { backgroundColor: '#4f6ef7', alignSelf: 'flex-end' },
  theirs:     { backgroundColor: '#1f1f1f', alignSelf: 'flex-start' },
  bubbleText: { color: '#fff', fontSize: 15 },
  saveBtn:    { color: '#aaa', fontSize: 11, marginTop: 4 },
  inputRow:   { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  iconBtn:    { padding: 8 },
  iconText:   { fontSize: 20 },
  input:      { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 8 },
  sendBtn:    { paddingHorizontal: 12 },
  sendText:   { color: '#4f6ef7', fontWeight: '600' },
})
