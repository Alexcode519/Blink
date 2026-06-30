import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Image, Modal, Pressable, PermissionsAndroid,
} from 'react-native'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import { useFontSize } from '../context/FontSizeContext'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary, launchCamera } from 'react-native-image-picker'
import { pick, isCancel, types } from '@react-native-documents/picker'
import { pickerGuard } from '../utils/pickerGuard'
import RNFS from 'react-native-fs'
import Video from 'react-native-video'
import { api } from '../api/client'
import { decryptGroupKey, encryptWithGroupKey, decryptWithGroupKey } from '../crypto/keys'
import Icon from 'react-native-vector-icons/Feather'
import notifee from '@notifee/react-native'
import { setActiveChat, clearActiveChat } from '../notifications/activeChat'
import { notifIdForGroup } from '../notifications/setup'

const POLL_INTERVAL = 3000

export default function GroupChatScreen({ route, navigation }) {
  const { groupId, groupName: initName } = route.params
  const { fontSize } = useFontSize()

  const [messages, setMessages]     = useState([])
  const [text, setText]             = useState('')
  const [groupName, setGroupName]   = useState(initName ?? 'Group')
  const [members, setMembers]       = useState([])
  const [myUsername, setMyUsername] = useState('')
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  const [isRecording, setIsRecording]   = useState(false)
  const [recordSecs, setRecordSecs]     = useState(0)
  const recordSecsRef                   = useRef(0)
  const [playingId, setPlayingId]       = useState(null)
  const [playbackPos, setPlaybackPos]   = useState(0)
  const [playbackDur, setPlaybackDur]   = useState(0)
  const audioRecorder = useRef(new AudioRecorderPlayer()).current

  const groupKeyRef   = useRef(null)   // Uint8Array once decrypted
  const latestAtRef   = useRef(null)   // ISO string of last received message
  const listRef       = useRef(null)
  const inputRef      = useRef(null)

  // ── Bootstrap: load group info + decrypt group key ─────────────────────────
  useEffect(() => {
    let inboxTimer, pollTimer
    async function init() {
      const me = await AsyncStorage.getItem('username')
      setMyUsername(me ?? '')

      try {
        const group = await api.get(`/groups/${groupId}`)
        setGroupName(group.name)
        setMembers(group.members ?? [])

        const keyBytes = await decryptGroupKey(
          group.myEncryptedGroupKey,
          group.myKeyNonce,
          group.keySenderPublicKey
        )
        groupKeyRef.current = keyBytes
      } catch (e) {
        Alert.alert('Error', 'Could not load group: ' + e.message)
        navigation.goBack()
        return
      }

      await loadHistory()
      inboxTimer = setInterval(pollInbox, POLL_INTERVAL)
    }

    init()
    notifee.cancelNotification(notifIdForGroup(groupId)).catch(() => {})
    setActiveChat(`group:${groupId}`)
    const focusSub = navigation.addListener('focus', () => setActiveChat(`group:${groupId}`))
    const blurSub  = navigation.addListener('blur', () => clearActiveChat())

    return () => {
      clearInterval(inboxTimer)
      focusSub(); blurSub()
      clearActiveChat()
    }
  }, [])

  // ── Decrypt a single raw message row ───────────────────────────────────────
  function decryptRow(m) {
    if (!groupKeyRef.current) return null
    try {
      const payload = decryptWithGroupKey(m.ciphertext, m.nonce, groupKeyRef.current)
      const parsed  = JSON.parse(payload)
      return {
        id:          m.id,
        sender:      m.sender_username,
        mine:        m.sender_username === myUsername || false,
        contentType: m.content_type,
        createdAt:   m.created_at,
        ...parsed,
      }
    } catch {
      return {
        id:          m.id,
        sender:      m.sender_username,
        mine:        false,
        contentType: 'text',
        createdAt:   m.created_at,
        text:        '🔒 Encrypted message',
      }
    }
  }

  const loadHistory = useCallback(async () => {
    try {
      const { messages: raw } = await api.get(`/groups/${groupId}/messages`)
      const me = await AsyncStorage.getItem('username')
      const decrypted = raw
        .map(m => ({ ...decryptRow(m), mine: m.sender_username === me }))
        .filter(Boolean)
      setMessages(decrypted)
      if (raw.length) latestAtRef.current = raw[raw.length - 1].created_at
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 150)
    } catch {}
  }, [groupId])

  const pollInbox = useCallback(async () => {
    if (!groupKeyRef.current) return
    const since = latestAtRef.current
    if (!since) return
    try {
      const me = await AsyncStorage.getItem('username')
      const { messages: raw } = await api.get(`/groups/${groupId}/messages/since/${encodeURIComponent(since)}`)
      if (!raw.length) return
      const decrypted = raw
        .map(m => ({ ...decryptRow(m), mine: m.sender_username === me }))
        .filter(Boolean)
      setMessages(prev => {
        const ids = new Set(prev.map(m => m.id))
        const fresh = decrypted.filter(m => !ids.has(m.id))
        return fresh.length ? [...prev, ...fresh] : prev
      })
      latestAtRef.current = raw[raw.length - 1].created_at
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    } catch {}
  }, [groupId])

  // ── Send helpers ────────────────────────────────────────────────────────────
  async function sendPayload(payload, contentType) {
    if (!groupKeyRef.current) return
    const { ciphertext, nonce } = encryptWithGroupKey(JSON.stringify(payload), groupKeyRef.current)
    const { messageId, createdAt } = await api.post(`/groups/${groupId}/messages`, { ciphertext, nonce, contentType })
    const me = await AsyncStorage.getItem('username')
    const newMsg = { id: messageId, sender: me, mine: true, contentType, createdAt, ...payload }
    setMessages(prev => [...prev, newMsg])
    latestAtRef.current = createdAt
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
  }

  async function sendText() {
    const t = text.trim()
    if (!t) return
    setText('')
    try {
      await sendPayload({ text: t }, 'text')
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }

  // ── Attachments ─────────────────────────────────────────────────────────────
  async function pickImage(useCamera) {
    setShowAttachMenu(false)
    pickerGuard.begin()
    try {
      const result = useCamera
        ? await launchCamera({ mediaType: 'photo', quality: 0.7, includeBase64: true })
        : await launchImageLibrary({ mediaType: 'photo', quality: 0.7, includeBase64: true })
      if (result.didCancel || !result.assets?.length) return
      const asset = result.assets[0]
      await sendPayload({ uri: `data:image/jpeg;base64,${asset.base64}` }, 'image')
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      pickerGuard.end()
    }
  }

  async function pickDocument() {
    setShowAttachMenu(false)
    pickerGuard.begin()
    try {
      const [file] = await pick({ type: [types.allFiles] })
      if (!file) return
      const content = await RNFS.readFile(file.uri.replace('file://', ''), 'base64')
      await sendPayload({ uri: `data:application/octet-stream;base64,${content}`, filename: file.name }, 'document')
    } catch (e) {
      if (!isCancel(e)) Alert.alert('Error', e.message)
    } finally {
      pickerGuard.end()
    }
  }

  // ── Voice notes ─────────────────────────────────────────────────────────────
  function formatSecs(s) {
    const m = Math.floor(s / 60); const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  async function startRecording() {
    try {
      if (PermissionsAndroid) {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) { Alert.alert('Permission denied'); return }
      }
      const path = `${RNFS.CachesDirectoryPath}/grp_voice_${Date.now()}.mp4`
      await audioRecorder.startRecorder(path)
      audioRecorder.addRecordBackListener(e => {
        const s = Math.floor((e.currentPosition ?? 0) / 1000)
        recordSecsRef.current = s
        setRecordSecs(s)
      })
      setIsRecording(true)
    } catch (e) { Alert.alert('Error', e.message) }
  }

  async function stopRecordingAndSend() {
    try {
      const path = await audioRecorder.stopRecorder()
      audioRecorder.removeRecordBackListener()
      setIsRecording(false)
      const dur = recordSecsRef.current
      recordSecsRef.current = 0; setRecordSecs(0)
      if (dur < 1) return
      const clean = path.replace('file://', '')
      const base64 = await RNFS.readFile(clean, 'base64')
      await sendPayload({ uri: `data:audio/mp4;base64,${base64}`, duration: dur }, 'audio')
    } catch (e) { Alert.alert('Error', e.message) }
  }

  function cancelRecording() {
    audioRecorder.stopRecorder().catch(() => {})
    audioRecorder.removeRecordBackListener()
    setIsRecording(false); setRecordSecs(0); recordSecsRef.current = 0
  }

  async function playAudio(item) {
    try {
      if (playingId === item.id) {
        await audioRecorder.stopPlayer(); setPlayingId(null); setPlaybackPos(0); setPlaybackDur(0); return
      }
      if (playingId) await audioRecorder.stopPlayer()
      const b64 = item.uri?.replace(/^data:audio\/[^;]+;base64,/, '')
      if (!b64) return
      const tmpPath = `${RNFS.CachesDirectoryPath}/grp_play_${item.id}.mp4`
      await RNFS.writeFile(tmpPath, b64, 'base64')
      setPlayingId(item.id); setPlaybackPos(0); setPlaybackDur(0)
      audioRecorder.addPlayBackListener(e => {
        setPlaybackPos(Math.floor((e.currentPosition ?? 0) / 1000))
        setPlaybackDur(Math.floor((e.duration ?? 0) / 1000))
        if (e.currentPosition >= e.duration && e.duration > 0) {
          setPlayingId(null); setPlaybackPos(0); setPlaybackDur(0)
        }
      })
      await audioRecorder.startPlayer(`file://${tmpPath}`)
    } catch (e) { Alert.alert('Error', e.message) }
  }

  // ── Render bubble ───────────────────────────────────────────────────────────
  function renderBubble({ item }) {
    const isAudio = item.contentType === 'audio'
    const isImage = item.contentType === 'image'
    const isVideo = item.contentType === 'video'
    const isDoc   = item.contentType === 'document'

    return (
      <View style={item.mine ? styles.mineOuter : styles.theirsOuter}>
        <View style={styles.bubbleWrap}>
          <View style={[styles.bubble, item.mine ? styles.mineBubble : styles.theirsBubble]}>
            {!item.mine && (
              <Text style={styles.senderLabel}>{item.sender}</Text>
            )}
            {isAudio && (
              <TouchableOpacity style={styles.audioBubble} onPress={() => playAudio(item)}>
                <Icon name={playingId === item.id ? 'pause-circle' : 'play-circle'} size={26} color={item.mine ? '#fff' : '#4f6ef7'} />
                <Text style={[styles.audioLabel, { color: item.mine ? '#fff' : '#ccc' }]}>
                  {playingId === item.id ? `${formatSecs(playbackPos)} / ${formatSecs(playbackDur)}` : `Voice note ${item.duration ? `(${formatSecs(item.duration)})` : ''}`}
                </Text>
              </TouchableOpacity>
            )}
            {isImage && item.uri && (
              <Image source={{ uri: item.uri }} style={styles.mediaImg} resizeMode="cover" />
            )}
            {isVideo && item.uri && (
              <Video source={{ uri: item.uri }} style={styles.mediaImg} controls paused />
            )}
            {isDoc && (
              <Text style={[styles.bubbleText, { fontSize }]}>📄 {item.filename ?? 'Document'}</Text>
            )}
            {!isAudio && !isImage && !isVideo && !isDoc && (
              <Text style={[styles.bubbleText, { fontSize }]}>{item.text}</Text>
            )}
            <Text style={styles.timestamp}>
              {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </Text>
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
          <Icon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <View style={styles.groupAvatarSmall}>
            <Icon name="users" size={16} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>{groupName}</Text>
            <Text style={styles.headerSub}>{members.length} members</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation.navigate('GroupInfo', { groupId, groupName })}
        >
          <Icon name="info" size={20} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderBubble}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {/* Attach menu */}
      {showAttachMenu && (
        <Pressable style={styles.attachBackdrop} onPress={() => setShowAttachMenu(false)}>
          <View style={styles.attachMenu}>
            {[
              { label: 'Camera', icon: 'camera',     onPress: () => pickImage(true) },
              { label: 'Photo',  icon: 'image',      onPress: () => pickImage(false) },
              { label: 'File',   icon: 'file',       onPress: pickDocument },
            ].map(a => (
              <TouchableOpacity key={a.label} style={styles.attachItem} onPress={a.onPress}>
                <Icon name={a.icon} size={20} color="#fff" />
                <Text style={styles.attachLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      )}

      {/* Recording bar */}
      {isRecording ? (
        <View style={styles.recordingBar}>
          <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn}>
            <Icon name="x" size={22} color="#ff4444" />
          </TouchableOpacity>
          <Text style={styles.recordingTimer}>{formatSecs(recordSecs)}</Text>
          <TouchableOpacity onPress={stopRecordingAndSend} style={styles.sendRecBtn}>
            <Icon name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachBtn} onPress={() => setShowAttachMenu(v => !v)}>
            <Icon name="paperclip" size={20} color="#888" />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="#555"
            value={text}
            onChangeText={setText}
            multiline
          />
          {text.trim() ? (
            <TouchableOpacity style={styles.sendBtn} onPress={sendText}>
              <Icon name="send" size={20} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.micBtn} onLongPress={startRecording} onPressOut={stopRecordingAndSend}>
              <Icon name="mic" size={22} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0a0a0a' },
  header:             { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 12 },
  headerBack:         { padding: 4 },
  headerInfo:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupAvatarSmall:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  headerTitle:        { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub:          { color: '#888', fontSize: 12 },
  headerBtn:          { padding: 8 },
  mineOuter:          { width: '100%', alignItems: 'flex-end', marginBottom: 6 },
  theirsOuter:        { width: '100%', alignItems: 'flex-start', marginBottom: 6 },
  bubbleWrap:         { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '88%' },
  bubble:             { minWidth: 60, borderRadius: 16, padding: 10, flexShrink: 1 },
  mineBubble:         { backgroundColor: '#4f6ef7', borderBottomRightRadius: 4 },
  theirsBubble:       { backgroundColor: '#1f1f1f', borderBottomLeftRadius: 4 },
  senderLabel:        { color: '#4f6ef7', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText:         { color: '#fff' },
  timestamp:          { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  mediaImg:           { width: 200, height: 150, borderRadius: 10 },
  audioBubble:        { flexDirection: 'row', alignItems: 'center', gap: 8, width: 180 },
  audioLabel:         { fontSize: 13 },
  inputRow:           { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1f1f1f', gap: 8 },
  attachBtn:          { padding: 8 },
  input:              { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, color: '#fff', paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn:            { backgroundColor: '#4f6ef7', borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  micBtn:             { padding: 8 },
  recordingBar:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1f1f1f', gap: 10 },
  cancelRecBtn:       { padding: 6 },
  recordingTimer:     { flex: 1, color: '#ff4444', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  sendRecBtn:         { backgroundColor: '#4f6ef7', borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  attachBackdrop:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  attachMenu:         { position: 'absolute', bottom: 80, left: 12, backgroundColor: '#1e1e1e', borderRadius: 12, padding: 8, flexDirection: 'row', gap: 4, elevation: 8 },
  attachItem:         { alignItems: 'center', padding: 12, gap: 4 },
  attachLabel:        { color: '#fff', fontSize: 11 },
})
