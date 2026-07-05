import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Alert,
} from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { useFocusEffect } from '@react-navigation/native'
import { getQueue, dequeue } from '../mesh/RelayQueue'
import { bridgeNow } from '../mesh/MeshBridge'

export default function NearbyScreen({ navigation }) {
  const [online, setOnline] = useState(true)
  const [queue, setQueue] = useState([])
  const [bridging, setBridging] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  useFocusEffect(useCallback(() => {
    refresh()
    const unsub = NetInfo.addEventListener(state => {
      setOnline(!!(state.isConnected && state.isInternetReachable))
    })
    return () => unsub()
  }, []))

  async function refresh() {
    const q = await getQueue()
    setQueue(q)
  }

  async function handleBridgeNow() {
    if (bridging) return
    setBridging(true)
    try {
      await bridgeNow()
      await refresh()
      setLastSync(new Date())
    } catch (e) {
      Alert.alert('Sync failed', e.message)
    } finally {
      setBridging(false)
    }
  }

  async function handleDiscard(id) {
    Alert.alert('Discard message?', 'This queued message will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        await dequeue(id)
        await refresh()
      }},
    ])
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts
    const m = Math.floor(diff / 60000)
    const h = Math.floor(diff / 3600000)
    if (h > 0) return `${h}h ago`
    if (m > 0) return `${m}m ago`
    return 'just now'
  }

  function ttlLeft(entry) {
    const expiresAt = entry.addedAt + entry.ttl
    const diff = expiresAt - Date.now()
    if (diff <= 0) return 'Expired'
    const h = Math.floor(diff / 3600000)
    return `${h}h left`
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Nearby</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Connectivity status */}
      <View style={[styles.statusBar, online ? styles.statusOnline : styles.statusOffline]}>
        <View style={[styles.statusDot, { backgroundColor: online ? '#34c759' : '#ff9500' }]} />
        <Text style={styles.statusText}>
          {online ? 'Connected to internet — queued messages will send now' : 'Offline — messages queued for mesh relay'}
        </Text>
      </View>

      {/* Sync button */}
      <View style={styles.syncRow}>
        <View>
          <Text style={styles.syncLabel}>Offline message queue</Text>
          {lastSync && <Text style={styles.syncTime}>Last sync: {lastSync.toLocaleTimeString()}</Text>}
        </View>
        <TouchableOpacity
          style={[styles.syncBtn, (!online || bridging) && styles.syncBtnDisabled]}
          onPress={handleBridgeNow}
          disabled={!online || bridging}
        >
          {bridging
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.syncBtnText}>Sync now</Text>
          }
        </TouchableOpacity>
      </View>

      {queue.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyText}>No queued messages</Text>
          <Text style={styles.emptyHint}>Messages sent without internet appear here until delivered</Text>
        </View>
      ) : (
        <FlatList
          data={queue}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTo}>To: {item.recipientUsername ?? '(unknown)'}</Text>
                <View style={[styles.badge, item.recipientUsername ? styles.badgeQueued : styles.badgeAnon]}>
                  <Text style={styles.badgeText}>{item.recipientUsername ? 'queued' : 'relay'}</Text>
                </View>
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>Queued {timeAgo(item.addedAt)}</Text>
                <Text style={styles.metaText}>·</Text>
                <Text style={[styles.metaText, { color: '#ff9500' }]}>{ttlLeft(item)}</Text>
              </View>
              <TouchableOpacity style={styles.discardBtn} onPress={() => handleDiscard(item.id)}>
                <Text style={styles.discardText}>Discard</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>How mesh relay works</Text>
        <Text style={styles.infoText}>
          When you have no internet, Blink queues your messages and sends them via Bluetooth or Wi-Fi Direct
          to nearby Blink users, who relay them toward the recipient — up to 72 hours.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a0a0a' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  backBtn:         { width: 60 },
  backText:        { color: '#4f6ef7', fontSize: 16 },
  title:           { color: '#fff', fontSize: 17, fontWeight: '700' },
  statusBar:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  statusOnline:    { backgroundColor: '#0d1f0d' },
  statusOffline:   { backgroundColor: '#1f1700' },
  statusDot:       { width: 8, height: 8, borderRadius: 4 },
  statusText:      { color: '#aaa', fontSize: 13, flex: 1 },
  syncRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  syncLabel:       { color: '#fff', fontSize: 15, fontWeight: '600' },
  syncTime:        { color: '#555', fontSize: 12, marginTop: 2 },
  syncBtn:         { backgroundColor: '#4f6ef7', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  syncBtnDisabled: { backgroundColor: '#2a2a2a' },
  syncBtnText:     { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty:           { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyHint:       { color: '#555', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card:            { backgroundColor: '#141414', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#222' },
  cardTop:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTo:          { color: '#fff', fontSize: 15, fontWeight: '500' },
  badge:           { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeQueued:     { backgroundColor: '#1a2a4a' },
  badgeAnon:       { backgroundColor: '#2a1a0a' },
  badgeText:       { color: '#aaa', fontSize: 11, fontWeight: '600' },
  cardMeta:        { flexDirection: 'row', gap: 6, marginBottom: 10 },
  metaText:        { color: '#555', fontSize: 12 },
  discardBtn:      { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ff4444' },
  discardText:     { color: '#ff4444', fontSize: 13 },
  infoBox:         { margin: 16, backgroundColor: '#111', borderRadius: 12, padding: 14 },
  infoTitle:       { color: '#555', fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 },
  infoText:        { color: '#444', fontSize: 13, lineHeight: 19 },
})
