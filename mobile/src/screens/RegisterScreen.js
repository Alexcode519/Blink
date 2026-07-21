import React, { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Icon from 'react-native-vector-icons/Feather'
import { api, setToken } from '../api/client'
import { generateAndStoreKeyPair } from '../crypto/keys'

export default function RegisterScreen({ navigation, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister() {
    const u = username.trim()
    const p = password.trim()
    if (!u) return Alert.alert('Error', 'Please enter a username')
    if (u.length < 3) return Alert.alert('Error', 'Username must be at least 3 characters')
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return Alert.alert('Error', 'Username can only contain letters, numbers and underscores')
    if (!p) return Alert.alert('Error', 'Please enter a password')
    if (p.length < 8) return Alert.alert('Error', 'Password must be at least 8 characters')
    setLoading(true)
    try {
      const { publicKey } = await generateAndStoreKeyPair()
      const { token, username: user } = await api.post('/auth/register', {
        username: username.trim(),
        password,
        publicKey,
      })
      setToken(token)
      await AsyncStorage.setItem('username', user)
      onLogin()
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <View style={styles.logoCircle}>
          <Icon name="feather" size={36} color="#4f6ef7" />
        </View>
        <Text style={styles.title}>Blink</Text>
      </View>
      <Text style={styles.subtitle}>Create your account</Text>
      <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#555"
        autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#555"
        secureTextEntry value={password} onChangeText={setPassword} />
      <Text style={styles.hint}>Min. 8 characters. Username: letters, numbers, underscores only.</Text>
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
  container:  { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  logoWrap:   { alignItems: 'center', marginBottom: 8 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#4f6ef715', borderWidth: 1.5, borderColor: '#4f6ef740', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title:      { fontSize: 36, fontWeight: '700', color: '#fff', textAlign: 'center', letterSpacing: -0.5 },
  subtitle:   { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32 },
  input:      { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:     { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  hint:       { color: '#555', fontSize: 12, marginBottom: 16, marginTop: -4 },
  link:       { color: '#4f6ef7', textAlign: 'center', marginTop: 20, fontSize: 14 },
})
