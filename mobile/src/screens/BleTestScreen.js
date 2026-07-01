import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  PermissionsAndroid, Platform, NativeModules, NativeEventEmitter,
} from 'react-native'

const { BleModule } = NativeModules
const bleEmitter = BleModule ? new NativeEventEmitter(BleModule) : null

const BLINK_UUID = '0000b11c-0000-1000-8000-00805f9b34fb'

export default function BleTestScreen({ navigation }) {
  const [log, setLog] = useState([])
  const [scanning, setScanning] = useState(false)
  const [bleState, setBleState] = useState('Unknown')
  const [devices, setDevices] = useState({})
  const scanTimer = useRef(null)

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [`[${ts}] ${msg}`, ...prev.slice(0, 49)])
  }

  useEffect(() => {
    if (!BleModule) { addLog('BleModule not found — check native registration'); return }
    BleModule.getState().then(s => { setBleState(s); addLog(`BLE state: ${s}`) }).catch(e => addLog(`getState error: ${e.message}`))

    const subs = [
      bleEmitter.addListener('BleDeviceFound', d => {
        setDevices(prev => {
          if (prev[d.id]) return prev
          addLog(`Found: ${d.name || '(unnamed)'} | ${d.id.slice(-8)} | ${d.rssi} dBm${d.isBlink ? ' ★ BLINK' : ''}`)
          return { ...prev, [d.id]: d }
        })
      }),
      bleEmitter.addListener('BleScanStarted', () => { addLog('Scan started'); setScanning(true) }),
      bleEmitter.addListener('BleScanStopped', () => { addLog('Scan stopped'); setScanning(false) }),
      bleEmitter.addListener('BleScanFailed', e => { addLog(`Scan failed: ${e.error ?? 'code ' + e.errorCode}`); setScanning(false) }),
    ]
    return () => { subs.forEach(s => s.remove()); clearTimeout(scanTimer.current) }
  }, [])

  async function requestPermissions() {
    const api = parseInt(Platform.Version, 10)
    addLog(`Android API: ${api}`)
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ])
      const ok = Object.values(res).every(r => r === PermissionsAndroid.RESULTS.GRANTED)
      addLog(`BLE perms: ${ok ? '✓ GRANTED' : '✗ DENIED'}`)
      return ok
    }
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      { title: 'Location', message: 'Needed for BLE scan on Android < 12', buttonPositive: 'Allow' }
    )
    const ok = res === PermissionsAndroid.RESULTS.GRANTED
    addLog(`Location perm: ${ok ? '✓ GRANTED' : '✗ DENIED'}`)
    return ok
  }

  async function startScan() {
    const ok = await requestPermissions()
    if (!ok) return
    setDevices({})
    BleModule.startScan()
    scanTimer.current = setTimeout(() => { BleModule.stopScan() }, 15000)
  }

  function stopScan() {
    clearTimeout(scanTimer.current)
    BleModule.stopScan()
  }

  const deviceList = Object.values(devices).sort((a, b) => b.rssi - a.rssi)

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>BLE Phase 0 — Custom Native Module</Text>
      <Text style={styles.sub}>State: {bleState}  |  Blink UUID: 0000b11c…</Text>

      <TouchableOpacity style={[styles.btn, scanning && styles.btnScanning]} onPress={scanning ? stopScan : startScan}>
        <Text style={styles.btnText}>{scanning ? '⏹ Stop Scan' : '▶ Start 15s Scan'}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>
        Nearby BLE devices: {deviceList.length}
        {deviceList.filter(d => d.isBlink).length > 0 ? ` (${deviceList.filter(d => d.isBlink).length} Blink!)` : ''}
      </Text>
      {deviceList.map(d => (
        <View key={d.id} style={[styles.deviceRow, d.isBlink && styles.blinkRow]}>
          <Text style={styles.deviceName}>{d.isBlink ? '★ ' : ''}{d.name || '(unnamed)'}</Text>
          <Text style={styles.deviceMeta}>{d.id.slice(-8)} · {d.rssi} dBm</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Log</Text>
      <ScrollView style={styles.logBox}>
        {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 50 },
  back:        { marginBottom: 8 },
  backText:    { color: '#4f6ef7', fontSize: 16 },
  title:       { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sub:         { color: '#555', fontSize: 11, marginBottom: 16 },
  btn:         { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 16 },
  btnScanning: { backgroundColor: '#333' },
  btnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionLabel:{ color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  deviceRow:   { backgroundColor: '#1a1a1a', borderRadius: 8, padding: 10, marginBottom: 6 },
  blinkRow:    { borderColor: '#4f6ef7', borderWidth: 1 },
  deviceName:  { color: '#fff', fontSize: 14, fontWeight: '500' },
  deviceMeta:  { color: '#555', fontSize: 11, marginTop: 2 },
  logBox:      { flex: 1, backgroundColor: '#111', borderRadius: 8, padding: 10 },
  logLine:     { color: '#aaa', fontSize: 11, fontFamily: 'monospace', marginBottom: 2 },
})
