import React, { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import QRCode from 'react-native-qrcode-svg'
import { api } from '../api/client'
import Icon from 'react-native-vector-icons/Feather'

export default function QRInviteScreen({ navigation }) {
  const [token, setToken]       = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(null)

  const tokenRef = useRef(null)

  async function generate() {
    setLoading(true)
    setToken(null)
    tokenRef.current = null
    try {
      const { token: t, expiresAt: exp } = await api.post('/invites/qr', {})
      setToken(t)
      tokenRef.current = t
      setExpiresAt(new Date(exp))
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { generate() }, [])

  // Poll for claim so the owner is auto-navigated when someone scans their QR
  useEffect(() => {
    const id = setInterval(async () => {
      const t = tokenRef.current
      if (!t) return
      try {
        const { claimed, claimerUsername } = await api.get(`/invites/qr/${t}/status`)
        if (claimed && claimerUsername) {
          clearInterval(id)
          await AsyncStorage.removeItem(`blink_chat_${claimerUsername}`)
          navigation.replace('Chat', { recipientUsername: claimerUsername })
        }
      } catch {}
    }, 3000)
    return () => clearInterval(id)
  }, [])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const secs = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
      setSecondsLeft(secs)
      if (secs === 0) setToken(null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const qrValue = token
    ? `https://creative-recreation-production-41a9.up.railway.app/invite/${token}`
    : ''
  const minutes = secondsLeft != null ? Math.floor(secondsLeft / 60) : null
  const secs    = secondsLeft != null ? String(secondsLeft % 60).padStart(2, '0') : null

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Icon name="arrow-left" size={22} color="#fff" />
      </TouchableOpacity>

      <Icon name="feather" size={32} color="#4f6ef7" style={styles.logo} />
      <Text style={styles.title}>QR Invite</Text>
      <Text style={styles.subtitle}>
        Let another Blink user scan this code to instantly add each other as verified contacts and open a chat.
      </Text>

      <Text style={styles.scanLabel}>📷 Scan here to Blink</Text>

      <View style={styles.qrWrap}>
        {loading ? (
          <ActivityIndicator color="#4f6ef7" size="large" />
        ) : token ? (
          <QRCode value={qrValue} size={220} color="#fff" backgroundColor="#1a1a1a" />
        ) : (
          <View style={styles.expired}>
            <Icon name="clock" size={40} color="#555" />
            <Text style={styles.expiredText}>QR code expired</Text>
          </View>
        )}
      </View>

      {secondsLeft != null && token && (
        <Text style={[styles.timer, secondsLeft < 60 && styles.timerRed]}>
          Expires in {minutes}:{secs}
        </Text>
      )}

      <TouchableOpacity style={styles.refreshBtn} onPress={generate} disabled={loading}>
        <Icon name="refresh-cw" size={16} color="#fff" style={{ marginRight: 8 }} />
        <Text style={styles.refreshText}>Generate new code</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Have the other person open Blink and scan this with their camera. The code is single-use and expires in 10 minutes.
      </Text>

    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a', padding: 24, paddingTop: 60 },
  back:        { position: 'absolute', top: 52, left: 20, padding: 8 },
  logo:        { alignSelf: 'center', marginBottom: 8 },
  title:       { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  subtitle:    { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  scanLabel:   { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 12, letterSpacing: 0.3 },
  qrWrap:      { alignSelf: 'center', backgroundColor: '#1a1a1a', borderRadius: 20, padding: 20, marginBottom: 16, minWidth: 260, minHeight: 260, alignItems: 'center', justifyContent: 'center' },
  expired:     { alignItems: 'center', gap: 12 },
  expiredText: { color: '#555', fontSize: 14 },
  timer:       { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  timerRed:    { color: '#ff6b6b' },
  refreshBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f1f1f', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24, alignSelf: 'center', marginBottom: 24 },
  refreshText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  hint:        { color: '#444', fontSize: 12, textAlign: 'center', lineHeight: 18 },
})
