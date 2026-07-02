import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, Image } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const DURATIONS = [
  { label: '1 hour',    hours: 1 },
  { label: '5 hours',   hours: 5 },
  { label: '24 hours',  hours: 24 },
  { label: 'No limit',  hours: null },
]

const TYPE_ICON = { image: '🖼️', video: '🎥', audio: '🔊', document: '📄' }

export default function SaveRequestModal({ request, onDecide, onCancel }) {
  const [previewUri, setPreviewUri] = useState(null)

  useEffect(() => {
    // Sender has the sent media cached under blink_sent_<messageId>
    if (request?.message_id && request?.content_type === 'image') {
      AsyncStorage.getItem(`blink_sent_${request.message_id}`)
        .then(raw => {
          if (raw) {
            const { payload } = JSON.parse(raw)
            setPreviewUri(payload) // file URI or base64 data URI
          }
        })
        .catch(() => {})
    }
  }, [request?.message_id])

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Save request</Text>
          <Text style={styles.body}>
            <Text style={styles.bold}>{request.requesterUsername}</Text> wants to save the {request.content_type} you sent them.
          </Text>

          {/* Image preview */}
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
          ) : (
            <View style={styles.iconPreview}>
              <Text style={styles.iconText}>{TYPE_ICON[request.content_type] ?? '📁'}</Text>
              <Text style={styles.iconLabel}>{request.content_type}</Text>
            </View>
          )}

          <Text style={styles.label}>Allow for how long?</Text>
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
          {onCancel && (
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Decide later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  card:         { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, width: '86%' },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  body:         { color: '#ccc', fontSize: 15, marginBottom: 14, lineHeight: 22 },
  bold:         { color: '#fff', fontWeight: '600' },
  preview:      { width: '100%', height: 180, borderRadius: 10, marginBottom: 16 },
  iconPreview:  { width: '100%', height: 80, borderRadius: 10, backgroundColor: '#111',
                  alignItems: 'center', justifyContent: 'center', marginBottom: 16, gap: 6 },
  iconText:     { fontSize: 36 },
  iconLabel:    { color: '#666', fontSize: 12, textTransform: 'capitalize' },
  label:        { color: '#888', fontSize: 13, marginBottom: 10 },
  durationBtn:  { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 8 },
  durationText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  denyBtn:      { backgroundColor: '#3a1a1a', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4 },
  denyText:     { color: '#ff4444', fontWeight: '600', fontSize: 15 },
  cancelBtn:    { padding: 12, alignItems: 'center', marginTop: 4 },
  cancelText:   { color: '#888', fontWeight: '600', fontSize: 14 },
})
