import React, { useEffect, useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
import RegisterScreen from '../screens/RegisterScreen'
import LoginScreen from '../screens/LoginScreen'
import FindUserScreen from '../screens/FindUserScreen'
import ChatScreen from '../screens/ChatScreen'
import LibraryScreen from '../screens/LibraryScreen'

const Stack = createNativeStackNavigator()

export default function AppNavigator() {
  const [isLoggedIn, setIsLoggedIn] = useState(null)

  useEffect(() => {
    AsyncStorage.getItem('token').then(t => setIsLoggedIn(!!t))
  }, [])

  if (isLoggedIn === null) return null

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}>
        {isLoggedIn ? (
          <>
            <Stack.Screen name="FindUser" component={FindUserScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Library" component={LibraryScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Register">
              {props => <RegisterScreen {...props} onLogin={() => setIsLoggedIn(true)} />}
            </Stack.Screen>
            <Stack.Screen name="Login">
              {props => <LoginScreen {...props} onLogin={() => setIsLoggedIn(true)} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}
