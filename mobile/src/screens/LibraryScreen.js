import React, { useState, useCallback } from 'react'
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, Alert, Dimensions, Modal, Pressable,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { loadIndex, deleteItem } from '../library/storage'

const COL = 3
const SIZE = (Dimensions.get('window').width - 4) / COL

export default function LibraryScreen() {
  const [items, setItems] = useState([])
  const [preview, setPreview] = useState(null)

  useFocusEffect(useCallback(() => {
    loadIndex().then(idx => setItems([...idx].reverse()))
  }, []))

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

  function renderItem({ item }) {
    if (item.contentType === 'image') {
      return (
        <TouchableOpacity onPress={() => setPreview(item)} onLongPress={() => confirmDelete(item.id)}>
          <Image source={{ uri: `file://${item.path}` }} style={styles.thumb} />
        </TouchableOpacity>
      )
    }
    return (
      <TouchableOpacity style={styles.fileCell} onLongPress={() => confirmDelete(item.id)}>
        <Text style={styles.fileIcon}>{item.contentType === 'video' ? '🎥' : '📄'}</Text>
        <Text style={styles.fileName} numberOfLines={2}>{item.label}</Text>
        <Text style={styles.fileMeta}>{item.fromUsername}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Library</Text>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔒</Text>
          <Text style={styles.emptyText}>Nothing saved yet</Text>
          <Text style={styles.emptyHint}>Files approved by senders appear here</Text>
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
        <Pressable style={styles.previewOverlay} onPress={() => setPreview(null)}>
          {preview?.contentType === 'image' && (
            <Image source={{ uri: `file://${preview.path}` }} style={styles.previewImage} resizeMode="contain" />
          )}
          <View style={styles.previewMeta}>
            <Text style={styles.previewFrom}>From {preview?.fromUsername}</Text>
            <TouchableOpacity onPress={() => confirmDelete(preview?.id)}>
              <Text style={styles.deleteBtn}>Delete</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  thumb:          { width: SIZE, height: SIZE },
  fileCell:       { width: SIZE, height: SIZE, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', padding: 8 },
  fileIcon:       { fontSize: 28, marginBottom: 4 },
  fileName:       { color: '#fff', fontSize: 11, textAlign: 'center' },
  fileMeta:       { color: '#666', fontSize: 10, marginTop: 2 },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyHint:      { color: '#555', fontSize: 14 },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  previewImage:   { width: '100%', height: '80%' },
  previewMeta:    { position: 'absolute', bottom: 40, flexDirection: 'row', justifyContent: 'space-between', width: '80%' },
  previewFrom:    { color: '#888', fontSize: 14 },
  deleteBtn:      { color: '#ff4444', fontSize: 14, fontWeight: '600' },
})
