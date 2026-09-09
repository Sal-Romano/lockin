import type {
  CreateEventInput,
  EventPayload,
  LockedWindow,
  MeetEvent,
  Participant,
  PatchEventInput,
} from '../../shared/types'
import { deviceId } from './device'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device': deviceId(),
      ...init?.headers,
    },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  createEvent: (input: CreateEventInput) =>
    req<MeetEvent>('/api/events', { method: 'POST', body: JSON.stringify(input) }),

  patchEvent: (id: string, patch: PatchEventInput) =>
    req<MeetEvent>(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** mint the shareable slug; idempotent */
  mint: (id: string) => req<MeetEvent>(`/api/events/${id}/mint`, { method: 'POST' }),

  lock: (id: string, window: LockedWindow) =>
    req<MeetEvent>(`/api/events/${id}/lock`, { method: 'POST', body: JSON.stringify(window) }),

  unlock: (id: string) => req<MeetEvent>(`/api/events/${id}/lock`, { method: 'DELETE' }),

  deleteEvent: (id: string) => req<{ ok: true }>(`/api/events/${id}`, { method: 'DELETE' }),

  getEvent: (ref: string) => req<EventPayload>(`/api/events/${ref}`),

  saveMe: (id: string, name: string, slots: string[]) =>
    req<Participant>(`/api/events/${id}/me`, { method: 'PUT', body: JSON.stringify({ name, slots }) }),

  /** raw bytes, not json, so this skips req(); server sniffs the real type from magic bytes */
  uploadPhoto: async (id: string, file: File): Promise<MeetEvent> => {
    const res = await fetch(`/api/events/${id}/photo`, {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-device': deviceId(),
      },
      body: file,
    })
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
    return res.json()
  },

  deletePhoto: (id: string) => req<MeetEvent>(`/api/events/${id}/photo`, { method: 'DELETE' }),
}
