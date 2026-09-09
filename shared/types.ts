/**
 * 'datetime' = paint your own availability across a window (When2Meet style)
 * 'date'     = pick whole days (Doodle days style)
 * 'slots'    = the organizer proposes specific time options; people select the
 *              ones that work (Doodle time-poll style)
 */
export type EventMode = 'datetime' | 'date' | 'slots'

/** a specific proposed time option, used in 'slots' mode */
export interface TimeOption {
  date: string
  startMin: number
  endMin: number
}

export interface LockedWindow {
  date: string
  /** -1 in date mode */
  startMin: number
  endMin: number
}

export interface MeetEvent {
  id: string
  /** readable slug, minted at first share or first paint; null while composing */
  slug: string | null
  title: string
  emoji: string
  mode: EventMode
  tz: string
  /** candidate days as 'YYYY-MM-DD', sorted ascending */
  dates: string[]
  /** minutes from midnight, datetime mode only */
  startMin: number
  endMin: number
  slotMin: number
  /** the proposed time options in 'slots' mode (empty otherwise) */
  options: TimeOption[]
  /** expected group size from the optional stepper; null = unset */
  groupSize: number | null
  /** the locked winning window, or null while still deciding */
  locked: LockedWindow | null
  /** true when the creator attached a photo; it replaces the emoji as the visual */
  hasPhoto?: boolean
  /** bumped on every mutation; drives og.png memoization and cache busting */
  stateVersion: number
  createdAt: number
}

export interface Participant {
  id: string
  name: string
  /** datetime mode: 'YYYY-MM-DDTmmmm-as-minutes' slot keys; date mode: 'YYYY-MM-DD' */
  slots: string[]
  updatedAt: number
}

export interface Viewer {
  pid: string
  name: string
}

export interface EventPayload {
  event: MeetEvent
  participants: Participant[]
  /** this device's participant id, if it has joined */
  me: string | null
  isCreator: boolean
  viewers: Viewer[]
  anon: number
}

export type ServerMsg =
  | { type: 'state'; payload: EventPayload }
  | { type: 'participant'; participant: Participant }
  | { type: 'presence'; viewers: Viewer[]; anon: number }
  | { type: 'event'; event: MeetEvent }
  | { type: 'gone' }

export interface CreateEventInput {
  title?: string
  emoji?: string
  mode: EventMode
  tz: string
  dates: string[]
  startMin?: number
  endMin?: number
  slotMin?: number
  /** required in 'slots' mode: the specific times the organizer proposes */
  options?: TimeOption[]
  groupSize?: number | null
}

export interface PatchEventInput {
  title?: string
  emoji?: string
  mode?: EventMode
  dates?: string[]
  startMin?: number
  endMin?: number
  groupSize?: number | null
}
