import React, { useEffect, useState, useRef, useCallback } from 'react'
import { AppState, Linking } from 'react-native'
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
import messaging from '@react-native-firebase/messaging'
import notifee from '@notifee/react-native'
import { setupPushNotifications } from '../notifications/setup'
import { syncPublicKey } from '../crypto/keys'
import { api, initToken } from '../api/client'
import { pickerGuard } from '../utils/pickerGuard'
import { startMeshBridge, stopMeshBridge } from '../mesh/MeshBridge'
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
import BleTestScreen from '../screens/BleTestScreen'
import OnboardingScreen from '../screens/OnboardingScreen'
import InviteReviewScreen from '../screens/InviteReviewScreen'
import QRInviteScreen from '../screens/QRInviteScreen'
import QRClaimScreen from '../screens/QRClaimScreen'

const Stack = createNativeStackNavigator()
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }

const linking = {
  prefixes: [
    'blink://',
    'https://creative-recreation-production-41a9.up.railway.app',
  ],
  config: {
    screens: {
      QRClaim: 'invite/:token',
    },
  },
}

export default function AppNavigator() {
  const [authState, setAuthState] = useState(null)
  const [initialRoute, setInitialRoute] = useState(null)
  const showQRAfterLoginRef = useRef(false)
  const pendingChatRef = useRef(null)
  const appStateRef = useRef(AppState.currentState)
  const wasBackgroundRef = useRef(false)
  const navRef = useNavigationContainerRef()

  // Load onboarding state at top level so hooks are never conditional
  useEffect(() => {
    AsyncStorage.getItem('blink_onboarded').then(v => setInitialRoute(v ? 'Login' : 'Onboarding'))
  }, [])

  useEffect(() => {
    async function check() {
      await initToken()   // warm the token cache before any API call
      try {
        // Check both Firebase (data-only foreground path) and Notifee (background.js cold-start path)
        const initial = await messaging().getInitialNotification()
        const notifeeInitial = await notifee.getInitialNotification()
        const d = initial?.data ?? notifeeInitial?.notification?.data
        if (d?.type === 'new_group_message' && d?.groupId) {
          pendingChatRef.current = { group: true, groupId: d.groupId }
        } else if (d?.type === 'group_save_request' && d?.groupId) {
          pendingChatRef.current = { group: true, groupId: d.groupId }
        } else if (d?.type === 'save_request' && d?.requesterUsername) {
          pendingChatRef.current = { group: false, senderUsername: d.requesterUsername }
        } else if (d?.type === 'contact_invite') {
          // Leave pendingChatRef null — ChatsScreen shows the invite banner on focus
        } else if (d?.type === 'qr_claimed' && d?.claimerUsername) {
          pendingChatRef.current = { group: false, senderUsername: d.claimerUsername }
        } else if (d?.senderUsername) {
          pendingChatRef.current = { group: false, senderUsername: d.senderUsername }
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
      const d = remoteMessage?.data
      if (d?.type === 'new_group_message' && d?.groupId) {
        pendingChatRef.current = { group: true, groupId: d.groupId }
      } else if (d?.type === 'group_save_request' && d?.groupId) {
        pendingChatRef.current = { group: true, groupId: d.groupId }
      } else if (d?.type === 'save_request' && d?.requesterUsername) {
        pendingChatRef.current = { group: false, senderUsername: d.requesterUsername }
      } else if (d?.type === 'contact_invite') {
        // Leave pendingChatRef null — ChatsScreen shows the invite banner on focus
      } else if (d?.type === 'qr_claimed' && d?.claimerUsername) {
        pendingChatRef.current = { group: false, senderUsername: d.claimerUsername }
      } else if (d?.senderUsername) {
        pendingChatRef.current = { group: false, senderUsername: d.senderUsername }
      }
    })
    return () => unsub()
  }, [])

  // Suppress lock when app is opened via a deep link (QR invite, etc.)
  useEffect(() => {
    const sub = Linking.addEventListener('url', () => {
      wasBackgroundRef.current = false
    })
    return () => sub.remove()
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
    startMeshBridge((bridged, errors) => {
      if (bridged > 0) console.log(`[MeshBridge] bridged ${bridged} msgs to server (${errors} errors)`)
    })
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

  if (authState === 'pattern' || authState === 'locked') {
    return (
      <NavigationContainer key="locked">
        <Stack.Navigator screenOptions={screenOpts}>
          <Stack.Screen name="Login">
            {props => <LoginScreen {...props} onLogin={handleLogin} isLocked onShowQR={() => { showQRAfterLoginRef.current = true }} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    )
  }

  if (authState === 'loggedIn') {
    const onNavReady = () => {
      const nav = navRef.current
      if (!nav) return
      if (showQRAfterLoginRef.current) {
        showQRAfterLoginRef.current = false
        nav.navigate('QRInvite')
      } else if (pendingChatRef.current) {
        const p = pendingChatRef.current
        pendingChatRef.current = null
        if (p.group) {
          nav.navigate('GroupChat', { groupId: p.groupId })
        } else {
          nav.navigate('Chat', { recipientUsername: p.senderUsername })
        }
      }
    }

    return (
      <NavigationContainer key="loggedIn" ref={navRef} onReady={onNavReady} linking={linking}>
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
          <Stack.Screen name="InviteReview" component={InviteReviewScreen} />
          <Stack.Screen name="QRInvite" component={QRInviteScreen} />
          <Stack.Screen name="QRClaim" component={QRClaimScreen} />
          <Stack.Screen name="BleTest" component={BleTestScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    )
  }

  // loggedOut
  if (!initialRoute) return null

  return (
    <NavigationContainer key="loggedOut">
      <Stack.Navigator screenOptions={screenOpts} initialRouteName={initialRoute}>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Login">
          {props => <LoginScreen {...props} onLogin={handleLogin} onShowQR={() => { showQRAfterLoginRef.current = true }} />}
        </Stack.Screen>
        <Stack.Screen name="Register">
          {props => <RegisterScreen {...props} onLogin={handleLogin} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  )
}
