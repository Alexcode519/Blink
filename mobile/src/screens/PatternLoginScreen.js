import React, { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import PatternLock from '../components/PatternLock'
import { authenticateWithBiometric } from '../utils/biometrics'

function hashPattern(sequence) {
  return sequence.join('-')
}

export default function PatternLoginScreen({ onSuccess, onFallback }) {
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)
  const [biometricEnabled, setBiometricEnabled] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('blink_biometric_enabled').then(val => {
      if (val === 'true') {
        setBiometricEnabled(true)
        triggerBiometric()
      }
    })
  }, [])

  async function triggerBiometric() {
    const success = await authenticateWithBiometric()
    if (success) onSuccess()
  }

  async function handlePattern(sequence) {
    const stored = await AsyncStorage.getItem('blink_pattern')
    if (!stored) { onFallback(); return }

    if (hashPattern(sequence) === stored) {
      setError('')
      onSuccess()
    } else {
      const next = attempts + 1
      setAttempts(next)
      if (next >= 5) {
        Alert.alert('Too many attempts', 'Please log in with your password.', [
          { text: 'OK', onPress: onFallback }
        ])
      } else {
        setError(`Incorrect pattern. ${5 - next} attempt${5 - next === 1 ? '' : 's'} left.`)
      }
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blink</Text>
      <Text style={styles.subtitle}>Draw your pattern to unlock</Text>

      <PatternLock onComplete={handlePattern} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {biometricEnabled && (
        <TouchableOpacity style={styles.biometricBtn} onPress={triggerBiometric}>
          <Text style={styles.biometricText}>Use Biometrics</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.fallback} onPress={onFallback}>
        <Text style={styles.fallbackText}>Use password instead</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:         { fontSize: 36, fontWeight: '700', color: '#fff', marginBottom: 6 },
  subtitle:      { fontSize: 15, color: '#666', marginBottom: 48 },
  error:         { color: '#ff4444', marginTop: 20, fontSize: 14 },
  biometricBtn:  { marginTop: 28, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 10, borderWidth: 1, borderColor: '#4f6ef7' },
  biometricText: { color: '#4f6ef7', fontSize: 15, fontWeight: '600' },
  fallback:      { marginTop: 20 },
  fallbackText:  { color: '#555', fontSize: 14 },
})
