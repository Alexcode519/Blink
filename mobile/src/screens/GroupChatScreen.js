import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Image, Modal, Pressable, PermissionsAndroid, Animated,
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
import { saveToLibrary } from '../library/storage'
import { decryptGroupKey, encryptWithGroupKey, decryptWithGroupKey } from '../crypto/keys'
import Icon from 'react-native-vector-icons/Feather'
import notifee from '@notifee/react-native'
import { setActiveChat, clearActiveChat } from '../notifications/activeChat'
import { notifIdForGroup } from '../notifications/setup'

const POLL_INTERVAL = 3000
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export default function GroupChatScreen({ route, navigation }) {
  const { groupId, groupName: initName } = route.params
  const { fontSize } = useFontSize()

  const [messages, setMessages]     = useState([])
  const [text, setText]             = useState('')
  const [groupName, setGroupName]   = useState(initName ?? 'Group')
  const [members, setMembers]       = useState([])
  const [myUsername, setMyUsername] = useState('')
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  const [showReactionPicker, setShowReactionPicker] = useState(null)
  const [memberReads, setMemberReads] = useState({})
  const [groupAvatar, setGroupAvatar] = useState(null)
  const [typingUsers, setTypingUsers] = useState([])
  const typingTimerRef = useRef(null)
  const wink = useRef(new Animated.Value(0)).current

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

  useEffect(() => {
    if (!typingUsers.length) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1000),
        Animated.timing(wink, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(wink, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.delay(1200),
      ])
    )
    loop.start()
    return () => { wink.stopAnimation(); wink.setValue(0) }
  }, [typingUsers.length])

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
        setGroupAvatar(group.avatar ?? null)

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
      reactionTimer = setInterval(pollReactions, POLL_INTERVAL)
      readsTimer = setInterval(pollReads, POLL_INTERVAL)
      typingTimer = setInterval(pollTyping, 2000)
      pollReads()
      pollTyping()
    }

    let reactionTimer, readsTimer, typingTimer
    init()
    notifee.cancelNotification(notifIdForGroup(groupId)).catch(() => {})
    setActiveChat(`group:${groupId}`)
    const focusSub = navigation.addListener('focus', () => setActiveChat(`group:${groupId}`))
    const blurSub  = navigation.addListener('blur', () => clearActiveChat())

    return () => {
      clearInterval(inboxTimer); clearInterval(reactionTimer); clearInterval(readsTimer); clearInterval(typingTimer)
      focusSub(); blurSub()
      clearActiveChat()
    }
  }, [])

  const pollTyping = useCallback(async () => {
    try {
      const { typing } = await api.get(`/groups/${groupId}/typing`)
      setTypingUsers(typing ?? [])
    } catch {}
  }, [groupId])

  function handleTyping(val) {
    setText(val)
    if (!val.trim()) return
    if (typingTimerRef.current) return
    api.post(`/groups/${groupId}/typing`, {}).catch(() => {})
    typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null }, 2000)
  }

  const pollReads = useCallback(async () => {
    try {
      const { reads } = await api.get(`/groups/${groupId}/reads`)
      const map = {}
      for (const r of reads ?? []) if (r.lastRead) map[r.username] = r.lastRead
      setMemberReads(map)
    } catch {}
  }, [groupId])

  const pollReactions = useCallback(async () => {
    if (!groupKeyRef.current) return
    try {
      const { reactions } = await api.get(`/groups/${groupId}/reactions`)
      if (!reactions?.length) return
      const decodedById = {}
      for (const r of reactions) {
        decodedById[r.message_id] = (r.reactions || []).map(rx => {
          try {
            return { username: rx.username, emoji: decryptWithGroupKey(rx.ciphertext, rx.nonce, groupKeyRef.current) }
          } catch { return null }
        }).filter(Boolean)
      }
      setMessages(prev => prev.map(m => decodedById[m.id] !== undefined ? { ...m, reactions: decodedById[m.id] } : m))
    } catch {}
  }, [groupId])

  // ── Decrypt a single raw message row ───────────────────────────────────────
  function decryptRow(m) {
    if (!groupKeyRef.current) return null
    const reactions = (m.reactions || []).map(r => {
      try {
        return { username: r.username, emoji: decryptWithGroupKey(r.ciphertext, r.nonce, groupKeyRef.current) }
      } catch { return null }
    }).filter(Boolean)
    let replyTo = null
    if (m.reply_to_id && m.reply_preview_ciphertext) {
      try {
        const snippet = decryptWithGroupKey(m.reply_preview_ciphertext, m.reply_preview_nonce, groupKeyRef.current)
        replyTo = { id: m.reply_to_id, sender: m.reply_sender, snippet }
      } catch {}
    }
    try {
      const payload = decryptWithGroupKey(m.ciphertext, m.nonce, groupKeyRef.current)
      const parsed  = JSON.parse(payload)
      return {
        id:          m.id,
        sender:      m.sender_username,
        mine:        m.sender_username === myUsername || false,
        contentType: m.content_type,
        createdAt:   m.created_at,
        reactions, replyTo,
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
        reactions, replyTo,
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
  async function sendPayload(payload, contentType, replyTo = null) {
    if (!groupKeyRef.current) return
    const { ciphertext, nonce } = encryptWithGroupKey(JSON.stringify(payload), groupKeyRef.current)
    let replyFields = {}
    if (replyTo) {
      const { ciphertext: rc, nonce: rn } = encryptWithGroupKey(replyTo.snippet, groupKeyRef.current)
      replyFields = { replyToId: replyTo.id, replyPreviewCiphertext: rc, replyPreviewNonce: rn, replySender: replyTo.sender }
    }
    const { messageId, createdAt } = await api.post(`/groups/${groupId}/messages`, { ciphertext, nonce, contentType, ...replyFields })
    const me = await AsyncStorage.getItem('username')
    const newMsg = { id: messageId, sender: me, mine: true, contentType, createdAt, replyTo, reactions: [], ...payload }
    setMessages(prev => [...prev, newMsg])
    latestAtRef.current = createdAt
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
  }

  async function sendText() {
    const t = text.trim()
    if (!t) return
    const replyTo = replyingTo
    setText('')
    setReplyingTo(null)
    try {
      await sendPayload({ text: t }, 'text', replyTo)
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }

  function startReply(item) {
    if (item.contentType !== 'text') {
      Alert.alert('Cannot reply', 'You can only reply to text messages.')
      return
    }
    setReplyingTo({ id: item.id, sender: item.mine ? myUsername : item.sender, snippet: (item.text ?? '').slice(0, 120) })
    inputRef.current?.focus()
  }

  function showMessageActions(item) {
    Alert.alert('Message', undefined, [
      { text: 'Reply', onPress: () => startReply(item) },
      { text: 'React', onPress: () => setShowReactionPicker(item.id) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function setReaction(item, emoji) {
    setShowReactionPicker(null)
    try {
      const { ciphertext, nonce } = encryptWithGroupKey(emoji, groupKeyRef.current)
      await api.put(`/groups/${groupId}/messages/${item.id}/reaction`, { ciphertext, nonce })
      setMessages(prev => prev.map(m => m.id === item.id
        ? { ...m, reactions: [...(m.reactions || []).filter(r => r.username !== myUsername), { username: myUsername, emoji }] }
        : m))
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }

  async function removeReaction(item) {
    try {
      await api.delete(`/groups/${groupId}/messages/${item.id}/reaction`)
      setMessages(prev => prev.map(m => m.id === item.id
        ? { ...m, reactions: (m.reactions || []).filter(r => r.username !== myUsername) }
        : m))
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }

  async function saveToGroupLibrary(item) {
    try {
      const b64 = item.uri?.replace(/^data:[^;]+;base64,/, '')
      if (!b64) return
      await saveToLibrary({
        payload: b64,
        contentType: item.contentType,
        label: item.filename,
        fromGroupId: groupId,
        groupName,
      })
      Alert.alert('Saved', 'Added to your Blink Library.')
    } catch (e) {
      Alert.alert('Save failed', e.message)
    }
  }

  function seenByCount(item) {
    if (!item.mine || !item.createdAt) return 0
    const t = new Date(item.createdAt).getTime()
    return members.filter(mem => mem.username !== myUsername && memberReads[mem.username] && new Date(memberReads[mem.username]).getTime() >= t).length
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

    const seen = seenByCount(item)

    return (
      <View style={item.mine ? styles.mineOuter : styles.theirsOuter}>
        <View style={styles.bubbleWrap}>
          <TouchableOpacity activeOpacity={0.85} onLongPress={() => showMessageActions(item)} delayLongPress={400}>
          <View style={[styles.bubble, item.mine ? styles.mineBubble : styles.theirsBubble, (isImage || isVideo) && styles.bubbleMedia]}>
            {!item.mine && (
              <Text style={styles.senderLabel}>{item.sender}</Text>
            )}
            {item.replyTo && (
              <View style={styles.replyQuote}>
                <Text style={styles.replyQuoteSender}>{item.replyTo.sender}</Text>
                <Text style={styles.replyQuoteText} numberOfLines={1}>{item.replyTo.snippet}</Text>
              </View>
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
            {!item.mine && (isImage || isVideo || isDoc) && (
              <TouchableOpacity onPress={() => saveToGroupLibrary(item)}>
                <Text style={styles.saveBtn}>⬇ Save</Text>
              </TouchableOpacity>
            )}
            <Text style={styles.timestamp}>
              {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </Text>
          </View>
          </TouchableOpacity>
        </View>
        {!!item.reactions?.length && (
          <View style={[styles.reactionRow, !item.mine && styles.reactionRowTheirs]}>
            {Object.entries(item.reactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc }, {})).map(([emoji, count]) => {
              const isMine = item.reactions.some(r => r.emoji === emoji && r.username === myUsername)
              return (
                <TouchableOpacity
                  key={emoji}
                  style={[styles.reactionChip, isMine && styles.reactionChipMine]}
                  onPress={() => (isMine ? removeReaction(item) : setReaction(item, emoji))}
                >
                  <Text style={styles.reactionChipText}>{emoji}{count > 1 ? ` ${count}` : ''}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        )}
        {item.mine && seen > 0 && (
          <Text style={styles.seenByText}>Seen by {seen}/{Math.max(members.length - 1, 1)}</Text>
        )}
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
          {groupAvatar ? (
            <Image source={{ uri: `data:image/jpeg;base64,${groupAvatar}` }} style={styles.groupAvatarSmallImg} />
          ) : (
            <View style={styles.groupAvatarSmall}>
              <Icon name="users" size={16} color="#fff" />
            </View>
          )}
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

      {typingUsers.length > 0 && (
        <View style={styles.typingRow}>
          <View style={styles.typingAvatarPlaceholder}>
            <Icon name="users" size={14} color="#fff" />
          </View>
          <View style={styles.typingBubble}>
            <View style={styles.eye}><View style={styles.pupil} /></View>
            <Animated.View
              style={[
                styles.eye,
                { transform: [{ scaleY: wink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.1] }) }] },
              ]}
            >
              <View style={styles.pupil} />
            </Animated.View>
            <Text style={styles.typingLabel}>
              {typingUsers.length === 1
                ? `${typingUsers[0]} is typing`
                : typingUsers.length === 2
                  ? `${typingUsers[0]} and ${typingUsers[1]} are typing`
                  : `${typingUsers.length} people are typing`}
            </Text>
          </View>
        </View>
      )}

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
        <>
        {replyingTo && (
          <View style={styles.replyBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.replyBarSender}>Replying to {replyingTo.sender}</Text>
              <Text style={styles.replyBarText} numberOfLines={1}>{replyingTo.snippet}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.attachBtn}>
              <Icon name="x" size={18} color="#888" />
            </TouchableOpacity>
          </View>
        )}
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
            onChangeText={handleTyping}
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
        </>
      )}

      <Modal transparent visible={!!showReactionPicker} animationType="fade" onRequestClose={() => setShowReactionPicker(null)}>
        <Pressable style={styles.reactionOverlay} onPress={() => setShowReactionPicker(null)}>
          <View style={styles.reactionPickerSheet}>
            {EMOJIS.map(e => (
              <TouchableOpacity key={e} onPress={() => {
                const item = messages.find(m => m.id === showReactionPicker)
                if (item) setReaction(item, e)
              }}>
                <Text style={styles.reactionPickerEmoji}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0a0a0a' },
  header:             { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 12 },
  headerBack:         { padding: 4 },
  headerInfo:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupAvatarSmall:   { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  groupAvatarSmallImg:{ width: 36, height: 36, borderRadius: 18 },
  headerTitle:        { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSub:          { color: '#888', fontSize: 12 },
  headerBtn:          { padding: 8 },
  mineOuter:          { width: '100%', alignItems: 'flex-end', marginBottom: 6 },
  theirsOuter:        { width: '100%', alignItems: 'flex-start', marginBottom: 6 },
  bubbleWrap:         { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '88%' },
  bubble:             { minWidth: 60, borderRadius: 16, padding: 10, flexShrink: 1 },
  bubbleMedia:        { padding: 3 },
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
  replyQuote:         { borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.5)', paddingLeft: 8, marginBottom: 6 },
  replyQuoteSender:   { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  replyQuoteText:     { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  reactionRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, justifyContent: 'flex-end' },
  reactionRowTheirs:  { justifyContent: 'flex-start' },
  reactionChip:       { backgroundColor: '#1f1f1f', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#2a2a2a' },
  reactionChipMine:   { borderColor: '#4f6ef7' },
  reactionChipText:   { color: '#fff', fontSize: 13 },
  seenByText:         { color: '#555', fontSize: 11, marginTop: 2, alignSelf: 'flex-end' },
  saveBtn:            { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 },
  typingRow:              { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  typingAvatarPlaceholder:{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  typingBubble:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f1f1f', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  eye:                    { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pupil:                  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#222' },
  typingLabel:            { color: '#aaa', fontSize: 12, marginLeft: 4 },
  replyBar:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  replyBarSender:     { color: '#4f6ef7', fontSize: 12, fontWeight: '700' },
  replyBarText:       { color: '#888', fontSize: 13 },
  reactionOverlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  reactionPickerSheet: { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, gap: 14, alignSelf: 'center', marginBottom: 100 },
  reactionPickerEmoji: { fontSize: 28 },
})
