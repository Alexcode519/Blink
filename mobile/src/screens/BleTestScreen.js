import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  PermissionsAndroid, Platform, NativeModules, NativeEventEmitter,
} from 'react-native'

const { BleModule } = NativeModules
const bleEmitter = BleModule ? new NativeEventEmitter(BleModule) : null

export default function BleTestScreen({ navigation }) {
  const [log, setLog] = useState([])
  const [scanning, setScanning] = useState(false)
  const [advertising, setAdvertising] = useState(false)
  const [serverRunning, setServerRunning] = useState(false)
  const [bleState, setBleState] = useState('Unknown')
  const [devices, setDevices] = useState({})       // address -> device info
  const [connected, setConnected] = useState({})   // address -> true/false
  const scanTimer = useRef(null)

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [`[${ts}] ${msg}`, ...prev.slice(0, 79)])
  }

  useEffect(() => {
    if (!BleModule) { addLog('BleModule not found'); return }
    BleModule.getState().then(s => { setBleState(s); addLog(`BLE: ${s}`) }).catch(() => {})

    // Start GATT server automatically so this device can receive data
    BleModule.startGattServer()

    const subs = [
      bleEmitter.addListener('BleDeviceFound', d => {
        setDevices(prev => {
          if (prev[d.id]) return prev
          addLog(`Found: ${d.name || '(unnamed)'} | ${d.id.slice(-8)} | ${d.rssi} dBm${d.isBlink ? ' ★ BLINK PEER' : ''}`)
          return { ...prev, [d.id]: d }
        })
      }),
      bleEmitter.addListener('BleScanStarted',   () => { setScanning(true);  addLog('Scan started') }),
      bleEmitter.addListener('BleScanStopped',   () => { setScanning(false); addLog('Scan stopped') }),
      bleEmitter.addListener('BleScanFailed',    e  => { setScanning(false); addLog(`Scan failed: ${e.error ?? 'code ' + e.errorCode}`) }),
      bleEmitter.addListener('BleAdvertiseStarted',  () => { setAdvertising(true);  addLog('Advertising ★') }),
      bleEmitter.addListener('BleAdvertiseStopped',  () => { setAdvertising(false); addLog('Advertising stopped') }),
      bleEmitter.addListener('BleAdvertiseFailed',   e  => addLog(`Advertise failed: ${e.error ?? 'code ' + e.errorCode}`)),
      bleEmitter.addListener('BleGattServerStarted', () => { setServerRunning(true); addLog('GATT server ready (listening for connections)') }),
      bleEmitter.addListener('BleGattClientConnected',    e => addLog(`GATT: peer connected → ${e.address.slice(-8)}`)),
      bleEmitter.addListener('BleGattClientDisconnected', e => addLog(`GATT: peer disconnected → ${e.address.slice(-8)}`)),
      bleEmitter.addListener('BleGattConnected',          e => { setConnected(p => ({...p, [e.address]: true})); addLog(`GATT: connected to ${e.address.slice(-8)}`) }),
      bleEmitter.addListener('BleGattDisconnected',       e => { setConnected(p => ({...p, [e.address]: false})); addLog(`GATT: disconnected from ${e.address.slice(-8)}`) }),
      bleEmitter.addListener('BleGattMtu', e => addLog(`GATT: MTU=${e.mtu} on ${e.address.slice(-8)}`)),
      bleEmitter.addListener('BleGattServicesDiscovered', e => {
        addLog(`GATT: services discovered — Blink: ${e.hasBlinkService ? '✓' : '✗'}`)
        if (e.hasBlinkService) sendTestPayload(e.address)
      }),
      bleEmitter.addListener('BleGattData', e => addLog(`📨 DATA from ${e.from.slice(-8)}: "${e.data}"`)),
    ]
    return () => {
      subs.forEach(s => s.remove())
      clearTimeout(scanTimer.current)
      BleModule.stopGattServer()
    }
  }, [])

  async function sendTestPayload(address) {
    try {
      await BleModule.writeGatt(address, '{"t":"hello","v":1}')
      addLog(`Sent hello to ${address.slice(-8)}`)
    } catch (e) {
      addLog(`Write failed: ${e.message}`)
    }
  }

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

  const deviceList = Object.values(devices).sort((a, b) => b.rssi - a.rssi)
  const blinkPeers = deviceList.filter(d => d.isBlink)

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>BLE Mesh — Phase 2: GATT</Text>
      <Text style={styles.sub}>
        State: {bleState} · Server: {serverRunning ? '✓' : '…'}
      </Text>

      <View style={styles.btnRow}>
        <TouchableOpacity style={[styles.btn, scanning && styles.btnOff]} onPress={scanning ? () => BleModule.stopScan() : startScan}>
          <Text style={styles.btnTxt}>{scanning ? '⏹ Stop' : '▶ Scan'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, advertising && styles.btnOff, { backgroundColor: advertising ? '#333' : '#1a4a1a', borderColor: advertising ? '#555' : '#2a8a2a' }]}
          onPress={() => advertising ? BleModule.stopAdvertise() : BleModule.startAdvertise()}>
          <Text style={styles.btnTxt}>{advertising ? '⏹ Stop' : '📡 Advertise'}</Text>
        </TouchableOpacity>
      </View>

      {blinkPeers.length > 0 && (
        <View style={styles.peersSection}>
          <Text style={styles.sectionLabel}>★ Blink peers — tap to connect + sync</Text>
          {blinkPeers.map(d => (
            <TouchableOpacity
              key={d.id}
              style={[styles.peerRow, connected[d.id] && styles.peerConnected]}
              onPress={() => connected[d.id] ? BleModule.disconnectGatt(d.id) : BleModule.connectGatt(d.id)}
            >
              <Text style={styles.peerName}>★ {d.name || '(unnamed)'}</Text>
              <Text style={styles.peerMeta}>{d.id.slice(-8)} · {d.rssi} dBm</Text>
              <Text style={styles.peerAction}>{connected[d.id] ? 'Disconnect' : 'Connect'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.sectionLabel}>All nearby: {deviceList.length}</Text>
      {deviceList.filter(d => !d.isBlink).map(d => (
        <View key={d.id} style={styles.deviceRow}>
          <Text style={styles.deviceName}>{d.name || '(unnamed)'}</Text>
          <Text style={styles.deviceMeta}>{d.id.slice(-8)} · {d.rssi} dBm</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Log</Text>
      <ScrollView style={styles.logBox}>
        {log.map((l, i) => <Text key={i} style={[styles.logLine, l.includes('DATA') && styles.logData]}>{l}</Text>)}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 50 },
  back:         { marginBottom: 8 },
  backText:     { color: '#4f6ef7', fontSize: 16 },
  title:        { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  sub:          { color: '#555', fontSize: 11, marginBottom: 12 },
  btnRow:       { flexDirection: 'row', gap: 10, marginBottom: 12 },
  btn:          { flex: 1, backgroundColor: '#4f6ef7', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#4f6ef7' },
  btnOff:       { backgroundColor: '#333', borderColor: '#555' },
  btnTxt:       { color: '#fff', fontWeight: '700', fontSize: 14 },
  peersSection: { marginBottom: 12 },
  peerRow:      { backgroundColor: '#1a2a4a', borderRadius: 8, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#4f6ef7', flexDirection: 'row', alignItems: 'center' },
  peerConnected:{ borderColor: '#34c759', backgroundColor: '#1a2a1a' },
  peerName:     { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  peerMeta:     { color: '#888', fontSize: 11 },
  peerAction:   { color: '#4f6ef7', fontSize: 12, fontWeight: '700', marginLeft: 8 },
  sectionLabel: { color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  deviceRow:    { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 8, marginBottom: 4 },
  deviceName:   { color: '#ccc', fontSize: 13 },
  deviceMeta:   { color: '#555', fontSize: 11 },
  logBox:       { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 10, marginTop: 8 },
  logLine:      { color: '#aaa', fontSize: 11, fontFamily: 'monospace', marginBottom: 2 },
  logData:      { color: '#34c759', fontWeight: '600' },
})
