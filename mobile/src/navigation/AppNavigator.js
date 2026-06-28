import React, { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
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
  const [authState, setAuthState] = useState(null) // null | 'pattern' | 'loggedIn' | 'loggedOut'

  useEffect(() => {
    async function check() {
      const token = await AsyncStorage.getItem('token')
      if (!token) { setAuthState('loggedOut'); return }
      const patternEnabled = await AsyncStorage.getItem('blink_pattern_enabled')
      const pattern = await AsyncStorage.getItem('blink_pattern')
      if (patternEnabled === 'true' && pattern) {
        setAuthState('pattern')
      } else {
        // Always require login on cold start (e.g. opened from notification)
        setAuthState('locked')
      }
    }
    check()
  }, [])

  if (authState === null) return null

  function handleLogin() { setAuthState('loggedIn'); setupPushNotifications() }
  function handleLogout() { setAuthState('loggedOut') }
  function handlePatternSuccess() { setAuthState('loggedIn'); setupPushNotifications() }
  function handlePatternFallback() { setAuthState('locked') }

  return (
    <NavigationContainer key={authState}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
        {authState === 'pattern' ? (
          <Stack.Screen name="PatternLogin">
            {() => <PatternLoginScreen onSuccess={handlePatternSuccess} onFallback={handlePatternFallback} />}
          </Stack.Screen>
        ) : authState === 'locked' ? (
          <Stack.Screen name="Login">
            {props => <LoginScreen {...props} onLogin={handleLogin} />}
          </Stack.Screen>
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
