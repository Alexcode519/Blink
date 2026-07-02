import AsyncStorage from '@react-native-async-storage/async-storage'

const BASE_URL = 'https://creative-recreation-production-41a9.up.railway.app'
const TIMEOUT_MS = 15000

// In-memory token cache — avoids an AsyncStorage read on every request
let _token = null

export async function initToken() {
  _token = await AsyncStorage.getItem('token')
}
export function setToken(tok) {
  _token = tok
  if (tok) AsyncStorage.setItem('token', tok).catch(() => {})
  else AsyncStorage.removeItem('token').catch(() => {})
}
export function clearToken() { _token = null; AsyncStorage.removeItem('token').catch(() => {}) }

function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

async function request(method, path, body) {
  // Fall back to AsyncStorage if module just loaded and initToken not yet called
  const token = _token ?? await AsyncStorage.getItem('token')
  try {
    const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Request failed')
    return data
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out — check your connection')
    throw err
  }
}

export const api = {
  post:   (path, body) => request('POST',   path, body),
  get:    (path)       => request('GET',    path),
  put:    (path, body) => request('PUT',    path, body),
  patch:  (path, body) => request('PATCH',  path, body),
  delete: (path)       => request('DELETE', path),
}
