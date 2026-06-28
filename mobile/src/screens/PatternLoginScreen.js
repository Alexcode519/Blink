import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import PatternLock from '../components/PatternLock'

function hashPattern(sequence) {
  return sequence.join('-')
}

export default function PatternLoginScreen({ onSuccess, onFallback }) {
  const [error, setError] = useState('')
  const [attempts, setAttempts] = useState(0)

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

      <TouchableOpacity style={styles.fallback} onPress={onFallback}>
        <Text style={styles.fallbackText}>Use password instead</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:        { fontSize: 36, fontWeight: '700', color: '#fff', marginBottom: 6 },
  subtitle:     { fontSize: 15, color: '#666', marginBottom: 48 },
  error:        { color: '#ff4444', marginTop: 20, fontSize: 14 },
  fallback:     { marginTop: 40 },
  fallbackText: { color: '#4f6ef7', fontSize: 14 },
})
