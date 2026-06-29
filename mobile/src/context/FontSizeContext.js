import React, { createContext, useContext, useState, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'blink_font_size'

export const FONT_SIZES = [
  { key: 'small',  label: 'Small',       size: 13 },
  { key: 'medium', label: 'Medium',      size: 15 },
  { key: 'large',  label: 'Large',       size: 18 },
  { key: 'xlarge', label: 'Extra Large', size: 22 },
]

const FontSizeContext = createContext({ fontSize: 15, setFontSizeKey: () => {} })

export function FontSizeProvider({ children }) {
  const [fontSize, setFontSize] = useState(15)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(key => {
      const match = FONT_SIZES.find(f => f.key === key)
      if (match) setFontSize(match.size)
    })
  }, [])

  function setFontSizeKey(key) {
    const match = FONT_SIZES.find(f => f.key === key)
    if (!match) return
    setFontSize(match.size)
    AsyncStorage.setItem(STORAGE_KEY, key)
  }

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSizeKey }}>
      {children}
    </FontSizeContext.Provider>
  )
}

export function useFontSize() {
  return useContext(FontSizeContext)
}
