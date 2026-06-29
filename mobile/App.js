import React from 'react'
import AppNavigator from './src/navigation/AppNavigator'
import { FontSizeProvider } from './src/context/FontSizeContext'

export default function App() {
  return (
    <FontSizeProvider>
      <AppNavigator />
    </FontSizeProvider>
  )
}
