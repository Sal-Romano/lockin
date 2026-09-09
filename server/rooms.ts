import { createHash } from 'node:crypto'
import type { ServerMsg, Viewer } from '../shared/types'

// The device UUID is a bearer credential (it gates PUT /me and creator rights),
// so it must NEVER reach other clients. Named-but-not-yet-joined viewers get a
// stable one-way derivative instead.
const anonPid = (device: string) => 'v' + createHash('sha256').update(device).digest('base64url').slice(0, 12)

export interface Client {
  cid: string
  device: string
  pid: string | null
  name: string
  send: (msg: ServerMsg) => void
}

const rooms = new Map<string, Map<string, Client>>()

export function join(eventId: string, client: Client) {
  let room = rooms.get(eventId)
  if (!room) {
    room = new Map()
    rooms.set(eventId, room)
  }
  room.set(client.cid, client)
}

export function leave(eventId: string, cid: string) {
  const room = rooms.get(eventId)
  if (!room) return
  room.delete(cid)
  if (room.size === 0) rooms.delete(eventId)
}

/** named viewers deduped by device, plus a count of anonymous lurkers */
export function presence(eventId: string): { viewers: Viewer[]; anon: number } {
  const seen = new Map<string, Viewer>()
  const anonDevices = new Set<string>()
  for (const c of rooms.get(eventId)?.values() ?? []) {
    if (c.name) seen.set(c.device, { pid: c.pid ?? anonPid(c.device), name: c.name })
    else anonDevices.add(c.device)
  }
  for (const d of seen.keys()) anonDevices.delete(d)
  return { viewers: [...seen.values()], anon: anonDevices.size }
}

export function broadcast(eventId: string, msg: ServerMsg, exceptCid?: string) {
  for (const c of rooms.get(eventId)?.values() ?? []) {
    if (c.cid === exceptCid) continue
    try {
      c.send(msg)
    } catch {
      /* dead connection, will be reaped on abort */
    }
  }
}

export function broadcastPresence(eventId: string) {
  const { viewers, anon } = presence(eventId)
  broadcast(eventId, { type: 'presence', viewers, anon })
}

/** update identity on all live connections for a device (e.g. after first save) */
export function identify(eventId: string, device: string, name: string, pid: string) {
  for (const c of rooms.get(eventId)?.values() ?? []) {
    if (c.device === device) {
      c.name = name
      c.pid = pid
    }
  }
}
