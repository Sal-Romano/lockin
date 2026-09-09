import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { customAlphabet } from 'nanoid'
import type { CreateEventInput, LockedWindow, MeetEvent, Participant } from '../shared/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'data'), { recursive: true })

const db = new Database(join(root, 'data', 'meetup.db'))
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'datetime',
  tz TEXT NOT NULL,
  dates TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  slot_min INTEGER NOT NULL DEFAULT 30,
  options TEXT NOT NULL DEFAULT '[]',
  group_size INTEGER,
  locked TEXT,
  state_version INTEGER NOT NULL DEFAULT 0,
  creator_device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  device TEXT NOT NULL,
  name TEXT NOT NULL,
  slots TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(event_id, device)
);
CREATE INDEX IF NOT EXISTS idx_participants_event ON participants(event_id);
`)

// sqlite has no IF NOT EXISTS for columns, so guard the add for existing DBs
try {
  db.exec("ALTER TABLE events ADD COLUMN options TEXT NOT NULL DEFAULT '[]'")
} catch {}

// no-lookalike base32: no 0/O/1/l
const shortId = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 8)
const slugSuffix = customAlphabet('abcdefghjkmnpqrstuvwxyz23456789', 4)
const pid = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', 12)

interface EventRow {
  id: string
  slug: string | null
  title: string
  emoji: string
  mode: string
  tz: string
  dates: string
  start_min: number
  end_min: number
  slot_min: number
  options: string
  group_size: number | null
  locked: string | null
  state_version: number
  creator_device: string
  created_at: number
  updated_at: number
}

interface ParticipantRow {
  id: string
  event_id: string
  device: string
  name: string
  slots: string
  created_at: number
  updated_at: number
}

function toEvent(r: EventRow): MeetEvent & { creatorDevice: string } {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    emoji: r.emoji,
    mode: r.mode as MeetEvent['mode'],
    tz: r.tz,
    dates: JSON.parse(r.dates),
    startMin: r.start_min,
    endMin: r.end_min,
    slotMin: r.slot_min,
    options: JSON.parse(r.options || '[]'),
    groupSize: r.group_size,
    locked: r.locked ? (JSON.parse(r.locked) as LockedWindow) : null,
    stateVersion: r.state_version,
    createdAt: r.created_at,
    creatorDevice: r.creator_device,
  }
}

function toParticipant(r: ParticipantRow): Participant & { device: string } {
  return {
    id: r.id,
    device: r.device,
    name: r.name,
    slots: JSON.parse(r.slots),
    updatedAt: r.updated_at,
  }
}

/** bump the version + freshness clock; every mutation funnels through this */
function touch(eventId: string) {
  db.prepare('UPDATE events SET state_version = state_version + 1, updated_at = ? WHERE id = ?').run(
    Date.now(),
    eventId,
  )
}

/** public touch for mutations that live outside this module (e.g. photo upload) */
export function touchEvent(eventId: string): void {
  touch(eventId)
}

export function createEvent(input: Required<CreateEventInput>, creatorDevice: string): MeetEvent & { creatorDevice: string } {
  const id = shortId()
  const now = Date.now()
  db.prepare(
    `INSERT INTO events (id, title, emoji, mode, tz, dates, start_min, end_min, slot_min, options, group_size, creator_device, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.emoji,
    input.mode,
    input.tz,
    JSON.stringify(input.dates),
    input.startMin,
    input.endMin,
    input.slotMin,
    JSON.stringify(input.options),
    input.groupSize,
    creatorDevice,
    now,
    now,
  )
  return getEvent(id)!
}

/** resolve by slug first, then internal id, so old links keep working */
export function getEvent(ref: string): (MeetEvent & { creatorDevice: string }) | null {
  const row = (db.prepare('SELECT * FROM events WHERE slug = ?').get(ref) ??
    db.prepare('SELECT * FROM events WHERE id = ?').get(ref)) as EventRow | undefined
  return row ? toEvent(row) : null
}

export function patchEvent(
  id: string,
  fields: Partial<{
    title: string
    emoji: string
    mode: string
    dates: string[]
    startMin: number
    endMin: number
    groupSize: number | null
  }>,
): void {
  const sets: string[] = []
  const vals: unknown[] = []
  const map: Record<string, string> = {
    title: 'title',
    emoji: 'emoji',
    mode: 'mode',
    startMin: 'start_min',
    endMin: 'end_min',
    groupSize: 'group_size',
  }
  for (const [k, col] of Object.entries(map)) {
    if (k in fields) {
      sets.push(`${col} = ?`)
      vals.push((fields as Record<string, unknown>)[k])
    }
  }
  if (fields.dates) {
    sets.push('dates = ?')
    vals.push(JSON.stringify(fields.dates))
  }
  if (sets.length === 0) return
  db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  touch(id)
}

/** mint the readable slug from the title; idempotent */
export function mintSlug(id: string): string {
  const ev = getEvent(id)!
  if (ev.slug) return ev.slug
  const words =
    ev.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '-')
      .slice(0, 24)
      .replace(/-+$/, '') || 'hang'
  let slug = `${words}-${slugSuffix()}`
  while (db.prepare('SELECT 1 FROM events WHERE slug = ?').get(slug)) slug = `${words}-${slugSuffix()}`
  db.prepare('UPDATE events SET slug = ? WHERE id = ?').run(slug, id)
  touch(id)
  return slug
}

export function setLocked(id: string, locked: LockedWindow | null): void {
  db.prepare('UPDATE events SET locked = ? WHERE id = ?').run(locked ? JSON.stringify(locked) : null, id)
  touch(id)
}

export function deleteEvent(id: string): void {
  db.prepare('DELETE FROM participants WHERE event_id = ?').run(id)
  db.prepare('DELETE FROM events WHERE id = ?').run(id)
  // photo goes with the event
  rmSync(join(root, 'data', 'uploads', `${id}.jpg`), { force: true })
}

export function getParticipants(eventId: string): (Participant & { device: string })[] {
  const rows = db
    .prepare('SELECT * FROM participants WHERE event_id = ? ORDER BY created_at')
    .all(eventId) as ParticipantRow[]
  return rows.map(toParticipant)
}

export function findParticipant(eventId: string, device: string): (Participant & { device: string }) | null {
  const row = db
    .prepare('SELECT * FROM participants WHERE event_id = ? AND device = ?')
    .get(eventId, device) as ParticipantRow | undefined
  return row ? toParticipant(row) : null
}

export function upsertParticipant(
  eventId: string,
  device: string,
  name: string,
  slots: string[],
): Participant {
  const now = Date.now()
  const existing = findParticipant(eventId, device)
  let result: Participant
  if (existing) {
    db.prepare('UPDATE participants SET name = ?, slots = ?, updated_at = ? WHERE id = ?').run(
      name,
      JSON.stringify(slots),
      now,
      existing.id,
    )
    result = { id: existing.id, name, slots, updatedAt: now }
  } else {
    const id = pid()
    db.prepare(
      `INSERT INTO participants (id, event_id, device, name, slots, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, eventId, device, name, JSON.stringify(slots), now, now)
    result = { id, name, slots, updatedAt: now }
  }
  touch(eventId)
  return result
}

const PURGE_AFTER_MS = 90 * 24 * 60 * 60 * 1000

export function purgeStale(): number {
  const cutoff = Date.now() - PURGE_AFTER_MS
  const stale = db.prepare('SELECT id FROM events WHERE updated_at < ?').all(cutoff) as { id: string }[]
  for (const { id } of stale) deleteEvent(id)
  return stale.length
}
