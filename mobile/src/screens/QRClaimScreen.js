import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import Icon from 'react-native-vector-icons/Feather'

export default function QRClaimScreen({ route, navigation }) {
  const token = route.params?.token
  const [status, setStatus] = useState('loading') // loading | success | error
  const [ownerUsername, setOwnerUsername] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Invalid invite link.'); return }
    claim()
  }, [token])

  async function claim() {
    setStatus('loading')
    try {
      const { ownerUsername: name, ownerPublicKey, claimerPublicKey } = await api.post('/invites/qr/claim', { token })
      setOwnerUsername(name)
      setStatus('success')
      // Inject the new contact into the conversations cache so ChatsScreen shows it immediately
      try {
        const cached = await AsyncStorage.getItem('blink_cache_conversations')
        const existing = cached ? JSON.parse(cached) : []
        if (!existing.some(c => c.other_username === name)) {
          existing.unshift({ other_username: name, other_public_key: ownerPublicKey, unread_count: 0, requested: false, last_at: new Date().toISOString() })
          await AsyncStorage.setItem('blink_cache_conversations', JSON.stringify(existing))
        }
      } catch {}
      // Clear any stale message cache for this chat
      await AsyncStorage.removeItem(`blink_chat_${name}`)
      // Reset stack to Chats → Chat so back button goes home, not back to the camera
      setTimeout(() => navigation.reset({
        index: 1,
        routes: [
          { name: 'Chats' },
          { name: 'Chat', params: { recipientUsername: name } },
        ],
      }), 1500)
    } catch (e) {
      setErrorMsg(e.message ?? 'This QR code is invalid, expired, or has already been used.')
      setStatus('error')
    }
  }

  function openChat() {
    navigation.reset({
      index: 1,
      routes: [
        { name: 'Chats' },
        { name: 'Chat', params: { recipientUsername: ownerUsername } },
      ],
    })
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.navigate('Chats')} style={styles.back}>
        <Icon name="arrow-left" size={22} color="#fff" />
      </TouchableOpacity>

      <View style={styles.body}>
        {status === 'loading' && (
          <>
            <ActivityIndicator color="#4f6ef7" size="large" />
            <Text style={styles.loadingText}>Verifying invite…</Text>
          </>
        )}

        {status === 'success' && (
          <>
            <View style={styles.successIcon}>
              <Icon name="check" size={40} color="#4f6ef7" />
            </View>
            <Text style={styles.title}>Verified!</Text>
            <Text style={styles.subtitle}>
              You and <Text style={styles.bold}>{ownerUsername}</Text> are now mutual verified contacts.
            </Text>
            <TouchableOpacity style={styles.chatBtn} onPress={openChat}>
              <Icon name="message-circle" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.chatBtnText}>Open chat with {ownerUsername}</Text>
            </TouchableOpacity>
          </>
        )}

        {status === 'error' && (
          <>
            <View style={styles.errorIcon}>
              <Icon name="x" size={40} color="#ff6b6b" />
            </View>
            <Text style={styles.title}>Invite failed</Text>
            <Text style={styles.subtitle}>{errorMsg}</Text>
            <TouchableOpacity style={styles.chatBtn} onPress={() => navigation.navigate('Chats')}>
              <Text style={styles.chatBtnText}>Go to chats</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a', padding: 24, paddingTop: 60 },
  back:        { position: 'absolute', top: 52, left: 20, padding: 8 },
  body:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#888', fontSize: 15, marginTop: 16 },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#4f6ef715', borderWidth: 2, borderColor: '#4f6ef740', alignItems: 'center', justifyContent: 'center' },
  errorIcon:   { width: 88, height: 88, borderRadius: 44, backgroundColor: '#ff6b6b15', borderWidth: 2, borderColor: '#ff6b6b40', alignItems: 'center', justifyContent: 'center' },
  title:       { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center' },
  subtitle:    { color: '#888', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  bold:        { color: '#fff', fontWeight: '700' },
  chatBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4f6ef7', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28, marginTop: 8 },
  chatBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
