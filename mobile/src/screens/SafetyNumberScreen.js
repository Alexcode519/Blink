import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import { syncPublicKey, computeSafetyNumber } from '../crypto/keys'

export default function SafetyNumberScreen({ route, navigation }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [safetyNumber, setSafetyNumber] = useState(null)

  useEffect(() => {
    syncPublicKey().then(myPublicKey => {
      setSafetyNumber(computeSafetyNumber(myPublicKey, recipientPublicKey))
    })
  }, [recipientPublicKey])

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
})
