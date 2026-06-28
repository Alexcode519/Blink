import React, { useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Svg, { Path, Line } from 'react-native-svg'
import { api } from '../api/client'

function FeatherIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="16" y1="8" x2="2" y2="22" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="17.5" y1="15" x2="9" y2="15" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

export default function ChatsScreen({ navigation }) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)

  useFocusEffect(useCallback(() => {
    api.get('/messages/conversations')
      .then(({ conversations: c }) => setConversations(c))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []))

  function renderItem({ item }) {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('Chat', {
          recipientUsername: item.other_username,
          recipientPublicKey: item.other_public_key,
        })}
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
        <Text style={styles.title}>Blink</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Library')} style={styles.iconBtn}>
          <FeatherIcon />
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
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  topRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  title:       { fontSize: 28, fontWeight: '700', color: '#fff' },
  iconBtn:     { padding: 4 },
  newChat:     { marginHorizontal: 16, marginVertical: 12, backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  newChatText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 14 },
  avatar:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarText:  { color: '#fff', fontSize: 18, fontWeight: '700' },
  username:    { color: '#fff', fontSize: 16, fontWeight: '500' },
  hint:        { color: '#555', textAlign: 'center', marginTop: 60, fontSize: 15 },
})
