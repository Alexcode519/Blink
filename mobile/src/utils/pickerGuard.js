let _active = false

export const pickerGuard = {
  start: () => { _active = true },
  end:   () => { setTimeout(() => { _active = false }, 300) },
  isActive: () => _active,
}
