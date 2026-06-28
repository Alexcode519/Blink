import React, { useEffect, useState, useRef } from 'react'
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

export default function AppNavigator() {
  const [authState, setAuthState] = useState(null)
  const navRef = useRef(null)
  // Username to deep-link into after auth completes
  const pendingChatRef = useRef(null)

  useEffect(() => {
    async function check() {
      // Check if app was opened from a notification tap
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

  if (authState === null) return null

  function openPendingChat() {
    const sender = pendingChatRef.current
    pendingChatRef.current = null
    if (sender && navRef.current) {
      // Small delay so the navigator has mounted
      setTimeout(() => {
        navRef.current.navigate('Chat', { recipientUsername: sender })
      }, 300)
    }
  }

  function handleLogin() {
    setAuthState('loggedIn')
    setupPushNotifications()
    openPendingChat()
  }
  function handleLogout() { setAuthState('loggedOut') }
  function handlePatternSuccess() {
    setAuthState('loggedIn')
    setupPushNotifications()
    openPendingChat()
  }
  function handlePatternFallback() { setAuthState('locked') }

  return (
    <NavigationContainer ref={navRef} key={authState}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
        {authState === 'pattern' ? (
          <Stack.Screen name="PatternLogin">
            {() => <PatternLoginScreen onSuccess={handlePatternSuccess} onFallback={handlePatternFallback} />}
          </Stack.Screen>
        ) : authState === 'locked' ? (
          <>
            <Stack.Screen name="Login">
              {props => <LoginScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {props => <RegisterScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
          </>
        ) : authState === 'loggedIn' ? (
          <>
            <Stack.Screen name="Chats" component={ChatsScreen} />
            <Stack.Screen name="FindUser" component={FindUserScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen name="Profile">
              {props => <ProfileScreen {...props} onLogout={handleLogout} />}
            </Stack.Screen>
            <Stack.Screen name="SetPattern" component={SetPatternScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login">
              {props => <LoginScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {props => <RegisterScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
