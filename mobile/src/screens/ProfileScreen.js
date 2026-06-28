import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, Image, ActivityIndicator, Switch,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import RNFS from 'react-native-fs'
import { api } from '../api/client'

const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`

export default function ProfileScreen({ navigation, onLogout }) {
  const [username, setUsername]           = useState('')
  const [newUsername, setNewUsername]     = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [avatarUri, setAvatarUri]         = useState(null)
  const [joinedDate, setJoinedDate]       = useState('')
  const [loading, setLoading]             = useState(false)
  const [patternEnabled, setPatternEnabled] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => {
      setUsername(u ?? '')
      setNewUsername(u ?? '')
    })
    loadAvatar()
    AsyncStorage.getItem('blink_pattern_enabled').then(v => setPatternEnabled(v === 'true'))
    api.get('/users/me/profile').then(p => {
      if (p.created_at) {
        setJoinedDate(new Date(p.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
      }
    }).catch(() => {})
  }, [])

  async function loadAvatar() {
    const exists = await RNFS.exists(AVATAR_PATH)
    if (exists) setAvatarUri(`file://${AVATAR_PATH}?t=${Date.now()}`)
  }

  async function pickAvatar() {
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.5, maxWidth: 400, maxHeight: 400 })
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await RNFS.writeFile(AVATAR_PATH, base64, 'base64')
    setAvatarUri(`file://${AVATAR_PATH}?t=${Date.now()}`)
    try {
      await api.post('/users/me/avatar', { avatar: base64 })
      Alert.alert('Profile photo updated', 'Your photo is now visible to others.')
    } catch (e) {
      Alert.alert('Upload failed', e.message)
    }
  }

  async function saveUsername() {
    const trimmed = newUsername.trim()
    if (!trimmed || trimmed === username) return
    setLoading(true)
    try {
      const { token, username: updated } = await api.patch('/users/me/username', { username: trimmed })
      await AsyncStorage.setItem('token', token)
      await AsyncStorage.setItem('username', updated)
      setUsername(updated)
      setNewUsername(updated)
      Alert.alert('Updated', 'Username changed successfully.')
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  async function savePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) return
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      await api.patch('/users/me/password', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      Alert.alert('Updated', 'Password changed successfully.')
    } catch (err) {
      Alert.alert('Error', err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out', style: 'destructive', onPress: () => {
          AsyncStorage.clear().then(() => {
            onLogout()
          })
        },
      },
    ])
  }

  const initials = username ? username[0].toUpperCase() : '?'

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Back button */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      {/* Avatar */}
      <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <View style={styles.avatarBadge}><Text style={styles.avatarBadgeText}>Edit</Text></View>
      </TouchableOpacity>

      <Text style={styles.displayName}>{username}</Text>
      {joinedDate ? <Text style={styles.joined}>Member since {joinedDate}</Text> : null}

      {/* Username section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Username</Text>
        <TextInput
          style={styles.input}
          value={newUsername}
          onChangeText={setNewUsername}
          autoCapitalize="none"
          placeholder="New username"
          placeholderTextColor="#555"
        />
        <Text style={styles.hint}>3–30 characters, letters/numbers/underscores only</Text>
        <TouchableOpacity
          style={[styles.btn, newUsername.trim() === username && styles.btnDisabled]}
          onPress={saveUsername}
          disabled={loading || newUsername.trim() === username}
        >
          <Text style={styles.btnText}>Save Username</Text>
        </TouchableOpacity>
      </View>

      {/* Password section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Change Password</Text>
        <TextInput style={styles.input} value={currentPassword} onChangeText={setCurrentPassword}
          secureTextEntry placeholder="Current password" placeholderTextColor="#555" />
        <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword}
          secureTextEntry placeholder="New password (min. 8 chars)" placeholderTextColor="#555" />
        <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword}
          secureTextEntry placeholder="Confirm new password" placeholderTextColor="#555" />
        <TouchableOpacity style={styles.btn} onPress={savePassword} disabled={loading}>
          <Text style={styles.btnText}>Save Password</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator color="#4f6ef7" style={{ marginTop: 8 }} />}

      {/* Pattern lock section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Pattern Login</Text>
            <Text style={styles.settingHint}>Unlock with a drawn pattern instead of password</Text>
          </View>
          <Switch
            value={patternEnabled}
            onValueChange={async (val) => {
              if (val) {
                navigation.navigate('SetPattern')
                // Listen for when they come back
                const unsub = navigation.addListener('focus', async () => {
                  const enabled = await AsyncStorage.getItem('blink_pattern_enabled')
                  setPatternEnabled(enabled === 'true')
                  unsub()
                })
              } else {
                await AsyncStorage.multiRemove(['blink_pattern', 'blink_pattern_enabled'])
                setPatternEnabled(false)
              }
            }}
            trackColor={{ false: '#333', true: '#4f6ef7' }}
            thumbColor="#fff"
          />
        </View>
        {patternEnabled && (
          <TouchableOpacity style={[styles.btn, { marginTop: 10, backgroundColor: '#1a1a1a' }]}
            onPress={() => navigation.navigate('SetPattern')}>
            <Text style={[styles.btnText, { color: '#4f6ef7' }]}>Change Pattern</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a' },
  content:          { padding: 24, paddingBottom: 60 },
  avatarWrap:       { alignSelf: 'center', marginBottom: 12, marginTop: 8 },
  avatar:           { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder:{ width: 90, height: 90, borderRadius: 45, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarInitials:   { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarBadge:      { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#1f1f1f', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: '#333' },
  avatarBadgeText:  { color: '#aaa', fontSize: 11 },
  displayName:      { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  joined:           { color: '#555', fontSize: 13, textAlign: 'center', marginBottom: 28 },
  section:          { marginBottom: 28 },
  sectionTitle:     { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  input:            { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15 },
  hint:             { color: '#444', fontSize: 12, marginBottom: 10, marginTop: -4 },
  btn:              { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnDisabled:      { backgroundColor: '#2a2a2a' },
  btnText:          { color: '#fff', fontWeight: '600', fontSize: 15 },
  backBtn:          { marginBottom: 16 },
  backText:         { color: '#4f6ef7', fontSize: 16 },
  settingRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14 },
  settingLabel:     { color: '#fff', fontSize: 15, fontWeight: '500' },
  settingHint:      { color: '#555', fontSize: 12, marginTop: 2 },
  logoutBtn:        { borderWidth: 1, borderColor: '#ff4444', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  logoutText:       { color: '#ff4444', fontWeight: '600', fontSize: 15 },
})
