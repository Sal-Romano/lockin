const DEVICE_KEY = 'lockin:device'
const NAME_KEY = 'lockin:name'

declare global {
  interface Window {
    __DEVICE__?: string
  }
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    // adopt the identity the server resolved for this browser (cookie-backed,
    // inlined into the event page) instead of forking a fresh one
    id = window.__DEVICE__ || crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function savedName(): string | null {
  return localStorage.getItem(NAME_KEY)
}

export function saveName(name: string) {
  localStorage.setItem(NAME_KEY, name)
}
