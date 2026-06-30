import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Platform, Image, Modal, Pressable, PermissionsAndroid,
  PanResponder, Animated,
} from 'react-native'
import AudioRecorderPlayer from 'react-native-audio-recorder-player'
import { useFontSize } from '../context/FontSizeContext'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary, launchCamera } from 'react-native-image-picker'
import { pick, isCancel, types } from '@react-native-documents/picker'
import { pickerGuard } from '../utils/pickerGuard'
import RNFS from 'react-native-fs'
import Video from 'react-native-video'
import { saveToLibrary } from '../library/storage'
import { api } from '../api/client'
import { encryptForRecipient, decryptFromSender } from '../crypto/keys'
import SaveRequestModal from '../components/SaveRequestModal'
import Icon from 'react-native-vector-icons/Feather'
import notifee from '@notifee/react-native'
import { notifIdForSender } from '../notifications/setup'
import { setActiveChat, clearActiveChat } from '../notifications/activeChat'

const POLL_INTERVAL = 3000
const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export default function ChatScreen({ route, navigation }) {
  const { recipientUsername, recipientPublicKey } = route.params
  const [requested, setRequested] = useState(route.params?.requested ?? false)
  const [messages, setMessages] = useState([])
  const { fontSize } = useFontSize()
  const [text, setText] = useState('')
  const [myUsername, setMyUsername] = useState('')
  const [myAvatar, setMyAvatar] = useState(null)
  const [recipientAvatar, setRecipientAvatar] = useState(null)
  const [saveRequest, setSaveRequest] = useState(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [recipientStatus, setRecipientStatus] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [replyingTo, setReplyingTo] = useState(null)
  const [showReactionPicker, setShowReactionPicker] = useState(null)
  const searchInputRef = useRef(null)
  const wink = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!recipientStatus?.isTyping) return
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
  }, [recipientStatus?.isTyping])

  const [isRecording, setIsRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const recordSecsRef = useRef(0)
  const [playingId, setPlayingId] = useState(null)
  const [playbackPos, setPlaybackPos] = useState(0)   // current seconds
  const [playbackDur, setPlaybackDur] = useState(0)   // total seconds
  const audioRecorder = useRef(new AudioRecorderPlayer()).current
  const typingTimerRef = useRef(null)
  const pendingSaves = useRef({})
  const listRef  = useRef(null)
  const inputRef = useRef(null)
  const recipientPublicKeyRef = useRef(recipientPublicKey)

  const CACHE_KEY = `blink_chat_${recipientUsername}`

  useEffect(() => {
    AsyncStorage.getItem('username').then(u => setMyUsername(u ?? ''))
    RNFS.exists(AVATAR_PATH).then(exists => {
      if (exists) setMyAvatar(`file://${AVATAR_PATH}?t=${Date.now()}`)
    })
    // Load local cache instantly, then fetch fresh from server
    AsyncStorage.getItem(CACHE_KEY).then(cached => {
      if (cached) {
        const msgs = JSON.parse(cached)
        setMessages(msgs)
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: false })
        }, 150)
      }
    }).catch(() => {})
    api.get(`/users/${recipientUsername}`)
      .then(({ publicKey, avatar }) => {
        if (publicKey) recipientPublicKeyRef.current = publicKey
        if (avatar) setRecipientAvatar(`data:image/jpeg;base64,${avatar}`)
      })
      .catch(() => {})
      .then(() => loadHistory())
      .finally(() => pollInbox())
    api.get(`/messages/requests/${recipientUsername}/status`)
      .then(({ requested: r }) => setRequested(!!r))
      .catch(() => {})
    // Mark incoming messages as read and dismiss notification
    api.post(`/messages/read/${recipientUsername}`, {}).catch(() => {})
    notifee.cancelNotification(notifIdForSender(recipientUsername)).catch(() => {})
    setActiveChat(recipientUsername)
    const focusSub = navigation.addListener('focus', () => setActiveChat(recipientUsername))
    const blurSub  = navigation.addListener('blur', () => clearActiveChat())
    const inboxTimer    = setInterval(pollInbox, POLL_INTERVAL)
    const senderTimer   = setInterval(pollSaveRequests, POLL_INTERVAL)
    const receiptTimer  = setInterval(pollReadReceipts, POLL_INTERVAL)
    const reactionTimer = setInterval(pollReactions, POLL_INTERVAL)
    const statusTimer   = setInterval(pollStatus, 2000)
    pollStatus()
    return () => {
      clearInterval(inboxTimer); clearInterval(senderTimer)
      clearInterval(receiptTimer); clearInterval(reactionTimer); clearInterval(statusTimer)
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
      focusSub(); blurSub()
      clearActiveChat()
    }
  }, [])

  const pollStatus = useCallback(async () => {
    try {
      const status = await api.get(`/users/status/${recipientUsername}`)
      setRecipientStatus(status)
    } catch {}
  }, [recipientUsername])

  function handleTyping(val) {
    setText(val)
    if (!val.trim()) return
    // Debounce: send typing event at most once every 2s
    if (typingTimerRef.current) return
    api.post(`/users/typing/${recipientUsername}`, {}).catch(() => {})
    typingTimerRef.current = setTimeout(() => { typingTimerRef.current = null }, 2000)
  }

  async function acceptRequest() {
    try {
      await api.post(`/messages/requests/${recipientUsername}/accept`)
      setRequested(false)
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }

  function declineRequest() {
    Alert.alert(
      'Decline request?',
      `${recipientUsername} will be blocked and won't be able to message you again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline', style: 'destructive', onPress: async () => {
            try {
              await api.post(`/users/block/${recipientUsername}`)
              navigation.goBack()
            } catch (e) {
              Alert.alert('Error', e.message)
            }
          }
        },
      ]
    )
  }

  const pollReadReceipts = useCallback(async () => {
    try {
      const { readIds } = await api.get(`/messages/read-receipts/${recipientUsername}`)
      if (!readIds?.length) return
      const readSet = new Set(readIds)
      setMessages(prev => {
        const updated = prev.map(m =>
          m.mine && readSet.has(m.id) && m.status !== 'read'
            ? { ...m, status: 'read' }
            : m
        )
        const changed = updated.some((m, i) => m.status !== prev[i].status)
        return changed ? updated : prev
      })
    } catch {}
  }, [recipientUsername])

  const pollReactions = useCallback(async () => {
    try {
      const { reactions } = await api.get(`/messages/reactions/${recipientUsername}`)
      if (!reactions?.length) return
      const decodedById = {}
      for (const r of reactions) {
        decodedById[r.message_id] = (await Promise.all((r.reactions || []).map(async (rx) => {
          try {
            const emoji = await decryptFromSender(rx.ciphertext, rx.nonce, recipientPublicKeyRef.current)
            return { username: rx.username, emoji }
          } catch { return null }
        }))).filter(Boolean)
      }
      setMessages(prev => {
        let changed = false
        const next = prev.map(m => {
          if (decodedById[m.id] !== undefined) { changed = true; return { ...m, reactions: decodedById[m.id] } }
          return m
        })
        if (changed) saveCache(next)
        return changed ? next : prev
      })
    } catch {}
  }, [recipientUsername, saveCache])

  const pollSaveRequests = useCallback(async () => {
    const entries = Object.entries(pendingSaves.current)
    if (!entries.length) return
    for (const [messageId, info] of entries) {
      try {
        const { status, expiresAt } = await api.get(`/messages/save-requests/${info.requestId}/status`)
        if (status === 'approved') {
          delete pendingSaves.current[messageId]
          await saveToDevice(info.payload, info.contentType, info.label, expiresAt)
        } else if (status === 'denied') {
          delete pendingSaves.current[messageId]
          Alert.alert('Save denied', 'The sender did not allow saving this file.')
        }
      } catch {}
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { requests } = await api.get('/messages/save-requests/pending')
        if (requests?.length && !saveRequest) setSaveRequest(requests[0])
      } catch {}
    }, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [saveRequest])

  const saveMediaFile = useCallback(async (id, base64, ext) => {
    const path = `${RNFS.CachesDirectoryPath}/blink_media_${id}.${ext}`
    try {
      await RNFS.writeFile(path, base64, 'base64')
      return `file://${path}`
    } catch { return null }
  }, [])

  const saveCache = useCallback((msgs) => {
    // Images/video already converted to file:// paths — safe to store
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(msgs)).catch(() => {})
  }, [CACHE_KEY])

  const decodeExtras = useCallback(async (m) => {
    let reactions = []
    if (m.reactions?.length) {
      reactions = (await Promise.all(m.reactions.map(async (r) => {
        try {
          const emoji = await decryptFromSender(r.ciphertext, r.nonce, recipientPublicKeyRef.current)
          return { username: r.username, emoji }
        } catch { return null }
      }))).filter(Boolean)
    }
    let replyTo = null
    if (m.reply_to_id && m.reply_preview_ciphertext) {
      try {
        const snippet = await decryptFromSender(m.reply_preview_ciphertext, m.reply_preview_nonce, recipientPublicKeyRef.current)
        replyTo = { id: m.reply_to_id, sender: m.reply_sender, snippet }
      } catch {}
    }
    return { reactions, replyTo }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const myUser = await AsyncStorage.getItem('username')
      const [{ messages: history }, receipts] = await Promise.all([
        api.get(`/messages/history/${recipientUsername}`),
        api.get(`/messages/read-receipts/${recipientUsername}`).catch(() => ({ readIds: [] })),
      ])
      if (!history.length) return
      const readSet = new Set(receipts?.readIds ?? [])
      const decoded = await Promise.all(history.map(async (m) => {
        // Postgres lowercases unquoted aliases: senderUsername → senderusername
        const sender = m.senderusername ?? m.senderUsername ?? m.sender_username ?? ''
        const isMine = sender === myUser
        if (isMine) {
          const cached = await AsyncStorage.getItem(`blink_sent_${m.id}`)
          const { payload, contentType, label } = cached
            ? JSON.parse(cached)
            : { payload: '[Sent]', contentType: m.content_type, label: null }
          const status = readSet.has(m.id) ? 'read' : 'delivered'
          const extras = await decodeExtras(m)
          return { id: m.id, from: sender, payload, contentType, label, mine: true, status, createdAt: m.created_at, ...extras }
        }
        try {
          let keyToUse = recipientPublicKeyRef.current
          let payload
          try {
            payload = await decryptFromSender(m.ciphertext, m.nonce, keyToUse)
          } catch {
            // Key may have changed — re-fetch and retry once
            const fresh = await api.get(`/users/${recipientUsername}`)
            if (fresh.publicKey && fresh.publicKey !== keyToUse) {
              recipientPublicKeyRef.current = fresh.publicKey
              keyToUse = fresh.publicKey
              payload = await decryptFromSender(m.ciphertext, m.nonce, keyToUse)
            } else {
              throw new Error('key mismatch')
            }
          }
          const ct = m.content_type
          if (ct === 'image' || ct === 'video' || ct === 'audio') {
            const ext = ct === 'image' ? 'jpg' : ct === 'video' ? 'mp4' : 'mp4'
            const uri = await saveMediaFile(m.id, payload, ext)
            if (uri) payload = uri
          }
          const extras = await decodeExtras(m)
          return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered', createdAt: m.created_at, ...extras }
        } catch (e) {
          return { id: m.id, from: sender, payload: '🔒 Encrypted with an older key', contentType: 'text', mine: false, status: 'delivered', createdAt: m.created_at }
        }
      }))
      setMessages(prev => {
        // Keep any pending sent messages not yet in server history
        const historyIds = new Set(decoded.map(m => m.id))
        const pendingSent = prev.filter(m => m.mine && !historyIds.has(m.id))
        const merged = [...decoded, ...pendingSent]
        saveCache(merged)
        return merged
      })
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
    } catch {}
  }, [recipientUsername, saveCache, decodeExtras])

  const pollInbox = useCallback(async () => {
    try {
      const { messages: incoming } = await api.get('/messages/inbox')
      if (!incoming.length) return
      // Mark them read since the screen is open
      api.post(`/messages/read/${recipientUsername}`, {}).catch(() => {})
      const decrypted = await Promise.all(
        incoming.map(async (m) => {
          const sender = m.senderusername ?? m.senderUsername ?? ''
          try {
            let keyToUse = recipientPublicKeyRef.current
            let payload
            try {
              payload = await decryptFromSender(m.ciphertext, m.nonce, keyToUse)
            } catch {
              const fresh = await api.get(`/users/${recipientUsername}`)
              if (fresh.publicKey && fresh.publicKey !== keyToUse) {
                recipientPublicKeyRef.current = fresh.publicKey
                keyToUse = fresh.publicKey
                payload = await decryptFromSender(m.ciphertext, m.nonce, keyToUse)
              } else {
                throw new Error('key mismatch')
              }
            }
            const ct = m.content_type
            if (ct === 'image' || ct === 'video' || ct === 'audio') {
              const ext = ct === 'image' ? 'jpg' : 'mp4'
              const uri = await saveMediaFile(m.id, payload, ext)
              if (uri) payload = uri
            }
            const extras = await decodeExtras(m)
            return { id: m.id, from: sender, payload, contentType: ct, mine: false, status: 'delivered', createdAt: m.created_at, ...extras }
          } catch (e) {
            return { id: m.id, from: sender, payload: '🔒 Encrypted with an older key', contentType: 'text', mine: false, status: 'delivered', createdAt: m.created_at }
          }
        })
      )
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const fresh = decrypted.filter(m => !existingIds.has(m.id))
        if (!fresh.length) return prev
        const next = [...prev, ...fresh]
        saveCache(next)
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
        return next
      })
    } catch {}
  }, [recipientPublicKey])

  async function sendPayload(payload, contentType, label, replyTo = null) {
    setRequested(false) // sending implicitly accepts the contact, mirrors backend behavior
    // Add a temporary message immediately so it appears without waiting for the server
    const tempId = `temp_${Date.now()}`
    let displayPayload = payload
    if (contentType === 'image' || contentType === 'video' || contentType === 'audio') {
      const ext = contentType === 'image' ? 'jpg' : 'mp4'
      const uri = await saveMediaFile(tempId, payload, ext)
      if (uri) displayPayload = uri
    }
    const tempMsg = { id: tempId, from: myUsername, payload: displayPayload, contentType, label, mine: true, status: 'sending', createdAt: new Date().toISOString(), replyTo }
    setMessages(prev => [...prev, tempMsg])
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)

    try {
      // Always fetch the latest public key before encrypting — recipient may have rekeyed
      try {
        const { publicKey } = await api.get(`/users/${recipientUsername}`)
        if (publicKey) recipientPublicKeyRef.current = publicKey
      } catch {}
      const { ciphertext, nonce } = await encryptForRecipient(payload, recipientPublicKeyRef.current)
      let replyFields = {}
      if (replyTo) {
        const { ciphertext: rc, nonce: rn } = await encryptForRecipient(replyTo.snippet, recipientPublicKeyRef.current)
        replyFields = { replyToId: replyTo.id, replyPreviewCiphertext: rc, replyPreviewNonce: rn, replySender: replyTo.sender }
      }
      const { messageId } = await api.post('/messages', { recipientUsername, ciphertext, nonce, contentType, ...replyFields })
      const id = messageId ?? tempId

      // Rename local media file to final id
      if (contentType === 'image' || contentType === 'video' || contentType === 'audio') {
        const ext = contentType === 'image' ? 'jpg' : 'mp4'
        const finalUri = await saveMediaFile(id, payload, ext)
        if (finalUri) displayPayload = finalUri
      }

      AsyncStorage.setItem(`blink_sent_${id}`, JSON.stringify({ payload: displayPayload, contentType, label })).catch(() => {})

      // Replace temp message with confirmed one
      setMessages(prev => {
        const next = prev.map(m => m.id === tempId
          ? { ...m, id, payload: displayPayload, status: 'sent' }
          : m
        )
        saveCache(next)
        return next
      })
    } catch (err) {
      // Remove the temp message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId))
      Alert.alert('Error', err.message)
    }
  }

  async function sendText() {
    if (!text.trim()) return
    const msg = text.trim()
    const replyTo = replyingTo
    setText('')  // clear immediately so it feels instant
    setReplyingTo(null)
    await sendPayload(msg, 'text', null, replyTo)
  }

  function startReply(item) {
    if (item.contentType !== 'text') {
      Alert.alert('Cannot reply', 'You can only reply to text messages.')
      return
    }
    setReplyingTo({ id: item.id, sender: item.mine ? myUsername : item.from, snippet: item.payload.slice(0, 120) })
    inputRef.current?.focus()
  }

  function showMessageActions(item) {
    const buttons = [
      { text: 'Reply', onPress: () => startReply(item) },
      { text: 'React', onPress: () => setShowReactionPicker(item.id) },
    ]
    if (item.mine) buttons.push({ text: 'Delete', style: 'destructive', onPress: () => confirmDeleteMessage(item) })
    buttons.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert('Message', undefined, buttons)
  }

  async function setReaction(item, emoji) {
    setShowReactionPicker(null)
    try {
      const { ciphertext, nonce } = await encryptForRecipient(emoji, recipientPublicKeyRef.current)
      await api.put(`/messages/${item.id}/reaction`, { ciphertext, nonce })
      setMessages(prev => {
        const next = prev.map(m => m.id === item.id
          ? { ...m, reactions: [...(m.reactions || []).filter(r => r.username !== myUsername), { username: myUsername, emoji }] }
          : m)
        saveCache(next)
        return next
      })
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function removeReaction(item) {
    try {
      await api.delete(`/messages/${item.id}/reaction`)
      setMessages(prev => {
        const next = prev.map(m => m.id === item.id
          ? { ...m, reactions: (m.reactions || []).filter(r => r.username !== myUsername) }
          : m)
        saveCache(next)
        return next
      })
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function takePhoto() {
    setShowAttachMenu(false)
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission denied', 'Camera permission is required to take photos.')
        return
      }
    }
    pickerGuard.start()
    const result = await launchCamera({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280, saveToPhotos: false })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    // Brief pause so the app fully resumes before accessing Keychain
    await new Promise(r => setTimeout(r, 500))
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName ?? 'photo')
  }

  async function pickPhoto() {
    setShowAttachMenu(false)
    pickerGuard.start()
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.4, maxWidth: 1280, maxHeight: 1280 })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = asset.base64 ?? await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'image', asset.fileName)
  }

  async function pickVideo() {
    setShowAttachMenu(false)
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission denied', 'Camera permission is required to record video.')
        return
      }
    }
    pickerGuard.start()
    const result = await launchCamera({ mediaType: 'video', videoQuality: 'high', includeBase64: false })
    pickerGuard.end()
    if (result.didCancel || !result.assets?.[0]) return
    const asset = result.assets[0]
    const base64 = await RNFS.readFile(asset.uri.replace('file://', ''), 'base64')
    await sendPayload(base64, 'video', asset.fileName ?? 'video')
  }

  async function pickDocument() {
    setShowAttachMenu(false)
    try {
      pickerGuard.start()
      const [result] = await pick({ type: [types.allFiles], copyTo: 'cachesDirectory' })
      pickerGuard.end()
      const uri = (result.fileCopyUri ?? result.uri).replace('file://', '')
      const base64 = await RNFS.readFile(uri, 'base64')
      const mime = result.type ?? ''
      const contentType = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'document'
      await sendPayload(base64, contentType, result.name ?? 'file')
    } catch (err) {
      pickerGuard.end()
      if (!isCancel(err)) Alert.alert('Error', err.message)
    }
  }

  async function requestSave(message) {
    if (message.contentType === 'text') return
    try {
      const { requestId } = await api.post(`/messages/${message.id}/save-request`, {})
      pendingSaves.current[message.id] = { requestId, payload: message.payload, contentType: message.contentType, label: message.label }
      Alert.alert('Save requested', 'Waiting for the sender to approve.')
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  async function saveToDevice(payload, contentType, label, expiresAt) {
    try {
      await saveToLibrary({ payload, contentType, label, fromUsername: recipientUsername, expiresAt: expiresAt ?? null })
      const msg = expiresAt
        ? `Added to your Blink Library. Expires ${new Date(expiresAt).toLocaleString()}.`
        : 'Added to your Blink Library.'
      Alert.alert('Saved', msg)
    } catch (err) {
      Alert.alert('Save failed', err.message)
    }
  }

  function formatLastSeen(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  }

  function formatTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
    const isYesterday = d.toDateString() === yesterday.toDateString()
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (isToday) return time
    if (isYesterday) return `Yesterday ${time}`
    return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
  }

  function StatusTick({ status }) {
    if (status === 'sending')   return <Text style={styles.tick}>○</Text>
    if (status === 'sent')      return <Text style={styles.tick}>✓</Text>
    if (status === 'delivered') return <Text style={styles.tick}>✓✓</Text>
    if (status === 'read')      return <Text style={[styles.tick, styles.tickRead]}>✓✓</Text>
    return null
  }

  function SwipeToDelete({ item, children }) {
    const translateX = useRef(new Animated.Value(0)).current
    const panResponder = useRef(PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < 0) translateX.setValue(Math.max(g.dx, -80))
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) {
          Animated.timing(translateX, { toValue: -80, duration: 100, useNativeDriver: true }).start()
          setTimeout(() => {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
            confirmDeleteMessage(item)
          }, 300)
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start()
        }
      },
    })).current

    return (
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    )
  }

  function confirmDeleteConversation() {
    setShowMenu(false)
    Alert.alert(
      'Delete chat?',
      'This will permanently delete all messages in this conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/messages/conversation/${recipientUsername}`)
            await AsyncStorage.removeItem(CACHE_KEY)
            navigation.goBack()
          } catch (err) {
            Alert.alert('Error', err.message)
          }
        }},
      ]
    )
  }

  function confirmDeleteMessage(item) {
    Alert.alert(
      'Delete message?',
      'This will delete the message for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMessage(item) },
      ]
    )
  }

  async function deleteMessage(item) {
    try {
      await api.delete(`/messages/${item.id}`)
      setMessages(prev => prev.filter(m => m.id !== item.id))
      if (item.payload && item.payload.startsWith('file://')) {
        RNFS.unlink(item.payload.replace('file://', '')).catch(() => {})
      }
    } catch (err) {
      Alert.alert('Error', err.message)
    }
  }

  function renderBubble(item) {
    const isImage = item.contentType === 'image'
    const isVideo = item.contentType === 'video'
    const isDoc   = item.contentType === 'document'
    const isAudio = item.contentType === 'audio'
    const canSave = !item.mine && (isImage || isVideo || isDoc)

    const bubble = (
      <View style={item.mine ? styles.mineOuter : styles.theirsOuter}>
        <View
          style={[styles.bubbleWrap, item.mine ? styles.mineWrap : styles.theirsWrap]}
          onStartShouldSetResponder={() => false}
        >
          {!item.mine && (
            recipientAvatar
              ? <Image source={{ uri: recipientAvatar }} style={styles.avatarThumb} />
              : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{recipientUsername[0]?.toUpperCase()}</Text></View>
          )}
          {item.mine && (
            myAvatar
              ? <Image source={{ uri: myAvatar }} style={styles.avatarThumb} />
              : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{myUsername[0]?.toUpperCase()}</Text></View>
          )}
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={() => showMessageActions(item)}
            delayLongPress={400}
          >
          <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs, (isImage || isVideo) && styles.bubbleMedia]}>
            {item.replyTo && (
              <View style={styles.replyQuote}>
                <Text style={styles.replyQuoteSender}>{item.replyTo.sender}</Text>
                <Text style={styles.replyQuoteText} numberOfLines={1}>{item.replyTo.snippet}</Text>
              </View>
            )}
            {isImage && (
              <Image
                source={{ uri: item.payload.startsWith('file://') ? item.payload : `data:image/jpeg;base64,${item.payload}` }}
                style={styles.imagePreview}
                resizeMode="cover"
              />
            )}
            {isVideo && (
              <Video
                source={{ uri: item.payload.startsWith('file://') ? item.payload : `file://${item.payload}` }}
                style={styles.videoPreview}
                controls
                resizeMode="cover"
                paused
              />
            )}
            {isDoc && (
              <View style={styles.mediaChip}>
                <Text style={styles.mediaIcon}>📄</Text>
                <Text style={styles.mediaLabel}>{item.label ?? 'Document'}</Text>
              </View>
            )}
            {isAudio && (
              <TouchableOpacity style={styles.audioBubble} onPress={() => playAudio(item)}>
                <Icon name={playingId === item.id ? 'pause-circle' : 'play-circle'} size={26} color={item.mine ? '#fff' : '#4f6ef7'} />
                <Text style={styles.audioLabel}>
                  {playingId === item.id
                    ? `${formatSecs(playbackPos)} / ${formatSecs(playbackDur)}`
                    : 'Voice note'}
                </Text>
              </TouchableOpacity>
            )}
            {!isImage && !isVideo && !isDoc && !isAudio && (
              <Text style={[styles.bubbleText, { fontSize }]}>
                {searchQuery.trim() && item.payload?.toLowerCase().includes(searchQuery.toLowerCase())
                  ? (() => {
                      const parts = item.payload.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
                      return parts.map((part, i) =>
                        part.toLowerCase() === searchQuery.toLowerCase()
                          ? <Text key={i} style={[styles.searchHighlight, { fontSize }]}>{part}</Text>
                          : part
                      )
                    })()
                  : item.payload}
              </Text>
            )}
            {canSave && (
              <TouchableOpacity onPress={() => requestSave(item)}>
                <Text style={styles.saveBtn}>⬇ Save</Text>
              </TouchableOpacity>
            )}
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
        <View style={[styles.tickRow, !item.mine && styles.tickRowTheirs]}>
          {!!item.createdAt && (
            <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
          )}
          {item.mine && <StatusTick status={item.status} />}
        </View>
      </View>
    )
    return item.mine ? <SwipeToDelete item={item}>{bubble}</SwipeToDelete> : bubble
  }

  async function startRecording() {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission denied', 'Microphone access is required to send voice notes.')
          return
        }
      }
      setIsRecording(true)
      setRecordSecs(0)
      recordSecsRef.current = 0
      const path = `${RNFS.CachesDirectoryPath}/blink_voice_${Date.now()}.mp4`
      await audioRecorder.startRecorder(path)
      audioRecorder.addRecordBackListener(e => {
        const s = Math.floor(e.currentPosition / 1000)
        recordSecsRef.current = s
        setRecordSecs(s)
      })
    } catch (err) {
      setIsRecording(false)
      Alert.alert('Recording error', err.message)
    }
  }

  async function stopRecordingAndSend() {
    if (!isRecording) return
    try {
      const path = await audioRecorder.stopRecorder()
      audioRecorder.removeRecordBackListener()
      setIsRecording(false)
      setRecordSecs(0)
      if (recordSecsRef.current < 1) return // too short, discard
      const cleanPath = path.replace('file://', '')
      const base64 = await RNFS.readFile(cleanPath, 'base64')
      await sendPayload(base64, 'audio', path)
      RNFS.unlink(path).catch(() => {})
    } catch (err) {
      setIsRecording(false)
      Alert.alert('Error', err.message)
    }
  }

  async function cancelRecording() {
    if (!isRecording) return
    await audioRecorder.stopRecorder().catch(() => {})
    audioRecorder.removeRecordBackListener()
    setIsRecording(false)
    setRecordSecs(0)
  }

  async function playAudio(item) {
    try {
      if (playingId === item.id) {
        await audioRecorder.stopPlayer()
        audioRecorder.removePlayBackListener()
        setPlayingId(null)
        return
      }
      if (playingId) {
        await audioRecorder.stopPlayer()
        audioRecorder.removePlayBackListener()
      }
      const uri = item.payload.startsWith('file://') ? item.payload : `file://${item.payload}`
      setPlayingId(item.id)
      setPlaybackPos(0)
      setPlaybackDur(0)
      await audioRecorder.startPlayer(uri)
      audioRecorder.addPlayBackListener(e => {
        const pos = Math.floor(e.currentPosition / 1000)
        const dur = Math.floor(e.duration / 1000)
        setPlaybackPos(pos)
        setPlaybackDur(dur > 0 ? dur : 0)
        if (e.currentPosition >= e.duration && e.duration > 0) {
          audioRecorder.stopPlayer().catch(() => {})
          audioRecorder.removePlayBackListener()
          setPlayingId(null)
          setPlaybackPos(0)
        }
      })
    } catch (err) {
      setPlayingId(null)
    }
  }

  function formatSecs(s) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const searchMatches = searchQuery.trim().length > 0
    ? messages.reduce((acc, m, idx) => {
        if (typeof m.payload === 'string' && m.payload.toLowerCase().includes(searchQuery.toLowerCase())) acc.push(idx)
        return acc
      }, [])
    : []

  function openSearch() {
    setSearchOpen(true)
    setSearchQuery('')
    setSearchMatchIndex(0)
    setTimeout(() => searchInputRef.current?.focus(), 100)
  }

  function closeSearch() {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchMatchIndex(0)
  }

  function onSearchChange(q) {
    setSearchQuery(q)
    setSearchMatchIndex(0)
  }

  function goToMatch(direction) {
    if (!searchMatches.length) return
    const next = (searchMatchIndex + direction + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(next)
    listRef.current?.scrollToIndex({ index: searchMatches[next], animated: true, viewPosition: 0.5 })
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatarRow}>
            {recipientAvatar
              ? <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
              : <View style={styles.headerAvatarPlaceholder}><Text style={styles.headerAvatarInitial}>{recipientUsername[0]?.toUpperCase()}</Text></View>
            }
            <Text style={styles.headerTitle}>{recipientUsername}</Text>
          </View>
          {recipientStatus && (
            <Text style={[styles.headerStatus, recipientStatus.isTyping && styles.headerTyping]}>
              {recipientStatus.isTyping
                ? 'typing...'
                : recipientStatus.online
                  ? 'online'
                  : recipientStatus.lastSeen
                    ? `last seen ${formatLastSeen(recipientStatus.lastSeen)}`
                    : ''}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity style={styles.iconBtn} onPress={openSearch}>
            <Icon name="search" size={20} color="#888" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate('Library', { fromUsername: recipientUsername })}
          >
            <Icon name="feather" size={20} color="#4f6ef7" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate('SafetyNumber', { recipientUsername, recipientPublicKey: recipientPublicKeyRef.current })}
          >
            <Icon name="shield" size={20} color="#888" />
          </TouchableOpacity>
        </View>
      </View>

      {searchOpen && (
        <View style={styles.searchBar}>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search messages…"
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={onSearchChange}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Text style={styles.searchCount}>
              {searchMatches.length === 0 ? '0 results' : `${searchMatchIndex + 1} / ${searchMatches.length}`}
            </Text>
          )}
          <TouchableOpacity onPress={() => goToMatch(-1)} style={styles.searchNav} disabled={!searchMatches.length}>
            <Icon name="chevron-up" size={18} color={searchMatches.length ? '#fff' : '#444'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goToMatch(1)} style={styles.searchNav} disabled={!searchMatches.length}>
            <Icon name="chevron-down" size={18} color={searchMatches.length ? '#fff' : '#444'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={closeSearch} style={styles.searchNav}>
            <Icon name="x" size={18} color="#888" />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={({ item }) => renderBubble(item)}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {recipientStatus?.isTyping && (
        <View style={styles.typingRow}>
          {recipientAvatar
            ? <Image source={{ uri: recipientAvatar }} style={styles.typingAvatar} />
            : <View style={styles.typingAvatarPlaceholder}><Text style={styles.typingAvatarInitial}>{recipientUsername[0]?.toUpperCase()}</Text></View>
          }
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
          </View>
        </View>
      )}

      {requested ? (
        <View style={styles.requestBar}>
          <Text style={styles.requestBarText}>
            <Text style={styles.bold}>{recipientUsername}</Text> isn't in your contacts. Accept to start replying.
          </Text>
          <View style={styles.requestBarBtns}>
            <TouchableOpacity style={styles.requestDeclineBtn} onPress={declineRequest}>
              <Text style={styles.requestDeclineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.requestAcceptBtn} onPress={acceptRequest}>
              <Text style={styles.requestAcceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : isRecording ? (
        <View style={styles.recordingBar}>
          <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn}>
            <Icon name="x" size={20} color="#ff4444" />
          </TouchableOpacity>
          <View style={styles.recordingPulse} />
          <Text style={styles.recordingTime}>{formatSecs(recordSecs)}</Text>
          <Text style={styles.recordingHint}>Recording… release to send</Text>
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
            <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.iconBtn}>
              <Icon name="x" size={18} color="#888" />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity onPress={() => setShowAttachMenu(true)} style={styles.iconBtn}>
            <Icon name="paperclip" size={22} color="#888" />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={handleTyping}
            placeholder="Message…"
            placeholderTextColor="#555"
            onSubmitEditing={sendText}
            returnKeyType="send"
            multiline
          />
          {text.trim().length > 0 ? (
            <TouchableOpacity onPress={sendText} style={styles.sendBtn}>
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPressIn={startRecording} onPressOut={stopRecordingAndSend} style={styles.micBtn}>
              <Icon name="mic" size={22} color="#4f6ef7" />
            </TouchableOpacity>
          )}
        </View>
        </>
      )}

      <Modal transparent visible={!!showReactionPicker} animationType="fade" onRequestClose={() => setShowReactionPicker(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setShowReactionPicker(null)}>
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

      <Modal transparent visible={showAttachMenu} animationType="slide" onRequestClose={() => setShowAttachMenu(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setShowAttachMenu(false)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>Send attachment</Text>
            <TouchableOpacity style={styles.menuItem} onPress={takePhoto}>
              <View style={styles.menuIconWrap}><Icon name="camera" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickPhoto}>
              <View style={styles.menuIconWrap}><Icon name="image" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Photo from gallery</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickVideo}>
              <View style={styles.menuIconWrap}><Icon name="video" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={pickDocument}>
              <View style={styles.menuIconWrap}><Icon name="file" size={20} color="#fff" /></View>
              <Text style={styles.menuLabel}>File</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuCancel} onPress={() => setShowAttachMenu(false)}>
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {saveRequest && (
        <SaveRequestModal
          request={saveRequest}
          onDecide={async (decision, expiresHours) => {
            try { await api.patch(`/messages/save-requests/${saveRequest.id}`, { decision, expiresHours }) } catch {}
            setSaveRequest(null)
          }}
          onCancel={() => setSaveRequest(null)}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0a0a0a' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1f1f1f' },
  headerCenter:        { alignItems: 'center', flex: 1 },
  headerAvatarRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatar:        { width: 32, height: 32, borderRadius: 16 },
  headerAvatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  headerAvatarInitial: { color: '#fff', fontSize: 13, fontWeight: '700' },
  headerTitle:         { color: '#fff', fontSize: 17, fontWeight: '600' },
  headerStatus:  { color: '#555', fontSize: 12, marginTop: 1 },
  headerTyping:  { color: '#4f6ef7' },
  backBtn:       { width: 36 },
  typingRow:              { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  typingAvatar:           { width: 28, height: 28, borderRadius: 14 },
  typingAvatarPlaceholder:{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  typingAvatarInitial:    { color: '#fff', fontSize: 12, fontWeight: '600' },
  typingBubble:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f1f1f', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  eye:                    { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pupil:                  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#222' },
  audioBubble:   { flexDirection: 'row', alignItems: 'center', gap: 8, width: 160 },
  audioLabel:    { color: '#ccc', fontSize: 14 },
  micBtn:        { padding: 8 },
  recordingBar:  { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1f1f1f', gap: 10 },
  cancelRecBtn:  { padding: 6 },
  recordingPulse:{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff4444' },
  recordingTime: { color: '#fff', fontSize: 16, fontWeight: '600', minWidth: 40 },
  recordingHint: { color: '#666', fontSize: 13, flex: 1 },
  sendRecBtn:    { backgroundColor: '#4f6ef7', borderRadius: 20, padding: 8 },
  searchBar:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f1f1f', gap: 6 },
  searchInput:   { flex: 1, color: '#fff', fontSize: 15, backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  searchCount:   { color: '#888', fontSize: 13, minWidth: 56, textAlign: 'center' },
  searchNav:     { padding: 4 },
  searchHighlight: { backgroundColor: '#4f6ef750', color: '#fff', borderRadius: 3 },
  backText:      { color: '#4f6ef7', fontSize: 22 },
  mineOuter:        { width: '100%', alignItems: 'flex-end', marginBottom: 6 },
  theirsOuter:      { width: '100%', alignItems: 'flex-start', marginBottom: 6 },
  bubbleWrap:       { flexDirection: 'row', alignItems: 'flex-end', maxWidth: '88%' },
  mineWrap:         { justifyContent: 'flex-end' },
  theirsWrap:       { justifyContent: 'flex-start' },
  avatarThumb:      { width: 28, height: 28, borderRadius: 14, marginLeft: 6 },
  avatarPlaceholder:{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  avatarInitial:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  bubble:        { minWidth: 60, borderRadius: 16, padding: 10, flexShrink: 1 },
  bubbleMedia:   { padding: 3 },
  mine:          { backgroundColor: '#4f6ef7' },
  theirs:        { backgroundColor: '#1f1f1f' },
  bubbleText:    { color: '#fff', lineHeight: 22 },
  saveBtn:       { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 4 },
  tickRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, marginRight: 4 },
  tickRowTheirs: { justifyContent: 'flex-start', marginLeft: 4 },
  timestamp:     { color: '#555', fontSize: 11 },
  tick:          { color: '#888', fontSize: 13 },
  tickRead:      { color: '#4fc3f7', fontSize: 13 },
  imagePreview:  { width: 200, height: 200, borderRadius: 10 },
  videoPreview:  { width: 220, height: 160, borderRadius: 10 },
  mediaChip:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  mediaIcon:     { fontSize: 20 },
  mediaLabel:    { color: '#fff', fontSize: 14, flexShrink: 1 },
  inputRow:      { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  requestBar:        { padding: 14, borderTopWidth: 1, borderTopColor: '#1f1f1f', backgroundColor: '#111' },
  requestBarText:    { color: '#aaa', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  bold:              { color: '#fff', fontWeight: '600' },
  requestBarBtns:    { flexDirection: 'row', gap: 10 },
  requestDeclineBtn: { flex: 1, borderWidth: 1, borderColor: '#ff4444', borderRadius: 10, padding: 12, alignItems: 'center' },
  requestDeclineText:{ color: '#ff4444', fontWeight: '600', fontSize: 14 },
  requestAcceptBtn:  { flex: 1, backgroundColor: '#4f6ef7', borderRadius: 10, padding: 12, alignItems: 'center' },
  requestAcceptText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  iconBtn:       { padding: 8, paddingBottom: 10 },
  iconText:      { fontSize: 20 },
  input:         { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 8, maxHeight: 100 },
  sendBtn:       { paddingHorizontal: 8, paddingBottom: 10 },
  sendText:      { color: '#4f6ef7', fontWeight: '600', fontSize: 15 },
  menuOverlay:   { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  menuSheet:     { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  menuTitle:     { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  menuItem:      { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2a2a2a' },
  menuIconWrap:  { width: 36, height: 36, borderRadius: 10, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  menuLabel:     { color: '#fff', fontSize: 16 },
  menuCancel:    { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  menuCancelText:{ color: '#4f6ef7', fontSize: 16 },
  replyQuote:       { borderLeftWidth: 3, borderLeftColor: 'rgba(255,255,255,0.5)', paddingLeft: 8, marginBottom: 6 },
  replyQuoteSender: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  replyQuoteText:   { color: 'rgba(255,255,255,0.65)', fontSize: 13 },
  reactionRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2, marginRight: 4, justifyContent: 'flex-end' },
  reactionRowTheirs: { justifyContent: 'flex-start', marginLeft: 4, marginRight: 0 },
  reactionChip:      { backgroundColor: '#1f1f1f', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#2a2a2a' },
  reactionChipMine:  { borderColor: '#4f6ef7' },
  reactionChipText:  { color: '#fff', fontSize: 13 },
  replyBar:      { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#1f1f1f' },
  replyBarSender:{ color: '#4f6ef7', fontSize: 12, fontWeight: '700' },
  replyBarText:  { color: '#888', fontSize: 13 },
  reactionPickerSheet: { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, gap: 14, alignSelf: 'center', marginBottom: 100 },
  reactionPickerEmoji: { fontSize: 28 },
})
