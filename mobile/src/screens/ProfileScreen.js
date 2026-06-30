import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ScrollView, Image, ActivityIndicator, Switch, Modal, FlatList,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import RNFS from 'react-native-fs'
import { api } from '../api/client'
import { isBiometricAvailable } from '../utils/biometrics'
import { LANGUAGES, t } from '../i18n/translations'
import { FONT_SIZES, useFontSize } from '../context/FontSizeContext'

const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`

const DISAPPEARING_OPTIONS = [
  { label: '1 hour',   hours: 1 },
  { label: '5 hours',  hours: 5 },
  { label: '10 hours', hours: 10 },
  { label: '24 hours', hours: 24 },
  { label: 'Never',    hours: null },
]

export default function ProfileScreen({ navigation, onLogout, onLock }) {
  const [username, setUsername]           = useState('')
  const [newUsername, setNewUsername]     = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [avatarUri, setAvatarUri]         = useState(null)
  const [joinedDate, setJoinedDate]       = useState('')
  const [loading, setLoading]             = useState(false)
  const [patternEnabled, setPatternEnabled] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [language, setLanguage] = useState('en')
  const { fontSize, setFontSizeKey } = useFontSize()
  const [fontSizeKey, setLocalFontSizeKey] = useState('medium')
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false)
  const [langModalOpen, setLangModalOpen] = useState(false)
  const [disappearingEnabled, setDisappearingEnabled] = useState(false)
  const [disappearingHours, setDisappearingHours] = useState(null)
  const [disappearingDropdownOpen, setDisappearingDropdownOpen] = useState(false)
  const [duressSet, setDuressSet] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => {
      setUsername(u ?? '')
      setNewUsername(u ?? '')
    })
    loadAvatar()
    AsyncStorage.getItem('blink_pattern_enabled').then(v => setPatternEnabled(v === 'true'))
    AsyncStorage.getItem('blink_duress_pattern').then(v => setDuressSet(!!v))
    const unsub = navigation.addListener('focus', () => {
      AsyncStorage.getItem('blink_duress_pattern').then(v => setDuressSet(!!v))
    })
    AsyncStorage.getItem('blink_biometric_enabled').then(v => setBiometricEnabled(v === 'true'))
    AsyncStorage.getItem('blink_language').then(v => { if (v) setLanguage(v) })
    AsyncStorage.getItem('blink_font_size').then(v => { if (v) setLocalFontSizeKey(v) })
    isBiometricAvailable().then(({ available }) => setBiometricAvailable(available))
    api.get('/users/me/profile').then(p => {
      if (p.created_at) {
        setJoinedDate(new Date(p.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
      }
      if (p.disappearingHours) {
        setDisappearingEnabled(true)
        setDisappearingHours(p.disappearingHours)
      }
    }).catch(() => {})
    return unsub
  }, [])

  async function setDisappearing(hours) {
    setDisappearingHours(hours)
    try { await api.put('/users/me/disappearing', { hours }) } catch (e) { Alert.alert('Error', e.message) }
  }

  function toggleDisappearing(value) {
    setDisappearingEnabled(value)
    if (value) {
      setDisappearingDropdownOpen(true)
    } else {
      setDisappearingHours(null)
      setDisappearing(null)
    }
  }

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
      await api.post('/profile/avatar', { avatar: base64 })
      Alert.alert('Profile photo updated', 'Your photo is now visible to others.')
    } catch (e) {
      Alert.alert('Upload failed', e.message)
    }
  }

  async function saveUsername() {
    const trimmed = newUsername.trim()
    if (!trimmed || trimmed === username) return
    Alert.alert(
      'Rename username?',
      `Change your username from "${username}" to "${trimmed}"?`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => {} },
        { text: 'Confirm', onPress: () => doSaveUsername(trimmed) },
      ]
    )
  }

  async function doSaveUsername(trimmed) {
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

  function handleLock() {
    onLock()
  }

  function handleLogout() {
    Alert.alert('Sign out', 'This will sign you out completely. You will need your password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: () => {
          AsyncStorage.multiRemove(['token', 'username']).then(() => {
            onLogout()
          })
        },
      },
    ])
  }

  const initials = username ? username[0].toUpperCase() : '?'
  const currentLang = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0]

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Language picker modal */}
      <Modal visible={langModalOpen} transparent animationType="slide" onRequestClose={() => setLangModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t(language, 'selectLanguage')}</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={l => l.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.langRow, item.code === language && styles.langRowActive]}
                  onPress={async () => {
                    setLanguage(item.code)
                    await AsyncStorage.setItem('blink_language', item.code)
                    setLangModalOpen(false)
                  }}
                >
                  <Text style={styles.langFlag}>{item.flag}</Text>
                  <Text style={[styles.langName, item.code === language && styles.langNameActive]}>{item.name}</Text>
                  {item.code === language && <Text style={styles.langCheck}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setLangModalOpen(false)}>
              <Text style={styles.modalCloseText}>{t(language, 'cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={fontDropdownOpen} transparent animationType="slide" onRequestClose={() => setFontDropdownOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Text Size</Text>
            <FlatList
              data={FONT_SIZES}
              keyExtractor={f => f.key}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.langRow, item.key === fontSizeKey && styles.langRowActive]}
                  onPress={() => {
                    setLocalFontSizeKey(item.key)
                    setFontSizeKey(item.key)
                    setFontDropdownOpen(false)
                  }}
                >
                  <Text style={[styles.langName, { fontSize: item.size }, item.key === fontSizeKey && styles.langNameActive]}>{item.label}</Text>
                  {item.key === fontSizeKey && <Text style={styles.langCheck}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setFontDropdownOpen(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={disappearingDropdownOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setDisappearingDropdownOpen(false)
          if (!disappearingHours) setDisappearingEnabled(false)
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Clear chats after</Text>
            <FlatList
              data={DISAPPEARING_OPTIONS}
              keyExtractor={o => o.label}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.langRow, item.hours === disappearingHours && styles.langRowActive]}
                  onPress={() => {
                    setDisappearing(item.hours)
                    setDisappearingDropdownOpen(false)
                  }}
                >
                  <Text style={[styles.langName, item.hours === disappearingHours && styles.langNameActive]}>{item.label}</Text>
                  {item.hours === disappearingHours && <Text style={styles.langCheck}>✓</Text>}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => {
                setDisappearingDropdownOpen(false)
                if (!disappearingHours) setDisappearingEnabled(false)
              }}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Back button */}
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>{t(language, 'back')}</Text>
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
        <Text style={styles.sectionTitle}>{t(language, 'username')}</Text>
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
          <Text style={styles.btnText}>{t(language, 'saveUsername')}</Text>
        </TouchableOpacity>
      </View>

      {/* Password section */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.collapseRow} onPress={() => setPasswordOpen(o => !o)}>
          <Text style={styles.sectionTitle}>Change Password</Text>
          <View style={styles.collapseRight}>
            <TouchableOpacity
              onPress={() => Alert.alert(
                'Forgotten your password?',
                'If you have forgotten your password you will need to sign out and create a new profile.',
                [{ text: 'OK' }]
              )}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.helpIcon}>?</Text>
            </TouchableOpacity>
            <Text style={styles.chevron}>{passwordOpen ? '▲' : '▼'}</Text>
          </View>
        </TouchableOpacity>
        {passwordOpen && (
          <>
            <TextInput style={styles.input} value={currentPassword} onChangeText={setCurrentPassword}
              secureTextEntry placeholder="Current password" placeholderTextColor="#555" />
            <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword}
              secureTextEntry placeholder="New password (min. 8 chars)" placeholderTextColor="#555" />
            <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword}
              secureTextEntry placeholder="Confirm new password" placeholderTextColor="#555" />
            <TouchableOpacity style={styles.btn} onPress={savePassword} disabled={loading}>
              <Text style={styles.btnText}>Save Password</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {loading && <ActivityIndicator color="#4f6ef7" style={{ marginTop: 8 }} />}

      {/* Language section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t(language, 'language')}</Text>
        <TouchableOpacity style={styles.langSelector} onPress={() => setLangModalOpen(true)}>
          <Text style={styles.langSelectorFlag}>{currentLang.flag}</Text>
          <Text style={styles.langSelectorName}>{currentLang.name}</Text>
          <Text style={styles.langSelectorChevron}>▼</Text>
        </TouchableOpacity>
      </View>

      {/* Security section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t(language, 'security')}</Text>

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>{t(language, 'biometric')}</Text>
            <Text style={styles.settingHint}>
              {biometricAvailable ? t(language, 'biometricHint') : 'Not available on this device'}
            </Text>
          </View>
          <Switch
            value={biometricEnabled}
            disabled={!biometricAvailable}
            onValueChange={async (val) => {
              if (!biometricAvailable) {
                Alert.alert('Not available', 'This device does not support biometric unlock.')
                return
              }
              await AsyncStorage.setItem('blink_biometric_enabled', val ? 'true' : 'false')
              setBiometricEnabled(val)
            }}
            trackColor={{ false: '#333', true: '#4f6ef7' }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.settingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>{t(language, 'patternLogin')}</Text>
            <Text style={styles.settingHint}>{t(language, 'patternHint')}</Text>
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
                await AsyncStorage.multiRemove(['blink_pattern', 'blink_pattern_enabled', 'blink_duress_pattern'])
                setPatternEnabled(false)
                setDuressSet(false)
              }
            }}
            trackColor={{ false: '#333', true: '#4f6ef7' }}
            thumbColor="#fff"
          />
        </View>
        {patternEnabled && (
          <TouchableOpacity style={[styles.btn, { marginTop: 10, backgroundColor: '#1a1a1a' }]}
            onPress={() => navigation.navigate('SetPattern')}>
            <Text style={[styles.btnText, { color: '#4f6ef7' }]}>{t(language, 'changePattern')}</Text>
          </TouchableOpacity>
        )}
        {patternEnabled && (
          <>
            <Text style={[styles.settingHint, { marginTop: 14 }]}>
              A duress pattern looks just like a normal unlock but silently wipes locally cached chats —
              useful if you're ever forced to unlock the app.
            </Text>
            <TouchableOpacity
              style={[styles.btn, { marginTop: 10, backgroundColor: '#1a1a1a' }]}
              onPress={() => navigation.navigate('SetPattern', { mode: 'duress' })}
            >
              <Text style={[styles.btnText, { color: '#ff8c00' }]}>
                {duressSet ? 'Change Duress Pattern' : 'Set Duress Pattern'}
              </Text>
            </TouchableOpacity>
            {duressSet && (
              <TouchableOpacity
                style={{ marginTop: 10, alignItems: 'center' }}
                onPress={async () => {
                  await AsyncStorage.removeItem('blink_duress_pattern')
                  setDuressSet(false)
                }}
              >
                <Text style={{ color: '#666', fontSize: 13 }}>Remove duress pattern</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Text size */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Text Size</Text>
        <TouchableOpacity style={styles.langSelector} onPress={() => setFontDropdownOpen(true)}>
          <Text style={styles.langValue}>{FONT_SIZES.find(f => f.key === fontSizeKey)?.label ?? 'Medium'}</Text>
          <Text style={styles.langChevron}>▼</Text>
        </TouchableOpacity>
        <Text style={[styles.fontSizePreview, { fontSize }]}>Preview: This is how your messages will look.</Text>
      </View>

      {/* Disappearing messages */}
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Disappearing Messages</Text>
          <Switch
            value={disappearingEnabled}
            onValueChange={toggleDisappearing}
            trackColor={{ false: '#333', true: '#4f6ef7' }}
            thumbColor="#fff"
          />
        </View>
        {disappearingEnabled && (
          <TouchableOpacity style={[styles.langSelector, { marginTop: 10 }]} onPress={() => setDisappearingDropdownOpen(true)}>
            <Text style={styles.langValue}>{DISAPPEARING_OPTIONS.find(o => o.hours === disappearingHours)?.label ?? 'Never'}</Text>
            <Text style={styles.langChevron}>▼</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Help section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Help</Text>
        <TouchableOpacity style={styles.helpRow} onPress={() => navigation.navigate('FAQ')}>
          <Text style={styles.helpIcon2}>❓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpRowLabel}>Frequently Asked Questions</Text>
            <Text style={styles.helpRowHint}>Answers to common questions about Blink</Text>
          </View>
          <Text style={styles.helpChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.helpRow, { marginTop: 10 }]} onPress={() => navigation.navigate('Feedback')}>
          <Text style={styles.helpIcon2}>💬</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.helpRowLabel}>Send Feedback</Text>
            <Text style={styles.helpRowHint}>Report a bug or suggest an improvement</Text>
          </View>
          <Text style={styles.helpChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Lock / Sign out */}
      {(patternEnabled || biometricEnabled) ? (
        <>
          <TouchableOpacity style={styles.lockBtn} onPress={handleLock}>
            <Text style={styles.lockText}>{t(language, 'lockApp')}</Text>
          </TouchableOpacity>
          <Text style={styles.signOutHint}>Disable all security locks to enable Sign Out</Text>
        </>
      ) : (
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t(language, 'signOut')}</Text>
        </TouchableOpacity>
      )}

    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a' },
  content:          { padding: 20, paddingBottom: 60, gap: 0 },
  avatarWrap:       { alignSelf: 'center', marginBottom: 12, marginTop: 8 },
  avatar:           { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder:{ width: 90, height: 90, borderRadius: 45, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarInitials:   { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarBadge:      { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#1f1f1f', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: '#333' },
  avatarBadgeText:  { color: '#aaa', fontSize: 11 },
  displayName:      { color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  joined:           { color: '#555', fontSize: 13, textAlign: 'center', marginBottom: 28 },
  section:          { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  sectionTitle:     { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  rowBetween:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  collapseRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  collapseRight:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  helpIcon:         { color: '#fff', fontSize: 13, fontWeight: '700', backgroundColor: '#333', borderRadius: 10, width: 20, height: 20, textAlign: 'center', lineHeight: 20 },
  chevron:          { color: '#555', fontSize: 12, marginBottom: 12 },
  input:            { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, padding: 14, marginBottom: 10, fontSize: 15 },
  hint:             { color: '#444', fontSize: 12, marginBottom: 10, marginTop: -4 },
  btn:              { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnDisabled:      { backgroundColor: '#2a2a2a' },
  btnText:          { color: '#fff', fontWeight: '600', fontSize: 15 },
  backBtn:          { marginBottom: 16 },
  backText:         { color: '#4f6ef7', fontSize: 16 },
  settingRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 12 },
  settingLabel:     { color: '#fff', fontSize: 15, fontWeight: '500' },
  settingHint:      { color: '#555', fontSize: 12, marginTop: 2 },
  lockBtn:          { borderWidth: 1, borderColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 10 },
  lockText:         { color: '#4f6ef7', fontWeight: '600', fontSize: 15 },
  signOutHint:      { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 10 },
  logoutBtn:        { borderWidth: 1, borderColor: '#ff4444', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 10 },
  logoutText:       { color: '#ff4444', fontWeight: '600', fontSize: 15 },
  fontSizePreview:     { color: '#555', marginTop: 14, lineHeight: 22 },
  helpRow:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, gap: 12 },
  helpIcon2:        { fontSize: 20 },
  helpRowLabel:     { color: '#fff', fontSize: 15, fontWeight: '500' },
  helpRowHint:      { color: '#555', fontSize: 12, marginTop: 2 },
  helpChevron:      { color: '#444', fontSize: 20 },
  langSelector:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, gap: 12 },
  langValue:        { color: '#fff', fontSize: 15 },
  langChevron:      { color: '#888', fontSize: 12 },
  langSelectorFlag: { fontSize: 22 },
  langSelectorName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '500' },
  langSelectorChevron: { color: '#555', fontSize: 12 },
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard:        { backgroundColor: '#111', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 20, paddingBottom: 40, maxHeight: '80%' },
  modalTitle:       { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 16, paddingHorizontal: 24 },
  langRow:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 14 },
  langRowActive:    { backgroundColor: '#1a2a4a' },
  langFlag:         { fontSize: 24 },
  langName:         { flex: 1, color: '#ccc', fontSize: 16 },
  langNameActive:   { color: '#fff', fontWeight: '600' },
  langCheck:        { color: '#4f6ef7', fontSize: 16, fontWeight: '700' },
  modalClose:       { marginHorizontal: 24, marginTop: 12, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalCloseText:   { color: '#888', fontWeight: '600', fontSize: 15 },
})
