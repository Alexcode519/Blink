import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const SLIDES = [
  {
    emoji: '🔒',
    title: 'End-to-end encrypted',
    body: 'Every message, photo and call is encrypted on your device before it leaves. Blink has no way to read your conversations — and neither does anyone else.',
  },
  {
    emoji: '🔑',
    title: 'Your keys, your messages',
    body: 'Your encryption keys are generated on your device and never leave it. If you reinstall, your old messages can\'t be recovered — that\'s the point.',
  },
  {
    emoji: '🛡️',
    title: 'Verify your contacts',
    body: 'Tap the shield icon in any chat to see a safety number. Compare it in person with your contact — if it matches, your conversation is private.',
  },
  {
    emoji: '📡',
    title: 'Works offline too',
    body: 'Blink can relay messages between nearby phones via Bluetooth when there\'s no internet — useful in areas with limited connectivity.',
  },
  {
    emoji: '🔥',
    title: 'Messages that disappear',
    body: 'Set messages to vanish after a timer, or long-press any message you sent to burn it after a specific time. View-once photos are gone after a single tap.',
  },
]

export default function OnboardingScreen({ navigation }) {
  const [page, setPage] = useState(0)

  async function finish() {
    await AsyncStorage.setItem('blink_onboarded', 'true')
    navigation.replace('Register')
  }

  const slide = SLIDES[page]
  const isLast = page === SLIDES.length - 1

  return (
    <View style={styles.container}>
      <View style={styles.slide}>
        <Text style={styles.emoji}>{slide.emoji}</Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.btnRow}>
        {page > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setPage(p => p - 1)}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, isLast && styles.finishBtn]}
          onPress={isLast ? finish : () => setPage(p => p + 1)}
        >
          <Text style={styles.nextText}>{isLast ? 'Get started' : 'Next →'}</Text>
        </TouchableOpacity>
      </View>

      {!isLast && (
        <TouchableOpacity style={styles.skipBtn} onPress={finish}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'space-between', padding: 32, paddingTop: 80 },
  slide:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emoji:      { fontSize: 72, marginBottom: 32 },
  title:      { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  body:       { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 26 },
  dots:       { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 32 },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  dotActive:  { backgroundColor: '#4f6ef7', width: 24 },
  btnRow:     { flexDirection: 'row', gap: 12, marginBottom: 16 },
  backBtn:    { flex: 1, borderWidth: 1, borderColor: '#333', borderRadius: 12, padding: 16, alignItems: 'center' },
  backText:   { color: '#888', fontWeight: '600', fontSize: 15 },
  nextBtn:    { flex: 2, backgroundColor: '#4f6ef7', borderRadius: 12, padding: 16, alignItems: 'center' },
  finishBtn:  { flex: 1 },
  nextText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  skipBtn:    { alignItems: 'center', marginBottom: 8 },
  skipText:   { color: '#444', fontSize: 14 },
})
