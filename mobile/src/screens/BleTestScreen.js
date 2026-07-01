import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  PermissionsAndroid, Platform, NativeModules, NativeEventEmitter,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getQueue, enqueue, dequeue } from '../mesh/RelayQueue'
import { onPeerConnected, onData, clearSession, startRelayService, stopRelayService } from '../mesh/MeshProtocol'
import { syncPublicKey } from '../crypto/keys'

const { BleModule } = NativeModules
const bleEmitter = BleModule ? new NativeEventEmitter(BleModule) : null

export default function BleTestScreen({ navigation }) {
  const [log, setLog] = useState([])
  const [scanning, setScanning] = useState(false)
  const [advertising, setAdvertising] = useState(false)
  const [serverRunning, setServerRunning] = useState(false)
  const [bleState, setBleState] = useState('Unknown')
  const [devices, setDevices] = useState({})
  const [connected, setConnected] = useState({})
  const connectedRef = useRef({})   // mirrors connected for closure access
  const [relayQueue, setRelayQueue] = useState([])
  const [myKeyHash, setMyKeyHash] = useState('')
  const scanTimer = useRef(null)

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [`[${ts}] ${msg}`, ...prev.slice(0, 99)])
  }

  async function refreshQueue() {
    const q = await getQueue()
    setRelayQueue(q)
  }

  // Derive a short hash of our own public key — used to recognise messages addressed to us
  async function loadMyHash() {
    const pk = await syncPublicKey()
    // Use first 16 chars of base64 pk as a short address hash (good enough for spike)
    setMyKeyHash(pk.slice(0, 16))
    return pk.slice(0, 16)
  }

  const myHashRef = useRef('')

  useEffect(() => {
    if (!BleModule) { addLog('BleModule not found'); return }

    loadMyHash().then(h => { myHashRef.current = h; addLog(`My mesh hash: ${h}`) })
    BleModule.getState().then(s => { setBleState(s); addLog(`BLE: ${s}`) }).catch(() => {})
    BleModule.startGattServer()
    refreshQueue()

    const subs = [
      bleEmitter.addListener('BleDeviceFound', d => {
        setDevices(prev => {
          if (prev[d.id]) return prev
          addLog(`Found: ${d.name || '(unnamed)'} | ${d.id.slice(-8)} | ${d.rssi} dBm${d.isBlink ? ' ★ BLINK' : ''}`)
          // Auto-connect to Blink peers — both sides need client connections for bidirectional writes
          if (d.isBlink && !connected[d.id]) {
            addLog(`Auto-connecting to Blink peer ${d.id.slice(-8)}...`)
            BleModule.connectGatt(d.id)
          }
          return { ...prev, [d.id]: d }
        })
      }),
      bleEmitter.addListener('BleScanStarted',   () => { setScanning(true);  addLog('Scan started') }),
      bleEmitter.addListener('BleScanStopped',   () => { setScanning(false); addLog('Scan stopped') }),
      bleEmitter.addListener('BleScanFailed',    e  => { setScanning(false); addLog(`Scan failed: ${e.error ?? 'code ' + e.errorCode}`) }),
      bleEmitter.addListener('BleAdvertiseStarted',  () => { setAdvertising(true);  addLog('Advertising ★') }),
      bleEmitter.addListener('BleAdvertiseStopped',  () => { setAdvertising(false); addLog('Advertising stopped') }),
      bleEmitter.addListener('BleAdvertiseFailed',   e  => addLog(`Advertise failed: ${e.error ?? 'code ' + e.errorCode}`)),
      bleEmitter.addListener('BleGattServerStarted', () => { setServerRunning(true); addLog('GATT server ready') }),

      // Central-role events (we connected to a peer)
      bleEmitter.addListener('BleGattMtu',               e => addLog(`MTU=${e.mtu}`)),
      bleEmitter.addListener('BleGattConnected',          e => {
        setConnected(p => { const n = { ...p, [e.address]: true }; connectedRef.current = n; return n })
        addLog(`Connected to ${e.address.slice(-8)} — awaiting service discovery...`)
      }),
      bleEmitter.addListener('BleGattDisconnected',       e => {
        setConnected(p => { const n = { ...p, [e.address]: false }; connectedRef.current = n; return n })
        clearSession(e.address)
        addLog(`Disconnected from ${e.address.slice(-8)}`)
        refreshQueue()
      }),
      bleEmitter.addListener('BleGattServicesDiscovered', e => {
        addLog(`Services: Blink=${e.hasBlinkService ? '✓' : '✗'} on ${e.address.slice(-8)}`)
        // Only start the gossip protocol AFTER services are discovered
        // so writeGatt can find the characteristic immediately
        if (e.hasBlinkService) onPeerConnected(e.address, addLog)
      }),

      // Data received via our GATT server (peer is a client writing to us).
      // e.from is the peer's server-side MAC which may differ from their
      // scan-visible MAC stored in gattClients. Prefer the client-side address
      // so writeGatt calls in MeshProtocol find the right connection.
      bleEmitter.addListener('BleGattData', e => {
        // Find any currently-connected client address (scan-visible) to use for writes
        // e.from is the server-side address. We also connectGatt(e.from) in
        // BleGattClientConnected so gattClients[e.from] exists for writes.
        addLog(`← Data from ${e.from.slice(-8)}: ${e.data.slice(0, 50)}`)
        onData(
          e.from, e.data, myHashRef.current,
          addLog,
          (delivered) => {
            addLog(`📨 DELIVERED: ${delivered.id.slice(0, 8)} type=${delivered.contentType}`)
            refreshQueue()
          }
        ).then(() => refreshQueue())
      }),

      // Peripheral-role events (a peer connected to our server).
      // Connect back using the SAME address so gattClients[e.from] works in BleGattData.
      bleEmitter.addListener('BleGattClientConnected', e => {
        addLog(`Peer connected to our server: ${e.address.slice(-8)} — connecting back as client`)
        BleModule.connectGatt(e.address)
      }),
      bleEmitter.addListener('BleGattClientDisconnected', e => {
        clearSession(e.address)
        addLog(`Peer disconnected: ${e.address.slice(-8)}`)
        refreshQueue()
      }),
    ]
    return () => {
      subs.forEach(s => s.remove())
      clearTimeout(scanTimer.current)
      BleModule.stopGattServer()
    }
  }, [])

  async function requestPermissions() {
    const api = parseInt(Platform.Version, 10)
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ])
      return Object.values(res).every(r => r === PermissionsAndroid.RESULTS.GRANTED)
    }
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      { title: 'Location', message: 'Needed for BLE scan on Android < 12', buttonPositive: 'Allow' }
    )
    return res === PermissionsAndroid.RESULTS.GRANTED
  }

  async function startScan() {
    const ok = await requestPermissions()
    if (!ok) return
    setDevices({})
    BleModule.startScan()
    scanTimer.current = setTimeout(() => BleModule.stopScan(), 15000)
  }

  async function addTestMessage() {
    const id = `test_${Date.now()}`
    // Simulated encrypted payload addressed to the OTHER device (hard-coded for spike)
    await enqueue({ id, recipientKeyHash: 'other_device_hash', ciphertext: 'dGVzdA==', nonce: 'bm9uY2U=', contentType: 'text' })
    refreshQueue()
    addLog(`Added test message to relay queue: ${id.slice(0, 16)}`)
  }

  const blinkPeers = Object.values(devices).filter(d => d.isBlink).sort((a, b) => b.rssi - a.rssi)
  const others = Object.values(devices).filter(d => !d.isBlink).sort((a, b) => b.rssi - a.rssi)

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>BLE Mesh — Phase 3: Relay</Text>
      <Text style={styles.sub}>
        BLE: {bleState} · Server: {serverRunning ? '✓' : '…'} · Hash: {myKeyHash || '…'}
      </Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, scanning && styles.btnOff]} onPress={scanning ? () => BleModule.stopScan() : startScan}>
          <Text style={styles.btnTxt}>{scanning ? '⏹ Stop' : '▶ Scan'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, advertising && styles.btnOff, { backgroundColor: advertising ? '#333' : '#1a4a1a', borderColor: advertising ? '#555' : '#2a8a2a' }]}
          onPress={async () => {
            if (advertising) {
              BleModule.stopAdvertise()
              BleModule.stopScan()
              stopRelayService()
            } else {
              BleModule.startAdvertise()
              const ok = await requestPermissions()
              if (ok) { BleModule.startScan(); startRelayService() }
            }
          }}>
          <Text style={styles.btnTxt}>{advertising ? '⏹ Stop' : '📡 Advert+Scan'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: '#2a1a4a', borderColor: '#4a2a8a' }]} onPress={addTestMessage}>
          <Text style={styles.btnTxt}>+ Test Msg</Text>
        </TouchableOpacity>
      </View>

      {/* Relay queue status */}
      <View style={styles.queueBar}>
        <Text style={styles.queueLabel}>Relay queue: {relayQueue.length} msg{relayQueue.length !== 1 ? 's' : ''}</Text>
        {relayQueue.map(e => (
          <Text key={e.id} style={styles.queueItem}>
            → {e.id.slice(0, 12)} · to:{e.recipientKeyHash.slice(0, 8)}… · {e.contentType}
          </Text>
        ))}
      </View>

      {/* Blink peers */}
      {blinkPeers.length > 0 && (
        <View style={styles.peersSection}>
          <Text style={styles.sectionLabel}>★ Blink peers</Text>
          {blinkPeers.map(d => (
            <TouchableOpacity key={d.id}
              style={[styles.peerRow, connected[d.id] && styles.peerConnected]}
              onPress={() => connected[d.id] ? BleModule.disconnectGatt(d.id) : BleModule.connectGatt(d.id)}>
              <Text style={styles.peerName}>★ {d.name || '(unnamed)'}</Text>
              <Text style={styles.peerMeta}>{d.id.slice(-8)} · {d.rssi} dBm</Text>
              <Text style={styles.peerAction}>{connected[d.id] ? 'Disconnect' : 'Sync'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {others.length > 0 && (
        <Text style={styles.sectionLabel}>Other nearby: {others.length}</Text>
      )}

      <Text style={styles.sectionLabel}>Log</Text>
      <ScrollView style={styles.logBox}>
        {log.map((l, i) => (
          <Text key={i} style={[styles.logLine,
            l.includes('📨') && styles.logDelivered,
            l.includes('←') && styles.logIncoming,
          ]}>{l}</Text>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 50 },
  back:         { marginBottom: 8 },
  backText:     { color: '#4f6ef7', fontSize: 16 },
  title:        { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  sub:          { color: '#555', fontSize: 10, marginBottom: 10 },
  btnRow:       { flexDirection: 'row', gap: 8, marginBottom: 10 },
  btn:          { flex: 1, backgroundColor: '#4f6ef7', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#4f6ef7' },
  btnOff:       { backgroundColor: '#333', borderColor: '#555' },
  btnTxt:       { color: '#fff', fontWeight: '700', fontSize: 12 },
  queueBar:     { backgroundColor: '#111', borderRadius: 8, padding: 8, marginBottom: 8, borderWidth: 1, borderColor: '#2a2a4a' },
  queueLabel:   { color: '#888', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  queueItem:    { color: '#aaa', fontSize: 10, fontFamily: 'monospace' },
  peersSection: { marginBottom: 8 },
  peerRow:      { backgroundColor: '#1a2a4a', borderRadius: 8, padding: 10, marginBottom: 4, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#4f6ef7' },
  peerConnected:{ borderColor: '#34c759', backgroundColor: '#1a2a1a' },
  peerName:     { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  peerMeta:     { color: '#888', fontSize: 10 },
  peerAction:   { color: '#4f6ef7', fontSize: 11, fontWeight: '700', marginLeft: 8 },
  sectionLabel: { color: '#888', fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  logBox:       { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 8 },
  logLine:      { color: '#888', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 },
  logDelivered: { color: '#34c759', fontWeight: '700' },
  logIncoming:  { color: '#4f6ef7' },
})
