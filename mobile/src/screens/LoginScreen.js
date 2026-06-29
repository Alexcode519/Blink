import React, { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Icon from 'react-native-vector-icons/Feather'
import { api } from '../api/client'
import { authenticateWithBiometric } from '../utils/biometrics'
import { generateAndStoreKeyPair } from '../crypto/keys'
import PatternLock from '../components/PatternLock'

export default function LoginScreen({ navigation, onLogin, isLocked }) {
  const [username, setUsername]         = useState('')
  const [password, setPassword]         = useState('')
  const [loading, setLoading]           = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [patternEnabled, setPatternEnabled]     = useState(false)
  const [patternAttempts, setPatternAttempts]   = useState(0)
  // mode: 'methods' | 'password' | 'pattern'  (only used when isLocked)
  const [mode, setMode] = useState('methods')

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => { if (u) setUsername(u) })

    if (isLocked) {
      Promise.all([
        AsyncStorage.getItem('blink_biometric_enabled'),
        AsyncStorage.getItem('blink_pattern_enabled'),
        AsyncStorage.getItem('blink_pattern'),
      ]).then(([bio, pat, patVal]) => {
        const bioOn = bio === 'true'
        const patOn = pat === 'true' && !!patVal
        setBiometricEnabled(bioOn)
        setPatternEnabled(patOn)
        // auto-prompt biometrics first if enabled
        if (bioOn) triggerBiometric()
      })
    }
  }, [])

  async function triggerBiometric() {
    const success = await authenticateWithBiometric()
    if (success) onLogin()
  }

  async function handlePattern(sequence) {
    const stored = await AsyncStorage.getItem('blink_pattern')
    if (!stored) { setMode('password'); return }
    if (sequence.join('-') === stored) {
      onLogin()
    } else {
      const next = patternAttempts + 1
      setPatternAttempts(next)
      if (next >= 5) {
        Alert.alert('Too many attempts', 'Please use your password.', [
          { text: 'OK', onPress: () => setMode('password') }
        ])
      } else {
        Alert.alert('Incorrect pattern', `${5 - next} attempt${5 - next === 1 ? '' : 's'} left.`)
      }
    }
  }

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
      // Always regenerate keys on login so local private key always matches server public key
      const { publicKey } = await generateAndStoreKeyPair()
      await api.patch('/users/me/public-key', { publicKey })
      onLogin()
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Fresh login (not locked) ──────────────────────────────────────
  if (!isLocked) {
    return (
      <View style={styles.container}>
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Icon name="feather" size={36} color="#4f6ef7" />
          </View>
          <Text style={styles.title}>Blink</Text>
        </View>
        <Text style={styles.subtitle}>Welcome back</Text>
        <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#555"
          autoCapitalize="none" value={username} onChangeText={setUsername} />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#555"
          secureTextEntry value={password} onChangeText={setPassword} />
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Logging in…' : 'Log In'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Locked: pattern mode ──────────────────────────────────────────
  if (mode === 'pattern') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Blink</Text>
        <Text style={styles.subtitle}>Draw your pattern to unlock</Text>
        <PatternLock onComplete={handlePattern} />
        <View style={styles.altRow}>
          {biometricEnabled && (
            <TouchableOpacity style={styles.altBtn} onPress={triggerBiometric}>
              <Text style={styles.altText}>Biometrics</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.altBtn} onPress={() => setMode('password')}>
            <Text style={styles.altText}>Password</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Locked: password mode ─────────────────────────────────────────
  if (mode === 'password') {
    return (
      <View style={styles.container}>
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Icon name="feather" size={36} color="#4f6ef7" />
          </View>
          <Text style={styles.title}>Blink</Text>
        </View>
        <Text style={styles.subtitle}>Enter your password to continue</Text>
        <TextInput style={styles.input} placeholder="Username" placeholderTextColor="#555"
          autoCapitalize="none" value={username} onChangeText={setUsername} />
        <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#555"
          secureTextEntry value={password} onChangeText={setPassword} />
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Logging in…' : 'Log In'}</Text>
        </TouchableOpacity>
        <View style={styles.altRow}>
          {biometricEnabled && (
            <TouchableOpacity style={styles.altBtn} onPress={triggerBiometric}>
              <Text style={styles.altText}>Biometrics</Text>
            </TouchableOpacity>
          )}
          {patternEnabled && (
            <TouchableOpacity style={styles.altBtn} onPress={() => setMode('pattern')}>
              <Text style={styles.altText}>Pattern</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  // ── Locked: methods chooser (default) ─────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <View style={styles.logoCircle}>
          <Icon name="feather" size={36} color="#4f6ef7" />
        </View>
        <Text style={styles.title}>Blink</Text>
      </View>
      <Text style={styles.subtitle}>Choose how to unlock</Text>

      {biometricEnabled && (
        <TouchableOpacity style={styles.methodBtn} onPress={triggerBiometric}>
          <Icon name="aperture" size={20} color="#4f6ef7" style={{ marginRight: 10 }} />
          <Text style={styles.methodText}>Use Biometrics</Text>
        </TouchableOpacity>
      )}
      {patternEnabled && (
        <TouchableOpacity style={styles.methodBtn} onPress={() => setMode('pattern')}>
          <Icon name="grid" size={20} color="#4f6ef7" style={{ marginRight: 10 }} />
          <Text style={styles.methodText}>Use Pattern</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.methodBtn} onPress={() => setMode('password')}>
        <Icon name="lock" size={20} color="#4f6ef7" style={{ marginRight: 10 }} />
        <Text style={styles.methodText}>Use Password</Text>
      </TouchableOpacity>
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
  title:       { fontSize: 36, fontWeight: '700', color: '#fff', textAlign: 'center', letterSpacing: -0.5, marginBottom: 6 },
  subtitle:    { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32 },
  input:       { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 15 },
  button:      { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
  link:        { color: '#4f6ef7', textAlign: 'center', marginTop: 20, fontSize: 14 },
  methodBtn:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#222', borderRadius: 12, padding: 16, marginBottom: 12 },
  methodText:  { color: '#fff', fontSize: 16, fontWeight: '500' },
  altRow:      { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 28 },
  altBtn:      { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  altText:     { color: '#888', fontSize: 14 },
})
