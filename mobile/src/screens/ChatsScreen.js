import React, { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Svg, { Path, Line, Circle } from 'react-native-svg'
import RNFS from 'react-native-fs'
import { api } from '../api/client'

const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`

function FeatherIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="16" y1="8" x2="2" y2="22" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="17.5" y1="15" x2="9" y2="15" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

function PersonIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke="#888" strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

export default function ChatsScreen({ navigation }) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [avatarUri, setAvatarUri] = useState(null)
  const isFocused = useRef(false)

  function loadConversations() {
    api.get('/messages/conversations')
      .then(({ conversations: c }) => setConversations(c))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useFocusEffect(useCallback(() => {
    isFocused.current = true
    loadConversations()
    RNFS.exists(AVATAR_PATH).then(exists => {
      if (exists) setAvatarUri(`file://${AVATAR_PATH}?t=${Date.now()}`)
      else setAvatarUri(null)
    })
    return () => { isFocused.current = false }
  }, []))

  useEffect(() => {
    const timer = setInterval(() => {
      if (isFocused.current) loadConversations()
    }, 3000)
    return () => clearInterval(timer)
  }, [])

  function deleteConversation(username) {
    Alert.alert('Delete chat', `Delete all messages with ${username}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/messages/conversation/${username}`)
            setConversations(prev => prev.filter(c => c.other_username !== username))
          } catch (err) {
            Alert.alert('Error', err.message)
          }
        }
      },
    ])
  }

  function renderItem({ item }) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('Chat', {
          recipientUsername: item.other_username,
          recipientPublicKey: item.other_public_key,
        })}
        onLongPress={() => deleteConversation(item.other_username)}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.other_username[0].toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>{item.other_username}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.navigate('Library')} style={styles.iconBtn}>
          <FeatherIcon />
        </TouchableOpacity>

        <Text style={styles.title}>Blink</Text>

        <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.iconBtn}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.profileThumb} />
          ) : (
            <PersonIcon />
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.newChat} onPress={() => navigation.navigate('FindUser')}>
        <Text style={styles.newChatText}>+ New conversation</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={styles.hint}>Loading…</Text>
      ) : conversations.length === 0 ? (
        <Text style={styles.hint}>No conversations yet — start one above</Text>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={i => i.other_user}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a' },
  topRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  title:        { fontSize: 28, fontWeight: '700', color: '#fff' },
  iconBtn:      { padding: 4 },
  profileThumb: { width: 28, height: 28, borderRadius: 14 },
  newChat:      { marginHorizontal: 16, marginVertical: 12, backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  newChatText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
  row:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 14 },
  avatar:       { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: '#fff', fontSize: 18, fontWeight: '700' },
  username:     { color: '#fff', fontSize: 16, fontWeight: '500' },
  hint:         { color: '#555', textAlign: 'center', marginTop: 60, fontSize: 15 },
})
