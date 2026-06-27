import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native'

export default function SaveRequestModal({ request, onDecide }) {
  return (
    <Modal transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Save request</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>{request.requesterUsername}</Text> wants to save the {request.content_type} you sent them.
          </Text>
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.deny]} onPress={() => onDecide('denied')}>
              <Text style={styles.btnText}>Deny</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approve]} onPress={() => onDecide('approved')}>
              <Text style={styles.btnText}>Allow</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  card:     { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, width: '80%' },
  title:    { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  body:     { color: '#ccc', fontSize: 15, marginBottom: 24, lineHeight: 22 },
  bold:     { color: '#fff', fontWeight: '600' },
  row:      { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  btn:      { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  deny:     { backgroundColor: '#3a1a1a' },
  approve:  { backgroundColor: '#4f6ef7' },
  btnText:  { color: '#fff', fontWeight: '600' },
})
