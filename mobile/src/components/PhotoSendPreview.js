import React, { useEffect, useRef, useState } from 'react'
import { Modal, View, Image, Text, TouchableOpacity, Switch, ActivityIndicator, StyleSheet } from 'react-native'
import { detectFaces, blurFacesInImage } from '../utils/faceBlur'

// Shows a send-preview only when faces are detected in the photo. Blurring is
// baked permanently into the pixels before the image ever leaves the device —
// toggling the switch off just swaps back to the untouched original for send.
export default function PhotoSendPreview({ visible, uri, originalBase64, onSend, onCancel }) {
  const [phase, setPhase] = useState('detecting') // detecting | preview | detect-error | sending
  const [blurredBase64, setBlurredBase64] = useState(null)
  const [blurEnabled, setBlurEnabled] = useState(true)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!visible) return
    cancelled.current = false
    setPhase('detecting')
    setBlurredBase64(null)
    setBlurEnabled(true)

    ;(async () => {
      let faces
      try {
        faces = await detectFaces(uri)
      } catch {
        // Detection genuinely failed (e.g. ML Kit unavailable) — this is NOT
        // the same as "no faces found," so we must not silently auto-send.
        // Make the sender explicitly confirm before it goes out unchecked.
        if (!cancelled.current) setPhase('detect-error')
        return
      }
      if (cancelled.current) return
      if (!faces.length) {
        onSend(originalBase64)
        return
      }
      const blurred = await blurFacesInImage(uri, faces)
      if (cancelled.current) return
      if (!blurred) {
        onSend(originalBase64)
        return
      }
      setBlurredBase64(blurred)
      setPhase('preview')
    })()

    return () => { cancelled.current = true }
  }, [visible, uri])

  function handleSend() {
    setPhase('sending')
    onSend(blurEnabled ? blurredBase64 : originalBase64)
  }

  function handleSendUnchecked() {
    setPhase('sending')
    onSend(originalBase64)
  }

  function handleCancel() {
    cancelled.current = true
    onCancel()
  }

  if (!visible || phase === 'detecting') return null

  if (phase === 'detect-error') {
    return (
      <Modal transparent visible animationType="fade" onRequestClose={handleCancel}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>Couldn't check for faces</Text>
                <Text style={styles.toggleSub}>Face detection failed, so this photo has not been checked or blurred. Send it as-is, or cancel.</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendBtn} onPress={handleSendUnchecked}>
                <Text style={styles.sendLabel}>Send anyway</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    )
  }

  const previewBase64 = blurEnabled ? blurredBase64 : originalBase64
  const previewUri = `data:image/jpeg;base64,${previewBase64}`

  return (
    <Modal transparent visible animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Image source={{ uri: previewUri }} style={styles.image} resizeMode="contain" />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Blur faces</Text>
              <Text style={styles.toggleSub}>A face was detected. Blurring is permanent once sent.</Text>
            </View>
            <Switch value={blurEnabled} onValueChange={setBlurEnabled} />
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={phase === 'sending'}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendBtn} onPress={handleSend} disabled={phase === 'sending'}>
              {phase === 'sending'
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.sendLabel}>Send</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 16, overflow: 'hidden' },
  image: { width: '100%', height: 380, backgroundColor: '#000' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  toggleLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggleSub: { color: '#888', fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  cancelBtn: { flex: 1, padding: 16, alignItems: 'center' },
  cancelLabel: { color: '#888', fontSize: 16, fontWeight: '500' },
  sendBtn: { flex: 1, padding: 16, alignItems: 'center', backgroundColor: '#6366f1' },
  sendLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
