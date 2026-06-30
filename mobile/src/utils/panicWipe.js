import AsyncStorage from '@react-native-async-storage/async-storage'
import RNFS from 'react-native-fs'

const LIBRARY_DIR = `${RNFS.DocumentDirectoryPath}/BlinkLibrary`

// Wipes everything locally cached that could expose past conversations —
// per-chat message caches and saved Library media. Deliberately silent and
// fails open (never throws) so it can run ahead of a duress unlock without
// any visible sign anything happened.
export async function panicWipe() {
  try {
    const keys = await AsyncStorage.getAllKeys()
    const chatCacheKeys = keys.filter(k => k.startsWith('blink_chat_'))
    if (chatCacheKeys.length) await AsyncStorage.multiRemove(chatCacheKeys)
    await AsyncStorage.removeItem('blink_library_index')
  } catch {}
  try {
    const exists = await RNFS.exists(LIBRARY_DIR)
    if (exists) await RNFS.unlink(LIBRARY_DIR)
  } catch {}
}
