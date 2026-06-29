import React, { useEffect, useState, useRef } from 'react'
import { AppState } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
import messaging from '@react-native-firebase/messaging'
import { setupPushNotifications } from '../notifications/setup'
import RegisterScreen from '../screens/RegisterScreen'
import LoginScreen from '../screens/LoginScreen'
import ChatsScreen from '../screens/ChatsScreen'
import FindUserScreen from '../screens/FindUserScreen'
import ChatScreen from '../screens/ChatScreen'
import LibraryScreen from '../screens/LibraryScreen'
import ProfileScreen from '../screens/ProfileScreen'
import SetPatternScreen from '../screens/SetPatternScreen'
import PatternLoginScreen from '../screens/PatternLoginScreen'

const Stack = createNativeStackNavigator()
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }

export default function AppNavigator() {
  const [authState, setAuthState] = useState(null)
  const pendingChatRef = useRef(null)
  const appStateRef = useRef(AppState.currentState)

  useEffect(() => {
    async function check() {
      try {
        const initial = await messaging().getInitialNotification()
        if (initial?.data?.senderUsername) {
          pendingChatRef.current = initial.data.senderUsername
        }
      } catch {}

      const token = await AsyncStorage.getItem('token')
      if (!token) { setAuthState('loggedOut'); return }
      const patternEnabled = await AsyncStorage.getItem('blink_pattern_enabled')
      const pattern = await AsyncStorage.getItem('blink_pattern')
      if (patternEnabled === 'true' && pattern) {
        setAuthState('pattern')
      } else {
        setAuthState('locked')
      }
    }
    check()
  }, [])

  useEffect(() => {
    // Notification tapped while app is in background (locked or running)
    const unsub = messaging().onNotificationOpenedApp((remoteMessage) => {
      if (remoteMessage?.data?.senderUsername) {
        pendingChatRef.current = remoteMessage.data.senderUsername
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (authState !== 'loggedIn') return
    let lockTimer = null
    const sub = AppState.addEventListener('change', async (next) => {
      if (appStateRef.current === 'active' && next === 'background') {
        // Grace period — pickers/system dialogs briefly background the app
        lockTimer = setTimeout(async () => {
          const enabled = await AsyncStorage.getItem('blink_pattern_enabled')
          const pattern = await AsyncStorage.getItem('blink_pattern')
          setAuthState(enabled === 'true' && pattern ? 'pattern' : 'locked')
        }, 1500)
      }
      if (next === 'active' && lockTimer) {
        clearTimeout(lockTimer)
        lockTimer = null
      }
      appStateRef.current = next
    })
    return () => sub.remove()
  }, [authState])

  if (authState === null) return null

  function handleLogin() { setAuthState('loggedIn'); setupPushNotifications() }
  function handleLogout() { pendingChatRef.current = null; setAuthState('loggedOut') }
  function handlePatternSuccess() { setAuthState('loggedIn'); setupPushNotifications() }
  function handlePatternFallback() { setAuthState('locked') }
  async function handleLock() {
    const enabled = await AsyncStorage.getItem('blink_pattern_enabled')
    const pattern = await AsyncStorage.getItem('blink_pattern')
    setAuthState(enabled === 'true' && pattern ? 'pattern' : 'locked')
  }

  // Consume pending chat so the next unlock doesn't re-open it
  const pendingSender = pendingChatRef.current
  pendingChatRef.current = null

  // Build initial state so the chat opens immediately after auth, with Chats behind it
  const loggedInInitialState = pendingSender ? {
    index: 1,
    routes: [
      { name: 'Chats' },
      { name: 'Chat', params: { recipientUsername: pendingSender } },
    ],
  } : undefined

  if (authState === 'pattern' || authState === 'locked') {
    return (
      <NavigationContainer key="locked">
        <Stack.Navigator screenOptions={screenOpts}>
          <Stack.Screen name="Login">
            {props => <LoginScreen {...props} onLogin={handleLogin} isLocked />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    )
  }

  if (authState === 'loggedIn') {
    return (
      <NavigationContainer key="loggedIn" initialState={loggedInInitialState}>
        <Stack.Navigator screenOptions={screenOpts}>
          <Stack.Screen name="Chats" component={ChatsScreen} />
          <Stack.Screen name="FindUser" component={FindUserScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Library" component={LibraryScreen} />
          <Stack.Screen name="Profile">
            {props => <ProfileScreen {...props} onLogout={handleLogout} onLock={handleLock} />}
          </Stack.Screen>
          <Stack.Screen name="SetPattern" component={SetPatternScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    )
  }

  // loggedOut
  return (
    <NavigationContainer key="loggedOut">
      <Stack.Navigator screenOptions={screenOpts}>
        <Stack.Screen name="Login">
          {props => <LoginScreen {...props} onLogin={handleLogin} />}
        </Stack.Screen>
        <Stack.Screen name="Register">
          {props => <RegisterScreen {...props} onLogin={handleLogin} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  )
}
