import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, Alert, Dimensions, Modal, Pressable,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { loadIndex, deleteItem, updateExpiresAt } from '../library/storage'
import { api } from '../api/client'

const COL = 3
const SIZE = (Dimensions.get('window').width - 4) / COL

export default function LibraryScreen({ navigation, route }) {
  const fromUsername = route?.params?.fromUsername ?? null
  const fromGroupId  = route?.params?.fromGroupId ?? null
  const groupName    = route?.params?.groupName ?? null
  const [items, setItems] = useState([])
  const [preview, setPreview] = useState(null)
  const pendingExtend = useRef({}) // itemId -> requestId being polled

  useFocusEffect(useCallback(() => {
    loadIndex().then(idx => {
      const all = [...idx].reverse()
      if (fromUsername) setItems(all.filter(i => i.fromUsername === fromUsername))
      else if (fromGroupId) setItems(all.filter(i => i.fromGroupId === fromGroupId))
      else setItems(all)
    })
  }, [fromUsername, fromGroupId]))

  async function confirmDelete(id) {
    Alert.alert('Delete', 'Remove this from your library?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteItem(id)
          setItems(prev => prev.filter(i => i.id !== id))
          setPreview(null)
        }
      },
    ])
  }

  async function requestExtend(item) {
    if (pendingExtend.current[item.id]) {
      Alert.alert('Pending', 'You already have a pending request for this item.')
      return
    }
    try {
      const { id: requestId } = await api.post('/messages/extend-requests', {
        libraryItemId: item.id,
        senderUsername: item.fromUsername,
        messageId: item.messageId ?? null,  // pass original message ID for thumbnail
      })
      Alert.alert('Requested', 'Your request has been sent. We\'ll update the item when they respond.')
      pendingExtend.current[item.id] = requestId
      // Poll for outcome
      const poll = setInterval(async () => {
        try {
          const { status, expiresAt } = await api.get(`/messages/extend-requests/${requestId}/status`)
          if (status !== 'pending') {
            clearInterval(poll)
            delete pendingExtend.current[item.id]
            if (status === 'approved') {
              await updateExpiresAt(item.id, expiresAt)
              setItems(prev => prev.map(i => i.id === item.id ? { ...i, expiresAt: expiresAt ?? null } : i))
              Alert.alert('Approved!', expiresAt ? `Item extended until ${new Date(expiresAt).toLocaleString()}` : 'No time limit set.')
            } else {
              Alert.alert('Denied', 'The sender denied your extension request.')
            }
          }
        } catch {}
      }, 5000)
    } catch (err) {
      if (err.message?.includes('409') || err.message?.includes('already')) {
        Alert.alert('Pending', 'You already have a pending request for this item.')
      } else {
        Alert.alert('Error', `Could not send request: ${err.message}`)
      }
    }
  }

  function expiryLabel(expiresAt) {
    if (!expiresAt) return null
    const diff = new Date(expiresAt).getTime() - Date.now()
    if (diff <= 0) return 'Expired'
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m}m`
  }

  function renderItem({ item }) {
    const expiry = expiryLabel(item.expiresAt)
    if (item.contentType === 'image') {
      return (
        <TouchableOpacity onPress={() => setPreview(item)} onLongPress={() => confirmDelete(item.id)} style={{ position: 'relative' }}>
          <Image source={{ uri: `file://${item.path}` }} style={styles.thumb} />
          {expiry && (
            <View style={styles.expiryBadge}>
              <Text style={styles.expiryText}>{expiry}</Text>
            </View>
          )}
        </TouchableOpacity>
      )
    }
    return (
      <TouchableOpacity style={styles.fileCell} onLongPress={() => confirmDelete(item.id)}>
        <Text style={styles.fileIcon}>{item.contentType === 'video' ? '🎥' : '📄'}</Text>
        <Text style={styles.fileName} numberOfLines={2}>{item.label}</Text>
        <Text style={styles.fileMeta}>{item.fromUsername ?? item.groupName}</Text>
        {expiry && <Text style={styles.expiryText}>{expiry}</Text>}
        {item.expiresAt && (
          <TouchableOpacity onPress={() => requestExtend(item)} style={styles.extendBadge}>
            <Text style={styles.extendBadgeText}>+ More time</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.header}>{fromUsername ? `${fromUsername}'s saves` : groupName ? `${groupName}'s saves` : 'Library'}</Text>
        <View style={{ width: 60 }} />
      </View>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔒</Text>
          <Text style={styles.emptyText}>Nothing saved yet</Text>
          <Text style={styles.emptyHint}>{fromUsername ? `No saves from ${fromUsername} yet` : groupName ? `No saves from ${groupName} yet` : 'Files approved by senders appear here'}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          numColumns={COL}
          renderItem={renderItem}
          contentContainerStyle={{ gap: 2 }}
          columnWrapperStyle={{ gap: 2 }}
        />
      )}

      {/* Full-screen image preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.previewOverlay}>
          <TouchableOpacity style={styles.previewBack} onPress={() => setPreview(null)}>
            <Text style={styles.previewBackText}>← Back</Text>
          </TouchableOpacity>
          {preview?.contentType === 'image' && (
            <Image source={{ uri: `file://${preview.path}` }} style={styles.previewImage} resizeMode="contain" />
          )}
          <View style={styles.previewMeta}>
            <Text style={styles.previewFrom}>From {preview?.fromUsername ?? preview?.groupName}</Text>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {preview?.expiresAt && (
                <TouchableOpacity onPress={() => requestExtend(preview)}>
                  <Text style={styles.extendBtn}>+ More time</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => confirmDelete(preview?.id)}>
                <Text style={styles.deleteBtn}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  headerRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  backBtn:        { width: 60 },
  backText:       { color: '#4f6ef7', fontSize: 16 },
  header:         { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  thumb:          { width: SIZE, height: SIZE },
  fileCell:       { width: SIZE, height: SIZE, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', padding: 8 },
  fileIcon:       { fontSize: 28, marginBottom: 4 },
  fileName:       { color: '#fff', fontSize: 11, textAlign: 'center' },
  fileMeta:       { color: '#666', fontSize: 10, marginTop: 2 },
  expiryBadge:    { position: 'absolute', bottom: 4, left: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 4 },
  expiryText:     { color: '#f90', fontSize: 9, fontWeight: '600', textAlign: 'center' },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyHint:      { color: '#555', fontSize: 14 },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  previewBack:    { position: 'absolute', top: 48, left: 16, zIndex: 10, padding: 8 },
  previewBackText:{ color: '#fff', fontSize: 16, fontWeight: '600' },
  previewImage:   { width: '100%', height: '80%' },
  previewMeta:    { position: 'absolute', bottom: 40, flexDirection: 'row', justifyContent: 'space-between', width: '80%' },
  previewFrom:    { color: '#888', fontSize: 14 },
  deleteBtn:      { color: '#ff4444', fontSize: 14, fontWeight: '600' },
  extendBtn:      { color: '#4f6ef7', fontSize: 14, fontWeight: '600' },
  extendBadge:    { marginTop: 4, backgroundColor: '#1a2a4a', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6 },
  extendBadgeText:{ color: '#4f6ef7', fontSize: 9, fontWeight: '600' },
})
