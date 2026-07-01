import React, { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert, Pressable } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Svg, { Path, Line, Circle, Polyline, Rect, G } from 'react-native-svg'
import RNFS from 'react-native-fs'
import { api } from '../api/client'
import ExtendRequestModal from '../components/ExtendRequestModal'

const AVATAR_PATH = `${RNFS.DocumentDirectoryPath}/blink_avatar.jpg`

function BlockIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke="#ff8c00" strokeWidth="2" />
      <Line x1="4.93" y1="4.93" x2="19.07" y2="19.07" stroke="#ff8c00" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  )
}

function TrashIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Polyline points="3 6 5 6 21 6" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 11v6M14 11v6" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" />
      <Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

function FeatherIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="16" y1="8" x2="2" y2="22" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="17.5" y1="15" x2="9" y2="15" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

function PersonIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke="#888" strokeWidth="1.8" />
      <Path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  )
}

export default function ChatsScreen({ navigation }) {
  const [conversations, setConversations] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [avatarUri, setAvatarUri] = useState(null)
  const [openMenu, setOpenMenu] = useState(null)
  const [openGroupMenu, setOpenGroupMenu] = useState(null)
  const [extendRequest, setExtendRequest] = useState(null) // pending extend request for sender to decide
  const isFocused = useRef(false)

  function loadConversations() {
    api.get('/messages/conversations')
      .then(({ conversations: c }) => setConversations(c))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  function loadGroups() {
    api.get('/groups').then(({ groups: g }) => setGroups(g)).catch(() => {})
  }

  useFocusEffect(useCallback(() => {
    isFocused.current = true
    loadConversations()
    loadGroups()
    RNFS.exists(AVATAR_PATH).then(exists => {
      if (exists) setAvatarUri(`file://${AVATAR_PATH}?t=${Date.now()}`)
      else setAvatarUri(null)
    })
    return () => { isFocused.current = false }
  }, []))

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isFocused.current) return
      loadConversations()
      loadGroups()
      api.get('/messages/extend-requests/pending')
        .then(({ requests }) => { if (requests.length && !extendRequest) setExtendRequest(requests[0]) })
        .catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [extendRequest])

  async function handleExtendDecide(decision, hours) {
    if (!extendRequest) return
    try {
      await api.patch(`/messages/extend-requests/${extendRequest.id}`, { decision, expiresHours: hours ?? undefined })
    } catch {}
    setExtendRequest(null)
  }

  function blockUser(username) {
    Alert.alert(
      'Block user?',
      `${username} won't be able to send you messages. You can unblock them from their profile.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: async () => {
          try {
            await api.post(`/users/block/${username}`)
            Alert.alert('Blocked', `${username} has been blocked.`)
          } catch (err) {
            Alert.alert('Error', err.message)
          }
        }},
      ]
    )
  }

  function leaveGroup(group) {
    Alert.alert('Leave group?', `You'll no longer receive messages from ${group.name}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/groups/${group.id}/members/me`)
            setGroups(prev => prev.filter(g => g.id !== group.id))
          } catch (err) {
            Alert.alert('Error', err.message)
          }
        }
      },
    ])
  }

  function deleteConversation(username) {
    Alert.alert('Delete chat', `Delete all messages with ${username}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/messages/conversation/${username}`)
            setConversations(prev => prev.filter(c => c.other_username !== username))
          } catch (err) {
            Alert.alert('Error', err.message)
          }
        }
      },
    ])
  }

  function renderGroupItem({ item }) {
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => navigation.navigate('GroupChat', { groupId: item.id, groupName: item.name })}
        >
          {item.avatar
            ? <Image source={{ uri: `data:image/jpeg;base64,${item.avatar}` }} style={styles.avatarImg} />
            : <View style={styles.groupAvatar}><Text style={styles.avatarText}>{item.name[0].toUpperCase()}</Text></View>
          }
          <Text style={styles.username}>{item.name}</Text>
          {item.unread_count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.chatLibBtn} onPress={() => setOpenGroupMenu(prev => prev === item.id ? null : item.id)}>
          <Text style={styles.dotsIcon}>⋮</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.chatLibBtn}
          onPress={() => navigation.navigate('Library', { fromGroupId: item.id, groupName: item.name })}
        >
          <FeatherIcon />
        </TouchableOpacity>
      </View>
    )
  }

  function renderItem({ item }) {
    const u = item.other_username
    return (
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => { setOpenMenu(null); navigation.navigate('Chat', { recipientUsername: u, recipientPublicKey: item.other_public_key, requested: item.requested }) }}
        >
          {item.other_avatar
            ? <Image source={{ uri: `data:image/jpeg;base64,${item.other_avatar}` }} style={styles.avatarImg} />
            : <View style={styles.avatar}><Text style={styles.avatarText}>{u[0].toUpperCase()}</Text></View>
          }
          <Text style={styles.username}>{u}</Text>
          {item.requested && (
            <View style={styles.requestBadge}>
              <Text style={styles.requestBadgeText}>Request</Text>
            </View>
          )}
          {item.unread_count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.chatLibBtn} onPress={() => setOpenMenu(prev => prev === u ? null : u)}>
          <Text style={styles.dotsIcon}>⋮</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.chatLibBtn}
          onPress={() => { setOpenMenu(null); navigation.navigate('Library', { fromUsername: u }) }}
        >
          <FeatherIcon />
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {extendRequest && (
        <ExtendRequestModal request={extendRequest} onDecide={handleExtendDecide} />
      )}
      {openMenu && (
        <Pressable style={styles.menuBackdrop} onPress={() => setOpenMenu(null)}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity style={styles.dropdownItem} onPress={() => { setOpenMenu(null); blockUser(openMenu) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <BlockIcon />
                <Text style={styles.dropdownBlock}>Block User</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.dropdownDivider} />
            <TouchableOpacity style={styles.dropdownItem} onPress={() => { setOpenMenu(null); deleteConversation(openMenu) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TrashIcon />
                <Text style={styles.dropdownDelete}>Delete Chat</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}
      {openGroupMenu && (
        <Pressable style={styles.menuBackdrop} onPress={() => setOpenGroupMenu(null)}>
          <View style={styles.dropdownMenu}>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => {
                const group = groups.find(g => g.id === openGroupMenu)
                setOpenGroupMenu(null)
                navigation.navigate('GroupInfo', { groupId: group.id, groupName: group.name })
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <PersonIcon />
                <Text style={styles.dropdownBlock}>Group Info</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.dropdownDivider} />
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => {
                const group = groups.find(g => g.id === openGroupMenu)
                setOpenGroupMenu(null)
                leaveGroup(group)
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TrashIcon />
                <Text style={styles.dropdownDelete}>Leave Group</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}
      <View style={styles.topRow}>
        {/* Left: gallery + BLE */}
        <View style={styles.topLeft}>
          <TouchableOpacity onPress={() => navigation.navigate('Library')} style={styles.iconBtn}>
            <FeatherIcon />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('BleTest')} style={[styles.iconBtn, { marginLeft: 8 }]}>
            <Text style={{ color: '#4f6ef7', fontSize: 11, fontWeight: '700' }}>BLE</Text>
          </TouchableOpacity>
        </View>

        {/* Center: Blink title */}
        <Text style={styles.title}>Blink</Text>

        {/* Right: profile */}
        <View style={styles.topRight}>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.iconBtn}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileThumb} />
            ) : (
              <PersonIcon />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.newChatRow}>
        <TouchableOpacity style={[styles.newChat, { flex: 1 }]} onPress={() => navigation.navigate('FindUser')}>
          <Text style={styles.newChatText}>+ New conversation</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.newChat, styles.newGroupBtn]} onPress={() => navigation.navigate('CreateGroup')}>
          <Text style={styles.newChatText}>+ Group</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.hint}>Loading…</Text>
      ) : conversations.length === 0 && groups.length === 0 ? (
        <Text style={styles.hint}>No conversations yet — start one above</Text>
      ) : (
        <FlatList
          data={[
            ...groups.map(g => ({ ...g, __type: 'group' })),
            ...conversations.map(c => ({ ...c, __type: 'dm' })),
          ]}
          keyExtractor={i => i.__type === 'group' ? `g_${i.id}` : i.other_username}
          renderItem={({ item }) => item.__type === 'group' ? renderGroupItem({ item }) : renderItem({ item })}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a' },
  topRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  topLeft:      { flexDirection: 'row', alignItems: 'center', flex: 1 },
  topRight:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flex: 1 },
  title:        { fontSize: 28, fontWeight: '700', color: '#fff' },
  iconBtn:      { padding: 4 },
  profileThumb: { width: 28, height: 28, borderRadius: 14 },
  newChatRow:   { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginVertical: 12 },
  newChat:      { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 14, alignItems: 'center' },
  newGroupBtn:  { paddingHorizontal: 18 },
  newChatText:  { color: '#fff', fontWeight: '600', fontSize: 15 },
  groupAvatar:  { width: 44, height: 44, borderRadius: 22, backgroundColor: '#8c52ff', alignItems: 'center', justifyContent: 'center' },
  row:          { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  rowMain:      { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 14 },
  chatLibBtn:   { paddingHorizontal: 10, paddingVertical: 14 },
  dotsIcon:     { color: '#888', fontSize: 20, paddingHorizontal: 4 },
  menuBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 },
  dropdownMenu: { position: 'absolute', top: 120, right: 16, backgroundColor: '#1e1e1e', borderRadius: 10, paddingVertical: 6, minWidth: 160, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 },
  dropdownItem: { paddingHorizontal: 16, paddingVertical: 12 },
  dropdownDelete:  { color: '#ff4444', fontSize: 15, fontWeight: '500' },
  dropdownBlock:   { color: '#ff8c00', fontSize: 15, fontWeight: '500' },
  dropdownDivider: { height: 1, backgroundColor: '#2a2a2a', marginHorizontal: 12 },
  avatar:       { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarImg:    { width: 44, height: 44, borderRadius: 22 },
  avatarText:   { color: '#fff', fontSize: 18, fontWeight: '700' },
  username:     { color: '#fff', fontSize: 16, fontWeight: '500', flex: 1 },
  badge:        { backgroundColor: '#4f6ef7', borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  badgeText:    { color: '#fff', fontSize: 11, fontWeight: '700' },
  requestBadge:     { backgroundColor: '#ff8c0022', borderWidth: 1, borderColor: '#ff8c00', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  requestBadgeText: { color: '#ff8c00', fontSize: 10, fontWeight: '700' },
  hint:         { color: '#555', textAlign: 'center', marginTop: 60, fontSize: 15 },
})
