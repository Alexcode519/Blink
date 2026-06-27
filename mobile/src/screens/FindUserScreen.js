import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import Svg, { Path, Line } from 'react-native-svg'
import { api } from '../api/client'

export default function FindUserScreen({ navigation }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleFind() {
    if (!username.trim()) return
    setLoading(true)
    try {
      const { username: found, publicKey } = await api.get(`/users/${username.trim()}`)
      navigation.navigate('Chat', { recipientUsername: found, recipientPublicKey: publicKey })
    } catch (err) {
      Alert.alert('Not found', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.title}>Blink</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Library')} style={styles.libraryBtn}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"
              stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            />
            <Line x1="16" y1="8" x2="2" y2="22" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
            <Line x1="17.5" y1="15" x2="9" y2="15" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
          </Svg>
          <Text style={styles.libraryLabel}>Library</Text>
        </TouchableOpacity>
      </View>
      <TextInput style={styles.input} placeholder="Enter username to chat" placeholderTextColor="#555"
        autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TouchableOpacity style={styles.button} onPress={handleFind} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Searching…' : 'Start Chat'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  topRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  title:       { fontSize: 28, fontWeight: '700', color: '#fff' },
  libraryBtn:  { alignItems: 'center', gap: 2 },
  libraryIcon: { fontSize: 22 },
  libraryLabel:{ color: '#888', fontSize: 11 },
  input:       { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:      { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
})
