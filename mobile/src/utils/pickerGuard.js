import { BackHandler } from 'react-native'

let _active = false
let _backSub = null

export const pickerGuard = {
  start: () => {
    _active = true
    // Swallow the Android back press while picker is open so RN navigation isn't popped
    _backSub = BackHandler.addEventListener('hardwareBackPress', () => true)
  },
  end: () => {
    if (_backSub) { _backSub.remove(); _backSub = null }
    setTimeout(() => { _active = false }, 300)
  },
  isActive: () => _active,
}
