import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import nacl from 'tweetnacl'
import { api } from '../api/client'
import { encryptGroupKey } from '../crypto/keys'

export default function CreateGroupScreen({ navigation }) {
  const [groupName, setGroupName] = useState('')
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState([])   // [{ username, publicKey }]
  const [adding, setAdding]       = useState(false)
  const [creating, setCreating]   = useState(false)

  async function addMember() {
    const q = search.trim().toLowerCase()
    if (!q) return
    if (selected.find(u => u.username === q)) {
      Alert.alert('Already added', `${q} is already in the group.`)
      return
    }
    setAdding(true)
    try {
      const myUsername = (await AsyncStorage.getItem('username') ?? '').toLowerCase()
      if (q === myUsername) { Alert.alert('That\'s you', 'You are added automatically.'); return }
      const { username, publicKey } = await api.get(`/users/${q}`)
      setSelected(prev => [...prev, { username, publicKey }])
      setSearch('')
    } catch {
      Alert.alert('Not found', `No user named "${q}" exists.`)
    } finally {
      setAdding(false)
    }
  }

  function removeMember(username) {
    setSelected(prev => prev.filter(u => u.username !== username))
  }

  async function createGroup() {
    const name = groupName.trim()
    if (!name) return Alert.alert('Group name required')
    if (selected.length === 0) return Alert.alert('Add at least one member')

    setCreating(true)
    try {
      const myUsername = await AsyncStorage.getItem('username')
      const { publicKey: ownPublicKey } = await api.get(`/users/${myUsername}`)

      // Generate the group secret key
      const groupKeyBytes = nacl.randomBytes(32)

      // Encrypt it for every member including ourselves
      const allMembers = [{ username: myUsername, publicKey: ownPublicKey }, ...selected]
      const memberPayloads = await Promise.all(
        allMembers.map(async (m) => {
          const { encryptedGroupKey, keyNonce } = await encryptGroupKey(groupKeyBytes, m.publicKey)
          return { username: m.username, encryptedGroupKey, keyNonce }
        })
      )

      const { groupId } = await api.post('/groups', { name, members: memberPayloads })
      navigation.replace('GroupChat', { groupId, groupName: name })
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>New Group</Text>

      <TextInput
        style={styles.input}
        placeholder="Group name"
        placeholderTextColor="#555"
        value={groupName}
        onChangeText={setGroupName}
        maxLength={50}
      />

      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          placeholder="Add member by username"
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          onSubmitEditing={addMember}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addMember} disabled={adding}>
          {adding ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.addBtnText}>Add</Text>}
        </TouchableOpacity>
      </View>

      {selected.length > 0 && (
        <View style={styles.memberList}>
          <Text style={styles.memberListLabel}>Members ({selected.length + 1})</Text>
          <View style={styles.youChip}>
            <Text style={styles.youChipText}>You (admin)</Text>
          </View>
          {selected.map(u => (
            <View key={u.username} style={styles.memberRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{u.username[0].toUpperCase()}</Text>
              </View>
              <Text style={styles.memberName}>{u.username}</Text>
              <TouchableOpacity onPress={() => removeMember(u.username)} style={styles.removeBtn}>
                <Text style={styles.removeText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.createBtn, (creating || !groupName.trim() || selected.length === 0) && styles.createBtnDisabled]}
        onPress={createGroup}
        disabled={creating || !groupName.trim() || selected.length === 0}
      >
        {creating
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.createBtnText}>Create Group</Text>
        }
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 50 },
  backBtn:          { marginBottom: 16 },
  backText:         { color: '#4f6ef7', fontSize: 16 },
  title:            { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 20 },
  input:            { backgroundColor: '#1a1a1a', borderRadius: 10, color: '#fff', padding: 14, fontSize: 15, marginBottom: 12 },
  addRow:           { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  addBtn:           { backgroundColor: '#4f6ef7', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 14 },
  addBtnText:       { color: '#fff', fontWeight: '600', fontSize: 15 },
  memberList:       { flex: 1, marginBottom: 12 },
  memberListLabel:  { color: '#888', fontSize: 13, marginBottom: 10 },
  youChip:          { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#4f6ef7' },
  youChipText:      { color: '#4f6ef7', fontSize: 15, fontWeight: '600' },
  memberRow:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8, gap: 12 },
  avatar:           { width: 36, height: 36, borderRadius: 18, backgroundColor: '#4f6ef7', alignItems: 'center', justifyContent: 'center' },
  avatarText:       { color: '#fff', fontSize: 14, fontWeight: '700' },
  memberName:       { color: '#fff', fontSize: 15, flex: 1 },
  removeBtn:        { padding: 4 },
  removeText:       { color: '#ff4444', fontSize: 16 },
  createBtn:        { backgroundColor: '#4f6ef7', borderRadius: 10, padding: 16, alignItems: 'center' },
  createBtnDisabled:{ opacity: 0.4 },
  createBtnText:    { color: '#fff', fontWeight: '700', fontSize: 16 },
})
