import React, { useEffect, useState, useRef } from 'react'
import { AppState } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
import messaging from '@react-native-firebase/messaging'
import { setupPushNotifications } from '../notifications/setup'
import { syncPublicKey } from '../crypto/keys'
import { api } from '../api/client'
import { pickerGuard } from '../utils/pickerGuard'
import RegisterScreen from '../screens/RegisterScreen'
import LoginScreen from '../screens/LoginScreen'
import ChatsScreen from '../screens/ChatsScreen'
import FindUserScreen from '../screens/FindUserScreen'
import ChatScreen from '../screens/ChatScreen'
import LibraryScreen from '../screens/LibraryScreen'
import ProfileScreen from '../screens/ProfileScreen'
import SetPatternScreen from '../screens/SetPatternScreen'
import PatternLoginScreen from '../screens/PatternLoginScreen'
import FAQScreen from '../screens/FAQScreen'
import FeedbackScreen from '../screens/FeedbackScreen'
import CreateGroupScreen from '../screens/CreateGroupScreen'
import GroupChatScreen from '../screens/GroupChatScreen'
import GroupInfoScreen from '../screens/GroupInfoScreen'
import SafetyNumberScreen from '../screens/SafetyNumberScreen'

const Stack = createNativeStackNavigator()
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }

export default function AppNavigator() {
  const [authState, setAuthState] = useState(null)
  const pendingChatRef = useRef(null)
  const appStateRef = useRef(AppState.currentState)
  const wasBackgroundRef = useRef(false)

  useEffect(() => {
    async function check() {
      try {
        const initial = await messaging().getInitialNotification()
        if (initial?.data?.type === 'new_group_message' && initial?.data?.groupId) {
          pendingChatRef.current = { group: true, groupId: initial.data.groupId }
        } else if (initial?.data?.senderUsername) {
          pendingChatRef.current = { group: false, senderUsername: initial.data.senderUsername }
        }
      } catch {}

      const token = await AsyncStorage.getItem('token')
      if (!token) { setAuthState('loggedOut'); return }
      // Re-upload public key derived from stored private key — self-heals any server/device mismatch
      try {
        const publicKey = await syncPublicKey()
        await api.patch('/users/me/public-key', { publicKey })
      } catch {}

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
      if (remoteMessage?.data?.type === 'new_group_message' && remoteMessage?.data?.groupId) {
        pendingChatRef.current = { group: true, groupId: remoteMessage.data.groupId }
      } else if (remoteMessage?.data?.senderUsername) {
        pendingChatRef.current = { group: false, senderUsername: remoteMessage.data.senderUsername }
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (authState !== 'loggedIn') return
    const sub = AppState.addEventListener('change', async (next) => {
      if (appStateRef.current === 'active' && next === 'background') {
        if (!pickerGuard.isActive()) wasBackgroundRef.current = true
      }
      if (next === 'active' && wasBackgroundRef.current) {
        wasBackgroundRef.current = false
        const enabled = await AsyncStorage.getItem('blink_pattern_enabled')
        const pattern = await AsyncStorage.getItem('blink_pattern')
        setAuthState(enabled === 'true' && pattern ? 'pattern' : 'locked')
      }
      appStateRef.current = next
    })
    return () => sub.remove()
  }, [authState])

  if (authState === null) return null

  async function handleLogin() {
    wasBackgroundRef.current = false
    await setupPushNotifications()   // request permissions BEFORE lock listener is active
    setAuthState('loggedIn')
  }
  function handleLogout() { pendingChatRef.current = null; setAuthState('loggedOut') }
  async function handlePatternSuccess() {
    wasBackgroundRef.current = false
    await setupPushNotifications()
    setAuthState('loggedIn')
  }
  function handlePatternFallback() { setAuthState('locked') }
  async function handleLock() {
    const enabled = await AsyncStorage.getItem('blink_pattern_enabled')
    const pattern = await AsyncStorage.getItem('blink_pattern')
    setAuthState(enabled === 'true' && pattern ? 'pattern' : 'locked')
  }

  // Consume pending chat so the next unlock doesn't re-open it
  const pendingChat = pendingChatRef.current
  pendingChatRef.current = null

  // Build initial state so the chat opens immediately after auth, with Chats behind it
  const loggedInInitialState = pendingChat ? {
    index: 1,
    routes: pendingChat.group
      ? [{ name: 'Chats' }, { name: 'GroupChat', params: { groupId: pendingChat.groupId } }]
      : [{ name: 'Chats' }, { name: 'Chat', params: { recipientUsername: pendingChat.senderUsername } }],
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
          <Stack.Screen name="FAQ" component={FAQScreen} />
          <Stack.Screen name="Feedback" component={FeedbackScreen} />
          <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
          <Stack.Screen name="GroupChat" component={GroupChatScreen} />
          <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
          <Stack.Screen name="SafetyNumber" component={SafetyNumberScreen} />
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
