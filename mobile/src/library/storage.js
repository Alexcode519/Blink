import AsyncStorage from '@react-native-async-storage/async-storage'
import RNFS from 'react-native-fs'

const INDEX_KEY = 'blink_library_index'
const LIB_DIR   = `${RNFS.DocumentDirectoryPath}/BlinkLibrary`

async function ensureDir() {
  const exists = await RNFS.exists(LIB_DIR)
  if (!exists) await RNFS.mkdir(LIB_DIR)
}

export async function saveToLibrary({ payload, contentType, label, fromUsername }) {
  await ensureDir()
  const ext = contentType === 'image' ? 'jpg' : contentType === 'video' ? 'mp4' : 'bin'
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  const filename = `${id}.${ext}`
  const path = `${LIB_DIR}/${filename}`

  await RNFS.writeFile(path, payload, 'base64')

  const index = await loadIndex()
  index.push({ id, filename, path, contentType, label: label ?? filename, fromUsername, savedAt: Date.now() })
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index))
  return id
}

export async function loadIndex() {
  const raw = await AsyncStorage.getItem(INDEX_KEY)
  return raw ? JSON.parse(raw) : []
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
