import React, { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Icon from 'react-native-vector-icons/Feather'
import { api } from '../api/client'

export default function LoginScreen({ navigation, onLogin, isLocked }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => { if (u) setUsername(u) })
  }, [])

  async function handleLogin() {
    if (!username.trim() || !password.trim()) return
    setLoading(true)
    try {
      const { token, username: user } = await api.post('/auth/login', {
        username: username.trim(),
        password,
      })
      await AsyncStorage.setItem('token', token)
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
      <Text style={styles.subtitle}>{isLocked ? 'Enter your password to continue' : 'Welcome back'}</Text>
      <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#555"
        autoCapitalize="none" value={username} onChangeText={setUsername} />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#555"
        secureTextEntry value={password} onChangeText={setPassword} />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Logging in…' : 'Log In'}</Text>
      </TouchableOpacity>
      {!isLocked && (
        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  logoWrap:    { alignItems: 'center', marginBottom: 8 },
  logoCircle:  {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#4f6ef715',
    borderWidth: 1.5, borderColor: '#4f6ef740',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title:       { fontSize: 36, fontWeight: '700', color: '#fff', textAlign: 'center', letterSpacing: -0.5 },
  subtitle:    { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32 },
  input:       { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:      { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
  link:        { color: '#4f6ef7', textAlign: 'center', marginTop: 20, fontSize: 14 },
})
