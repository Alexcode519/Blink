import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  PermissionsAndroid, Platform,
} from 'react-native'
import { BleManager } from 'react-native-ble-plx'

// Blink-specific service UUID for peer discovery (will be used when advertising is implemented)
const BLINK_SERVICE_UUID = '0000b11c-0000-1000-8000-00805f9b34fb'

export default function BleTestScreen({ navigation }) {
  const [log, setLog] = useState([])
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState({})
  const manager = useRef(null)

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [`[${ts}] ${msg}`, ...prev.slice(0, 49)])
  }

  useEffect(() => {
    manager.current = new BleManager()
    manager.current.onStateChange((state) => {
      addLog(`BLE manager state: ${state}`)
    }, true)
    return () => {
      manager.current?.stopDeviceScan()
      manager.current?.destroy()
    }
  }, [])

  async function requestPermissions() {
    const apiLevel = parseInt(Platform.Version, 10)
    addLog(`Android API level: ${apiLevel}`)

    if (apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ])
      const granted = Object.values(results).every(r => r === PermissionsAndroid.RESULTS.GRANTED)
      addLog(`BLE perms (API 31+): ${granted ? '✓ GRANTED' : '✗ DENIED'}`)
      return granted
    } else {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'Blink needs location access to scan for nearby devices via Bluetooth LE.',
          buttonPositive: 'Allow',
        }
      )
      const granted = result === PermissionsAndroid.RESULTS.GRANTED
      addLog(`Location perm (needed for BLE on API < 31): ${granted ? '✓ GRANTED' : '✗ DENIED'}`)
      return granted
    }
  }

  async function startScan() {
    const ok = await requestPermissions()
    if (!ok) {
      addLog('Cannot scan without permissions.')
      return
    }

    setDevices({})
    setScanning(true)
    addLog('Starting 15s BLE scan (all services)...')

    manager.current.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err) {
        addLog(`Scan error: ${err.reason ?? err.message}`)
        setScanning(false)
        return
      }
      if (device) {
        const isBlinkPeer = device.serviceUUIDs?.some(u =>
          u.toLowerCase() === BLINK_SERVICE_UUID
        )
        const label = device.name ?? device.localName ?? '(unnamed)'
        setDevices(prev => {
          if (prev[device.id]) return prev
          addLog(`Found: ${label} | ${device.id.slice(-8)} | ${device.rssi} dBm${isBlinkPeer ? ' ★ BLINK' : ''}`)
          return { ...prev, [device.id]: { name: label, rssi: device.rssi, isBlink: isBlinkPeer } }
        })
      }
    })

    setTimeout(() => {
      manager.current?.stopDeviceScan()
      setScanning(false)
      const count = Object.keys(devices).length
      addLog(`Scan complete. Found ${count} device(s).`)
    }, 15000)
  }

  function stopScan() {
    manager.current?.stopDeviceScan()
    setScanning(false)
    addLog(`Scan stopped. Found ${Object.keys(devices).length} device(s).`)
  }

  const deviceList = Object.entries(devices)

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>BLE Spike — Phase 0</Text>
      <Text style={styles.sub}>Scanning with react-native-ble-plx</Text>

      <TouchableOpacity
        style={[styles.btn, scanning && styles.btnScanning]}
        onPress={scanning ? stopScan : startScan}
      >
        <Text style={styles.btnText}>{scanning ? '⏹ Stop Scan' : '▶ Start 15s Scan'}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>
        Nearby BLE devices: {deviceList.length}
        {deviceList.filter(([, d]) => d.isBlink).length > 0
          ? ` (${deviceList.filter(([, d]) => d.isBlink).length} Blink peer!)` : ''}
      </Text>
      {deviceList.sort((a, b) => b[1].rssi - a[1].rssi).map(([id, d]) => (
        <View key={id} style={[styles.deviceRow, d.isBlink && styles.blinkRow]}>
          <Text style={styles.deviceName}>{d.isBlink ? '★ ' : ''}{d.name}</Text>
          <Text style={styles.deviceMeta}>{id.slice(-8)} · {d.rssi} dBm</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Log</Text>
      <ScrollView style={styles.logBox}>
        {log.map((l, i) => (
          <Text key={i} style={styles.logLine}>{l}</Text>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 50 },
  back:        { marginBottom: 8 },
  backText:    { color: '#4f6ef7', fontSize: 16 },
  title:       { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  sub:         { color: '#555', fontSize: 12, marginBottom: 16 },
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
