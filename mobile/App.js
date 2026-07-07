import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import AppNavigator from './src/navigation/AppNavigator'
import { FontSizeProvider } from './src/context/FontSizeContext'

export default function App() {
  return (
    <SafeAreaProvider>
      <FontSizeProvider>
        <AppNavigator />
      </FontSizeProvider>
    </SafeAreaProvider>
  )
}
