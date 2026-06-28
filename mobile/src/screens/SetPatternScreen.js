import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import PatternLock from '../components/PatternLock'

export default function SetPatternScreen({ navigation }) {
  const [stage, setStage] = useState('draw')   // 'draw' | 'confirm'
  const [first, setFirst] = useState(null)
  const [hint, setHint] = useState('Draw a pattern (connect at least 4 dots)')

  async function handlePattern(sequence) {
    if (stage === 'draw') {
      setFirst(sequence)
      setStage('confirm')
      setHint('Draw the same pattern again to confirm')
    } else {
      if (sequence.join('-') === first.join('-')) {
        await AsyncStorage.setItem('blink_pattern', sequence.join('-'))
        await AsyncStorage.setItem('blink_pattern_enabled', 'true')
        Alert.alert('Pattern set', 'Pattern login is now enabled.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ])
      } else {
        setFirst(null)
        setStage('draw')
        setHint("Patterns didn't match. Try again.")
      }
    }
  }

  function handleCancel() {
    if (stage === 'confirm') {
      setFirst(null)
      setStage('draw')
      setHint('Draw a pattern (connect at least 4 dots)')
    } else {
      navigation.goBack()
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set Pattern</Text>
      <Text style={styles.subtitle}>{hint}</Text>

      <View style={styles.step}>
        <View style={[styles.stepDot, stage === 'draw' && styles.stepActive]} />
        <View style={styles.stepLine} />
        <View style={[styles.stepDot, stage === 'confirm' && styles.stepActive]} />
      </View>

      <PatternLock onComplete={handlePattern} color={stage === 'confirm' ? '#34c759' : '#4f6ef7'} />

      <TouchableOpacity style={styles.cancel} onPress={handleCancel}>
        <Text style={styles.cancelText}>{stage === 'confirm' ? '← Start over' : 'Cancel'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title:       { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 10 },
  subtitle:    { fontSize: 15, color: '#888', textAlign: 'center', marginBottom: 36 },
  step:        { flexDirection: 'row', alignItems: 'center', marginBottom: 40 },
  stepDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#333' },
  stepActive:  { backgroundColor: '#4f6ef7' },
  stepLine:    { width: 40, height: 2, backgroundColor: '#222', marginHorizontal: 6 },
  cancel:      { marginTop: 40 },
  cancelText:  { color: '#666', fontSize: 14 },
})
