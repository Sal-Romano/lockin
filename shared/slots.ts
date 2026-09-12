import type { MeetEvent, Participant, TimeOption } from './types'

export const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** minutes in a day; also the latest a window may START */
export const DAY_MIN = 1440
/**
 * The latest an offered window may END: 6am the following day. Times past
 * DAY_MIN mean "the small hours after this date", which is how people actually
 * talk about a Friday night that runs to 2am. fmtMin already wraps (mod 24) and
 * the ics export already rolls DTEND onto the next day.
 */
export const MAX_END_MIN = DAY_MIN + 360

/** the whole hour just before a window's start, for the axis "+" control */
export const hourBefore = (min: number): number => Math.max(0, (Math.ceil(min / 60) - 1) * 60)
/** the whole hour just after a window's end. Snapping keeps the label short ("2am", not "2:30am") */
export const hourAfter = (min: number): number => (Math.floor(min / 60) + 1) * 60

/** slot key for datetime mode: '2026-09-12T1140' where 1140 = minutes from midnight */
export const slotKey = (date: string, min: number) => `${date}T${pad(min, 4)}`

/** stable key for a proposed option in 'slots' mode */
export const optionKey = (o: TimeOption) => `${o.date}T${pad(o.startMin, 4)}_${pad(o.endMin, 4)}`

export function slotMinsForDay(ev: MeetEvent): number[] {
  const out: number[] = []
  for (let m = ev.startMin; m < ev.endMin; m += ev.slotMin) out.push(m)
  return out
}

export function allSlotKeys(ev: MeetEvent): string[] {
  if (ev.mode === 'slots') return ev.options.map(optionKey)
  if (ev.mode === 'date') return [...ev.dates]
  return ev.dates.flatMap((d) => slotMinsForDay(ev).map((m) => slotKey(d, m)))
}

export function slotCounts(participants: Participant[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of participants) {
    for (const s of p.slots) counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return counts
}

export interface Hotspot {
  date: string
  /** -1 in date mode */
  startMin: number
  endMin: number
  count: number
  names: string[]
}

/**
 * Find the best candidate windows: highest headcount first, then longest,
 * then earliest. Datetime windows prefer to be at least an hour long.
 */
export function hotspots(ev: MeetEvent, participants: Participant[], top = 3): Hotspot[] {
  const active = participants.filter((p) => p.slots.length > 0)
  if (active.length === 0) return []
  const counts = slotCounts(active)

  if (ev.mode === 'slots') {
    return ev.options
      .map((o) => {
        const k = optionKey(o)
        return {
          date: o.date,
          startMin: o.startMin,
          endMin: o.endMin,
          count: counts.get(k) ?? 0,
          names: active.filter((p) => p.slots.includes(k)).map((p) => p.name),
        }
      })
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date) || a.startMin - b.startMin)
      .slice(0, top)
  }

  if (ev.mode === 'date') {
    return [...ev.dates]
      .map((d) => ({
        date: d,
        startMin: -1,
        endMin: -1,
        count: counts.get(d) ?? 0,
        names: active.filter((p) => p.slots.includes(d)).map((p) => p.name),
      }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, top)
  }

  const mins = slotMinsForDay(ev)
  const minSlots = Math.min(Math.max(1, Math.floor(60 / ev.slotMin)), mins.length)
  const cands: Hotspot[] = []
  const maxCount = Math.max(0, ...counts.values())

  for (let level = maxCount; level >= 1; level--) {
    for (const d of ev.dates) {
      let runStart = -1
      for (let i = 0; i <= mins.length; i++) {
        const ok = i < mins.length && (counts.get(slotKey(d, mins[i])) ?? 0) >= level
        if (ok && runStart === -1) runStart = i
        if (!ok && runStart !== -1) {
          const len = i - runStart
          if (len >= minSlots) {
            const keys = mins.slice(runStart, i).map((m) => slotKey(d, m))
            // count and names must agree: both mean "can attend the WHOLE window"
            const names = active.filter((p) => keys.every((k) => p.slots.includes(k))).map((p) => p.name)
            if (names.length >= level) {
              cands.push({
                date: d,
                startMin: mins[runStart],
                endMin: mins[i - 1] + ev.slotMin,
                count: names.length,
                names,
              })
            }
          }
          runStart = -1
        }
      }
    }
    if (cands.length >= top) break
  }

  cands.sort(
    (a, b) =>
      b.count - a.count ||
      b.endMin - b.startMin - (a.endMin - a.startMin) ||
      a.date.localeCompare(b.date) ||
      a.startMin - b.startMin,
  )

  const picked: Hotspot[] = []
  for (const c of cands) {
    // skip windows contained inside an already-picked window on the same day
    if (picked.some((p) => p.date === c.date && p.startMin <= c.startMin && p.endMin >= c.endMin)) continue
    picked.push(c)
    if (picked.length === top) break
  }
  return picked
}

/** '7 to 9pm', '11am to 1pm', '7pm to 12:30am': drop the shared suffix when it matches */
export function fmtRange(startMin: number, endMin: number): string {
  const a = fmtMin(startMin)
  const b = fmtMin(endMin)
  const sameHalf = a.slice(-2) === b.slice(-2) && endMin > startMin && endMin <= 1440
  return sameHalf ? `${a.slice(0, -2)} to ${b}` : `${a} to ${b}`
}

export function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60) % 24
  const m = min % 60
  const ampm = h24 < 12 ? 'am' : 'pm'
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h}${ampm}` : `${h}:${pad(m)}${ampm}`
}

/** parse 'YYYY-MM-DD' as a local date (avoid the UTC-midnight trap) */
export function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(d: string): string {
  const dt = parseDate(d)
  return `${DOW[dt.getDay()]} ${MON[dt.getMonth()]} ${dt.getDate()}`
}

export function fmtDateShort(d: string): string {
  const dt = parseDate(d)
  return `${MON[dt.getMonth()]} ${dt.getDate()}`
}

/** month abbreviation for a date, e.g. 'Sep' */
export const monthOf = (d: string): string => MON[parseDate(d).getMonth()]

/**
 * Per-column month tags: null unless this date opens a new month relative to the
 * one before it. Index 0 is always null because the grid's corner cell carries
 * the establishing month. Keeps "SEP SEP SEP" off a single-month grid while
 * making a Sep -> Oct boundary impossible to miss.
 */
export function monthChangeTags(dates: string[]): (string | null)[] {
  let prev = -1
  return dates.map((d, i) => {
    const m = parseDate(d).getMonth()
    const changed = i > 0 && m !== prev
    prev = m
    return changed ? MON[m] : null
  })
}

export function dateRangeLabel(dates: string[]): string {
  if (dates.length === 0) return ''
  if (dates.length === 1) return fmtDate(dates[0])
  return `${fmtDateShort(dates[0])} to ${fmtDateShort(dates[dates.length - 1])}`
}

/** 'Fri Oct 2 · 7 to 9pm' for a proposed time option */
export function optionLabel(o: TimeOption): string {
  return `${fmtDate(o.date)} · ${fmtRange(o.startMin, o.endMin)}`
}

/**
 * Absolute 0..N heat fill. Gamma 0.85 keeps low counts visible at large N
 * while zero always reads empty. Full consensus (count === denom, 2+) goes gold.
 */
export function heatColor(count: number, denom: number): string | undefined {
  if (count <= 0) return undefined
  if (count >= denom && denom >= 2) return 'var(--gold)'
  const t = Math.pow(Math.min(1, count / Math.max(1, denom)), 0.85)
  return `rgba(234, 88, 12, ${(0.1 + 0.72 * t).toFixed(3)})`
}

// cool-side people colors only: heat owns orange/gold, your own ring owns cyan
const NAME_PALETTE = [
  '#4ade80', '#60a5fa', '#f472b6', '#c084fc',
  '#818cf8', '#fb7185', '#2dd4bf', '#64748b',
]

export function nameColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return NAME_PALETTE[h % NAME_PALETTE.length]
}
