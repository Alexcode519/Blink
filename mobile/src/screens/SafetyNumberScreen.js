import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { syncPublicKey, computeSafetyNumber } from '../crypto/keys'
import { api } from '../api/client'

export default function SafetyNumberScreen({ route, navigation }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [safetyNumber, setSafetyNumber] = useState(null)
  const [inviteSent, setInviteSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [verifiedAt, setVerifiedAt] = useState(null)

  useEffect(() => {
    syncPublicKey().then(myPublicKey => {
      setSafetyNumber(computeSafetyNumber(myPublicKey, recipientPublicKey))
    })
    // Check if already verified
    api.get(`/invites/verified/${recipientUsername}`)
      .then(({ verified, verifiedAt: va }) => { if (verified) setVerifiedAt(va) })
      .catch(() => {})
  }, [recipientPublicKey, recipientUsername])

  async function sendInvite() {
    setSending(true)
    try {
      await api.post('/invites', { recipientUsername })
      setInviteSent(true)
      Alert.alert(
        '✉️ Invite sent',
        `${recipientUsername} will receive a notification with your safety number to compare and verify before accepting.`
      )
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSending(false)
    }
  }

  const groups = safetyNumber ? safetyNumber.match(/.{1,5}/g) : []

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Safety Number</Text>
      <Text style={styles.subtitle}>
        Compare this number with <Text style={styles.bold}>{recipientUsername}</Text> in person or over a
        trusted channel. If it matches on both devices, your conversation is verified safe from interception.
      </Text>

      {verifiedAt && (
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedText}>✓ Mutually verified {new Date(verifiedAt).toLocaleDateString()}</Text>
        </View>
      )}

      {!safetyNumber ? (
        <ActivityIndicator color="#4f6ef7" style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.qrWrap}>
            <QRCode value={`blink:safety:${safetyNumber}`} size={220} backgroundColor="#fff" color="#000" />
          </View>

          <View style={styles.numberGrid}>
            {groups.map((g, i) => (
              <Text key={i} style={styles.numberGroup}>{g}</Text>
            ))}
          </View>

          <Text style={styles.hint}>
            This number changes if either of you reinstalls Blink or generates a new key pair — if it
            suddenly differs from one you previously verified, treat the conversation with caution.
          </Text>

          {!verifiedAt && (
            <TouchableOpacity
              style={[styles.inviteBtn, (sending || inviteSent) && styles.inviteBtnDone]}
              onPress={sendInvite}
              disabled={sending || inviteSent}
            >
              {sending
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.inviteBtnText}>
                    {inviteSent ? '✓ Invite sent — waiting for verification' : '✉️ Send verified invite'}
                  </Text>
              }
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 50 },
  backBtn:      { marginBottom: 16 },
  backText:     { color: '#4f6ef7', fontSize: 16 },
  title:        { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  subtitle:     { color: '#888', fontSize: 14, lineHeight: 20, marginBottom: 24 },
  bold:         { color: '#fff', fontWeight: '600' },
  qrWrap:       { alignSelf: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 16, marginBottom: 24 },
  numberGrid:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginBottom: 24 },
  numberGroup:  { color: '#fff', fontSize: 16, fontFamily: 'monospace', backgroundColor: '#1a1a1a', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  hint:         { color: '#555', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  verifiedBadge:{ backgroundColor: '#1a3a1a', borderRadius: 10, padding: 10, marginBottom: 16, alignItems: 'center', borderWidth: 1, borderColor: '#34c759' },
  verifiedText: { color: '#34c759', fontSize: 14, fontWeight: '700' },
  inviteBtn:    { backgroundColor: '#4f6ef7', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  inviteBtnDone:{ backgroundColor: '#1a2a1a', borderColor: '#34c759', borderWidth: 1 },
  inviteBtnText:{ color: '#fff', fontWeight: '700', fontSize: 15 },
})
