import AsyncStorage from '@react-native-async-storage/async-storage'

const BASE_URL = 'http://localhost:3000'

async function request(method, path, body) {
  const token = await AsyncStorage.getItem('token')
  const res = await fetch(`${BASE_URL}${path}`, {
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
}

export const api = {
  post: (path, body) => request('POST', path, body),
  get:  (path)       => request('GET',  path),
  patch: (path, body) => request('PATCH', path, body),
}
