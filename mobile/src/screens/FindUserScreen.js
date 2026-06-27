import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
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
      <Text style={styles.title}>Find someone</Text>
      <TextInput style={styles.input} placeholder="Enter their username" placeholderTextColor="#555"
        autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TouchableOpacity style={styles.button} onPress={handleFind} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Searching…' : 'Start Chat'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  title:      { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 24 },
  input:      { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:     { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
})
