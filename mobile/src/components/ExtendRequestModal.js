import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native'

const DURATIONS = [
  { label: '1 hour',   hours: 1 },
  { label: '5 hours',  hours: 5 },
  { label: '24 hours', hours: 24 },
  { label: 'No limit', hours: null },
]

export default function ExtendRequestModal({ request, onDecide }) {
  return (
    <Modal transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Time extension request</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>{request.requester_username}</Text> is requesting more time to keep a file you sent them.
          </Text>
          <Text style={styles.label}>Extend for how long?</Text>
          {DURATIONS.map(({ label, hours }) => (
            <TouchableOpacity
              key={label}
              style={styles.durationBtn}
              onPress={() => onDecide('approved', hours)}
            >
              <Text style={styles.durationText}>{label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.denyBtn} onPress={() => onDecide('denied', null)}>
            <Text style={styles.denyText}>Deny</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  card:         { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, width: '82%' },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  body:         { color: '#ccc', fontSize: 15, marginBottom: 16, lineHeight: 22 },
  bold:         { color: '#fff', fontWeight: '600' },
  label:        { color: '#888', fontSize: 13, marginBottom: 10 },
  durationBtn:  { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 8 },
  durationText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  denyBtn:      { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
  denyText:     { color: '#ff4444', fontWeight: '600', fontSize: 15 },
})
