import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator, Image,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { launchImageLibrary } from 'react-native-image-picker'
import { api } from '../api/client'
import { decryptGroupKey, encryptGroupKey } from '../crypto/keys'
import Icon from 'react-native-vector-icons/Feather'

export default function GroupInfoScreen({ route, navigation }) {
  const { groupId, groupName } = route.params
  const [members, setMembers]   = useState([])
  const [myUsername, setMyUsername] = useState('')
  const [myRole, setMyRole]     = useState('member')
  const [addUsername, setAddUsername] = useState('')
  const [adding, setAdding]     = useState(false)
  const [leaving, setLeaving]   = useState(false)
  const [groupKeyBytes, setGroupKeyBytes] = useState(null)
  const [avatar, setAvatar]     = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  const load = useCallback(async () => {
    const me = await AsyncStorage.getItem('username')
    setMyUsername(me ?? '')
    try {
      const group = await api.get(`/groups/${groupId}`)
      setMembers(group.members ?? [])
      setMyRole(group.myRole)
      setAvatar(group.avatar ?? null)
      const keyBytes = await decryptGroupKey(group.myEncryptedGroupKey, group.myKeyNonce, group.keySenderPublicKey)
      setGroupKeyBytes(keyBytes)
    } catch (e) {
      Alert.alert('Error', e.message)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  async function addMember() {
    const username = addUsername.trim().toLowerCase()
    if (!username) return
    if (myRole !== 'admin') return Alert.alert('Only admins can add members')
    if (!groupKeyBytes) return Alert.alert('Group key not ready yet')

    setAdding(true)
    try {
      const { publicKey } = await api.get(`/users/${username}`)
      const { encryptedGroupKey, keyNonce } = await encryptGroupKey(groupKeyBytes, publicKey)
      await api.post(`/groups/${groupId}/members`, { username, encryptedGroupKey, keyNonce })
      setAddUsername('')
      load()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setAdding(false)
    }
  }

  async function pickAvatar() {
    const result = await launchImageLibrary({ mediaType: 'photo', includeBase64: true, quality: 0.5, maxWidth: 400, maxHeight: 400 })
    if (result.didCancel || !result.assets?.[0]) return
    const base64 = result.assets[0].base64
    if (!base64) return
    setAvatarUploading(true)
    try {
      await api.put(`/groups/${groupId}/avatar`, { avatar: base64 })
      setAvatar(base64)
    } catch (e) {
      Alert.alert('Upload failed', e.message)
    } finally {
      setAvatarUploading(false)
    }
  }

  function removeMember(member) {
    Alert.alert('Remove member?', `${member.username} will be removed from ${groupName}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/groups/${groupId}/members/${member.username}`)
            setMembers(prev => prev.filter(m => m.username !== member.username))
          } catch (e) {
            Alert.alert('Error', e.message)
          }
        }
      },
    ])
  }

  function leaveGroup() {
    Alert.alert('Leave group?', `You'll no longer receive messages from ${groupName}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          setLeaving(true)
          try {
            await api.delete(`/groups/${groupId}/members/me`)
            navigation.popToTop()
          } catch (e) {
            Alert.alert('Error', e.message)
          } finally {
            setLeaving(false)
          }
        }
      },
    ])
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Icon name="arrow-left" size={22} color="#fff" />
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <TouchableOpacity style={styles.groupAvatarWrap} onPress={pickAvatar} disabled={avatarUploading}>
          {avatar ? (
            <Image source={{ uri: `data:image/jpeg;base64,${avatar}` }} style={styles.groupAvatarImg} />
          ) : (
            <View style={styles.groupAvatar}>
              <Icon name="users" size={28} color="#fff" />
            </View>
          )}
          <View style={styles.avatarBadge}>
            {avatarUploading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.avatarBadgeText}>Edit</Text>}
          </View>
        </TouchableOpacity>
        <Text style={styles.groupName}>{groupName}</Text>
        <Text style={styles.memberCount}>{members.length} members</Text>
      </View>

      {myRole === 'admin' && (
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Add member by username"
            placeholderTextColor="#555"
            value={addUsername}
            onChangeText={setAddUsername}
            autoCapitalize="none"
            onSubmitEditing={addMember}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addMember} disabled={adding}>
            {adding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnText}>Add</Text>}
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={members}
        keyExtractor={m => m.username}
        style={{ flex: 1 }}
        renderItem={({ item }) => (
          <View style={styles.memberRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.username[0].toUpperCase()}</Text>
            </View>
            <Text style={styles.memberName}>
              {item.username}{item.username === myUsername ? ' (you)' : ''}
            </Text>
            {item.role === 'admin' && <Text style={styles.adminTag}>Admin</Text>}
            {myRole === 'admin' && item.username !== myUsername && (
              <TouchableOpacity onPress={() => removeMember(item)} style={styles.removeBtn}>
                <Icon name="user-x" size={18} color="#ff4444" />
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      <TouchableOpacity style={styles.leaveBtn} onPress={leaveGroup} disabled={leaving}>
        {leaving ? <ActivityIndicator color="#ff4444" /> : <Text style={styles.leaveBtnText}>Leave Group</Text>}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 50 },
  backBtn:        { marginBottom: 16 },
  headerBlock:    { alignItems: 'center', marginBottom: 24 },
  groupAvatarWrap:{ marginBottom: 10, position: 'relative' },
  groupAvatar:    { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  groupAvatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarBadge:    { position: 'absolute', bottom: -2, right: -2, backgroundColor: '#1f1f1f', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: '#333' },
  avatarBadgeText:{ color: '#aaa', fontSize: 11 },
  groupName:      { color: '#fff', fontSize: 20, fontWeight: '700' },
  memberCount:    { color: '#888', fontSize: 13, marginTop: 2 },
  addRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  input:          { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, color: '#fff', padding: 12, fontSize: 14 },
  addBtn:         { backgroundColor: '#4f6ef7', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  addBtnText:     { color: '#fff', fontWeight: '600' },
  memberRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 12 },
  avatar:         { width: 40, height: 40, borderRadius: 20, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  avatarText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  memberName:     { color: '#fff', fontSize: 15, flex: 1 },
  adminTag:       { color: '#4f6ef7', fontSize: 12, fontWeight: '700' },
  removeBtn:      { padding: 4, marginLeft: 8 },
  leaveBtn:       { borderWidth: 1, borderColor: '#ff4444', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  leaveBtnText:   { color: '#ff4444', fontWeight: '600', fontSize: 15 },
})
