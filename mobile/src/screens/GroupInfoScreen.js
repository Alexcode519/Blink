import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
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

  const load = useCallback(async () => {
    const me = await AsyncStorage.getItem('username')
    setMyUsername(me ?? '')
    try {
      const group = await api.get(`/groups/${groupId}`)
      setMembers(group.members ?? [])
      setMyRole(group.myRole)
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
        <View style={styles.groupAvatar}>
          <Icon name="users" size={28} color="#fff" />
        </View>
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
  groupAvatar:    { width: 72, height: 72, borderRadius: 36, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
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
  leaveBtn:       { borderWidth: 1, borderColor: '#ff4444', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  leaveBtnText:   { color: '#ff4444', fontWeight: '600', fontSize: 15 },
})
