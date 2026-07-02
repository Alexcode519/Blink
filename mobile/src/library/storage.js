import AsyncStorage from '@react-native-async-storage/async-storage'
import RNFS from 'react-native-fs'

const INDEX_KEY = 'blink_library_index'
const LIB_DIR   = `${RNFS.DocumentDirectoryPath}/BlinkLibrary`

async function ensureDir() {
  const exists = await RNFS.exists(LIB_DIR)
  if (!exists) await RNFS.mkdir(LIB_DIR)
}

export async function saveToLibrary({ payload, contentType, label, fromUsername, fromGroupId, groupName, expiresAt, messageId }) {
  await ensureDir()
  const ext = contentType === 'image' ? 'jpg' : contentType === 'video' ? 'mp4' : 'bin'
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const filename = `${id}.${ext}`
  const path = `${LIB_DIR}/${filename}`

  if (typeof payload === 'string' && payload.startsWith('file://')) {
    await RNFS.copyFile(payload.replace('file://', ''), path)
  } else {
    await RNFS.writeFile(path, payload, 'base64')
  }

  const index = await loadIndex(false)
  index.push({ id, filename, path, contentType, label: label ?? filename, fromUsername, fromGroupId: fromGroupId ?? null, groupName: groupName ?? null, savedAt: Date.now(), expiresAt: expiresAt ?? null, messageId: messageId ?? null })
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index))
  return id
}

export async function loadIndex(pruneExpired = true) {
  const raw = await AsyncStorage.getItem(INDEX_KEY)
  const index = raw ? JSON.parse(raw) : []
  if (!pruneExpired) return index

  const now = Date.now()
  const expired = index.filter(i => i.expiresAt && new Date(i.expiresAt).getTime() <= now)
  const valid   = index.filter(i => !i.expiresAt || new Date(i.expiresAt).getTime() > now)

  if (expired.length) {
    for (const item of expired) {
      try { await RNFS.unlink(item.path) } catch {}
    }
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(valid))
  }

  return valid
}

export async function updateExpiresAt(id, expiresAt) {
  const index = await loadIndex(false)
  const updated = index.map(i => i.id === id ? { ...i, expiresAt: expiresAt ?? null } : i)
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(updated))
}

export async function deleteItem(id) {
  const index = await loadIndex()
  const item = index.find(i => i.id === id)
  if (item) {
    try { await RNFS.unlink(item.path) } catch {}
  }
  const updated = index.filter(i => i.id !== id)
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(updated))
}
