import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../api/client'
import { generateAndStoreKeyPair } from '../crypto/keys'

export default function RegisterScreen({ navigation }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    if (!username.trim() || !password.trim()) return
    setLoading(true)
    try {
      const { publicKey } = await generateAndStoreKeyPair()
      const { token, username: user } = await api.post('/auth/register', {
        username: username.trim(),
        password,
        publicKey,
      })
      await AsyncStorage.setItem('token', token)
      await AsyncStorage.setItem('username', user)
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blink</Text>
      <Text style={styles.subtitle}>Create your account</Text>
      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating…' : 'Create Account'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Already have an account? Log in</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  title:     { fontSize: 36, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 4 },
  subtitle:  { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32 },
  input:     { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:    { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText:{ color: '#fff', fontWeight: '600', fontSize: 15 },
  link:      { color: '#4f6ef7', textAlign: 'center', marginTop: 20, fontSize: 14 },
})
