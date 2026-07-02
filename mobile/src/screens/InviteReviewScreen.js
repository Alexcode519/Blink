import React, { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView } from 'react-native'
import { api } from '../api/client'
import { syncPublicKey, computeSafetyNumber } from '../crypto/keys'

export default function InviteReviewScreen({ route, navigation }) {
  const { invite } = route.params  // { id, senderUsername, senderPublicKey, createdAt }
  const [myNumber, setMyNumber] = useState(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    syncPublicKey().then(myPk => {
      const num = computeSafetyNumber(myPk, invite.senderPublicKey)
      setMyNumber(num)
      setLoading(false)
    })
  }, [invite.senderPublicKey])

  function groups(num) {
    return num ? num.match(/.{1,5}/g) ?? [] : []
  }

  async function accept() {
    setActing(true)
    try {
      await api.post(`/invites/${invite.id}/accept`, {})
      Alert.alert(
        '✓ Verified',
        `You've accepted and verified ${invite.senderUsername}'s invite. Your conversation is now marked as mutually verified.`,
        [{ text: 'Open chat', onPress: () => navigation.replace('Chat', {
          recipientUsername: invite.senderUsername,
          recipientPublicKey: invite.senderPublicKey,
        })}]
      )
    } catch (e) {
      Alert.alert('Error', e.message)
      setActing(false)
    }
  }

  async function decline() {
    Alert.alert('Decline invite?', `${invite.senderUsername}'s invite will be declined.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: async () => {
        setActing(true)
        try {
          await api.post(`/invites/${invite.id}/decline`, {})
          navigation.goBack()
        } catch (e) { Alert.alert('Error', e.message); setActing(false) }
      }},
    ])
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.senderIcon}>{invite.senderUsername[0].toUpperCase()}</Text>
        <Text style={styles.senderName}>{invite.senderUsername}</Text>
        <Text style={styles.subtitle}>wants to start a verified conversation</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔐 Verify before accepting</Text>
        <Text style={styles.cardBody}>
          Ask <Text style={styles.bold}>{invite.senderUsername}</Text> to open their Safety Number screen in the chat with you. Compare the numbers below — they must match exactly on both devices.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Safety number for this conversation</Text>
      {loading ? (
        <ActivityIndicator color="#4f6ef7" style={{ marginTop: 20 }} />
      ) : (
        <View style={styles.numberGrid}>
          {groups(myNumber).map((g, i) => (
            <Text key={i} style={styles.numberGroup}>{g}</Text>
          ))}
        </View>
      )}
      <Text style={styles.hint}>
        This number is unique to you and {invite.senderUsername}. If it matches on both screens, the invite is genuine and safe to accept.
      </Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.declineBtn} onPress={decline} disabled={acting}>
          <Text style={styles.declineTxt}>Decline</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceptBtn} onPress={accept} disabled={acting || loading}>
          {acting ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptTxt}>✓ Accept & Verify</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  content:     { padding: 20, paddingTop: 50, paddingBottom: 40 },
  backBtn:     { marginBottom: 16 },
  backText:    { color: '#4f6ef7', fontSize: 16 },
  header:      { alignItems: 'center', marginBottom: 24 },
  senderIcon:  { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4f6ef7', textAlign: 'center', lineHeight: 72, color: '#fff', fontSize: 32, fontWeight: '700', overflow: 'hidden' },
  senderName:  { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 12 },
  subtitle:    { color: '#888', fontSize: 14, marginTop: 4 },
  card:        { backgroundColor: '#1a1a2a', borderRadius: 12, padding: 16, marginBottom: 24, borderLeftWidth: 3, borderLeftColor: '#4f6ef7' },
  cardTitle:   { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  cardBody:    { color: '#aaa', fontSize: 14, lineHeight: 21 },
  bold:        { color: '#fff', fontWeight: '600' },
  sectionLabel:{ color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  numberGrid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 16 },
  numberGroup: { color: '#fff', fontSize: 15, fontFamily: 'monospace', backgroundColor: '#1a1a1a', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  hint:        { color: '#555', fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 32 },
  btnRow:      { flexDirection: 'row', gap: 12, marginTop: 32 },
  declineBtn:  { flex: 1, borderWidth: 1, borderColor: '#ff4444', borderRadius: 12, padding: 16, alignItems: 'center' },
  declineTxt:  { color: '#ff4444', fontWeight: '600', fontSize: 15 },
  acceptBtn:   { flex: 2, backgroundColor: '#4f6ef7', borderRadius: 12, padding: 16, alignItems: 'center' },
  acceptTxt:   { color: '#fff', fontWeight: '700', fontSize: 15 },
})
