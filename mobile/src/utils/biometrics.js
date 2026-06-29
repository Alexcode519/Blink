import ReactNativeBiometrics from 'react-native-biometrics'

const rnb = new ReactNativeBiometrics({ allowDeviceCredentials: false })

export async function isBiometricAvailable() {
  try {
    const { available, biometryType } = await rnb.isSensorAvailable()
    return { available, biometryType }
  } catch {
    return { available: false, biometryType: null }
  }
}

export async function authenticateWithBiometric() {
  try {
    const { success } = await rnb.simplePrompt({ promptMessage: 'Unlock Blink' })
    return success
  } catch {
    return false
  }
}
