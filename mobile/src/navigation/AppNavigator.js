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
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }

export default function AppNavigator() {
  const [authState, setAuthState] = useState(null)
  const pendingChatRef = useRef(null)

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

  if (authState === null) return null

  function handleLogin() { setAuthState('loggedIn'); setupPushNotifications() }
  function handleLogout() { pendingChatRef.current = null; setAuthState('loggedOut') }
  function handlePatternSuccess() { setAuthState('loggedIn'); setupPushNotifications() }
  function handlePatternFallback() { setAuthState('locked') }

  // Build initial state so the chat opens immediately after auth, with Chats behind it
  const pendingSender = pendingChatRef.current
  const loggedInInitialState = pendingSender ? {
    index: 1,
    routes: [
      { name: 'Chats' },
      { name: 'Chat', params: { recipientUsername: pendingSender } },
    ],
  } : undefined

  if (authState === 'pattern') {
    return (
      <NavigationContainer key="pattern">
        <Stack.Navigator screenOptions={screenOpts}>
          <Stack.Screen name="PatternLogin">
            {() => <PatternLoginScreen onSuccess={handlePatternSuccess} onFallback={handlePatternFallback} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    )
  }

  if (authState === 'locked') {
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
            {props => <ProfileScreen {...props} onLogout={handleLogout} />}
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
