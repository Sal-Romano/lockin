import satori, { type SatoriOptions } from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MeetEvent, Participant, TimeOption } from '../shared/types'
import {
  dateRangeLabel,
  fmtDate,
  fmtDateShort,
  fmtRange,
  hotspots,
  optionKey,
  slotCounts,
  slotKey,
  slotMinsForDay,
} from '../shared/slots'

// ---------------------------------------------------------------------------
// The OG card is a dark warm poster in every state, regardless of the app's
// light theme: it lives inside message bubbles and dark reads better in both
// iMessage themes. Canvas 1200x630, downscaled ~4x in the bubble, so nothing
// informational renders under 44px. Load-bearing content stays inside the
// central 1000px (iOS 17 can crop squarish).
// ---------------------------------------------------------------------------

const C = {
  bg: '#0E0B16',
  text: '#F2EFFA',
  soft: '#9B93B3',
  line: '#2A2440',
  ember: '#F08A1D',
  emberDeep: '#E25822',
  gold: '#F6C445',
  goldHot: '#FFE9A8',
  heat0: '#221B38',
  heatLow: '#6E1E79',
  heatMid: '#D9533B',
  onEmber: '#1C0D04',
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fontDir = join(root, 'node_modules', '@fontsource', 'inter', 'files')

function loadFont(file: string): Buffer | null {
  const p = join(fontDir, file)
  return existsSync(p) ? readFileSync(p) : null
}

const inter400 = loadFont('inter-latin-400-normal.woff')
const inter600 = loadFont('inter-latin-600-normal.woff')
const inter800 = loadFont('inter-latin-800-normal.woff')

// satori element helper (no JSX on the server)
type El = { type: string; props: Record<string, unknown> }
const h = (type: string, props: Record<string, unknown> = {}, ...children: (El | string | null)[]): El => {
  const kids = children.filter((c): c is El | string => c !== null)
  return { type, props: { ...props, children: kids.length <= 1 ? kids[0] : kids } }
}

// --- twemoji assets so emoji render in the card ----------------------------
// SVG first (crisp at hero sizes), 72px PNG as fallback, transparent pixel last.
const BLANK_PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets'
const emojiCache = new Map<string, string>()

async function loadEmoji(segment: string): Promise<string> {
  const cached = emojiCache.get(segment)
  if (cached) return cached
  const codes = [...segment].map((c) => c.codePointAt(0)!.toString(16))
  const keys = [codes.filter((c) => c !== 'fe0f').join('-'), codes.join('-')]
  for (const key of keys) {
    for (const [path, mime] of [
      [`svg/${key}.svg`, 'image/svg+xml'],
      [`72x72/${key}.png`, 'image/png'],
    ] as const) {
      try {
        // bounded so a slow CDN degrades to the blank pixel inside the unfurl window
        const res = await fetch(`${TWEMOJI}/${path}`, { signal: AbortSignal.timeout(1500) })
        if (res.ok) {
          const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
          const uri = `data:${mime};base64,${b64}`
          emojiCache.set(segment, uri)
          return uri
        }
      } catch {
        /* try the next candidate */
      }
    }
  }
  emojiCache.set(segment, BLANK_PX)
  return BLANK_PX
}

// --- creator photo ---------------------------------------------------------
// replaces the emoji as the event's visual when present. Embedded as a data
// uri; cached per event keyed by stateVersion so a new upload busts it.
const photoCache = new Map<string, { key: string; uri: string }>()

function photoUriFor(ev: MeetEvent): string | null {
  if (!ev.hasPhoto) return null
  const key = `${ev.id}:${ev.stateVersion}`
  const hit = photoCache.get(ev.id)
  if (hit && hit.key === key) return hit.uri
  try {
    const buf = readFileSync(join(root, 'data', 'uploads', `${ev.id}.jpg`))
    const uri = `data:image/jpeg;base64,${buf.toString('base64')}`
    photoCache.set(ev.id, { key, uri })
    if (photoCache.size > 100) {
      const oldest = photoCache.keys().next().value
      if (oldest !== undefined) photoCache.delete(oldest)
    }
    return uri
  } catch {
    return null
  }
}

/** rounded photo tile; size is the square edge */
function photoTile(uri: string, size: number, radius = 24): El {
  return h('img', {
    src: uri,
    width: size,
    height: size,
    style: {
      borderRadius: radius,
      objectFit: 'cover',
      border: '2px solid rgba(242,239,250,0.18)',
      boxShadow: '0 14px 44px rgba(0,0,0,0.5)',
    },
  })
}

// --- the flame mark --------------------------------------------------------
// Fill level reflects the response ratio; full flame goes gold (locked or
// full house). Built as an inline SVG data uri so satori embeds it as an img.
function flameUri(ratio: number): string {
  const r = Math.max(0.08, Math.min(1, ratio))
  const full = r >= 0.999
  const cut = (1 - r).toFixed(3)
  const stops = full
    ? `<stop offset="0" stop-color="${C.goldHot}"/><stop offset="1" stop-color="${C.gold}"/>`
    : `<stop offset="0" stop-color="#241D3A"/><stop offset="${cut}" stop-color="#241D3A"/>` +
      `<stop offset="${cut}" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.emberDeep}"/>`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 30">` +
    `<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
    `<path fill="url(#f)" stroke="rgba(242,239,250,0.30)" stroke-width="1" d="M12.6 1.4` +
    ` c.3 2.9 1.9 4.8 3.6 6.8 c2.2 2.6 4.1 5.2 4.1 8.8 c0 5.3-3.7 9.1-8.3 9.1` +
    ` c-4.6 0-8.3-3.8-8.3-9.1 c0-2.6 1-5 2.6-7 c.5 1.3 1.4 2.3 2.6 2.9 c-.5-4 1.2-8.2 3.7-11.5 z"/>` +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function flameRatio(ev: MeetEvent, responded: number): number {
  if (ev.locked) return 1
  if (ev.groupSize && ev.groupSize > 0) return Math.min(1, responded / ev.groupSize)
  if (responded === 0) return 0.12
  return Math.min(0.85, 0.3 + responded * 0.09)
}

const checkUri = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${C.ember}"/>` +
    `<path d="M7 12.6l3.3 3.2L17 9" stroke="${C.bg}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
})()

// --- shared bits -----------------------------------------------------------
function fitTitle(raw: string, maxChars: number): { text: string; size: number } {
  const base = raw.trim() || 'untitled hang'
  const text = base.length > maxChars ? `${base.slice(0, maxChars - 1).trimEnd()}…` : base
  const size = text.length <= 18 ? 104 : text.length <= 32 ? 84 : 64
  return { text, size }
}

function subLine(ev: MeetEvent): string {
  if (ev.mode === 'date') return `picking a day, ${dateRangeLabel(ev.dates)}`
  if (ev.mode === 'slots') {
    const od = [...new Set(ev.options.map((o) => o.date))].sort()
    const n = ev.options.length
    return `${n} time ${n === 1 ? 'option' : 'options'} · ${dateRangeLabel(od)}`
  }
  return `${dateRangeLabel(ev.dates)} · ${fmtRange(ev.startMin, ev.endMin)}`
}

function tzShort(tz: string, date: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}

function titleRow(ev: MeetEvent, size: number, text: string, emojiSize: number, photo?: { uri: string; size: number } | null): El {
  const visual = photo
    ? photoTile(photo.uri, photo.size)
    : ev.emoji
      ? h('div', { style: { display: 'flex', fontSize: emojiSize, lineHeight: 1 } }, ev.emoji)
      : null
  return h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: 28 } },
    visual,
    h(
      'div',
      { style: { display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.08, color: C.text } },
      text,
    ),
  )
}

function markEl(ratio: number): El {
  return h(
    'div',
    { style: { position: 'absolute', right: 100, bottom: 44, display: 'flex', alignItems: 'center', gap: 16 } },
    h('img', { src: flameUri(ratio), width: 37, height: 46 }),
    h('div', { style: { display: 'flex', fontSize: 44, color: 'rgba(242,239,250,0.52)' } }, 'lockin'),
  )
}

function frame(ratio: number, content: El, bottomPad = 116): El {
  return h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: 'Inter',
      },
    },
    h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1200,
        height: 630,
        backgroundImage:
          'radial-gradient(circle at 84% 100%, rgba(226,88,34,0.24) 0%, rgba(226,88,34,0.08) 36%, rgba(226,88,34,0) 64%)',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1200,
        height: 630,
        backgroundImage: 'radial-gradient(circle at 6% 0%, rgba(110,30,121,0.22) 0%, rgba(110,30,121,0) 52%)',
      },
    }),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, padding: `52px 100px ${bottomPad}px` } },
      content,
    ),
    markEl(ratio),
  )
}

// a proposed-time chip for the fresh slots card: date label over the time it
// covers, echoing the dashed gradient day-chip so the two modes feel related.
// height is fixed and overflow clipped so a long range can never grow the card
function optionChip(o: TimeOption, w: number): El {
  return h(
    'div',
    {
      style: {
        width: w,
        height: 152,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 18px',
        overflow: 'hidden',
        borderRadius: 26,
        border: '2px dashed rgba(155,147,179,0.45)',
        backgroundImage: 'linear-gradient(165deg, rgba(110,30,121,0.38) 0%, rgba(226,88,34,0.16) 100%)',
      },
    },
    h(
      'div',
      { style: { display: 'flex', fontSize: 44, fontWeight: 600, color: C.soft, lineHeight: 1 } },
      fmtDate(o.date),
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontSize: 46,
          fontWeight: 800,
          color: C.text,
          lineHeight: 1.04,
          textAlign: 'center',
        },
      },
      fmtRange(o.startMin, o.endMin),
    ),
  )
}

/**
 * the row of proposed-time chips on the fresh slots card. capped at three so
 * each chip is wide enough to keep the date and time each on their own line;
 * the total count already rides in the subline, so no "+N" chip is needed.
 */
function slotFreshChips(ev: MeetEvent): El {
  const shown = ev.options.slice(0, 3)
  const n = shown.length
  const w = n === 1 ? 460 : n === 2 ? 360 : 318
  return h('div', { style: { display: 'flex', gap: 20 } }, ...shown.map((o) => optionChip(o, w)))
}

// --- state A: zero responses (invitation energy) ---------------------------
function stateFresh(ev: MeetEvent, photo: string | null): El {
  const fitted = fitTitle(ev.title, 44)
  const text = fitted.text
  // the photo tile eats horizontal room, so the title steps down a size to
  // stay on one line and keep the stack inside the frame
  const size = Math.min(fitted.size, photo ? 80 : 96)
  const showMax = ev.dates.length > 5 ? 4 : 5
  const days = ev.dates.slice(0, showMax)
  const extra = ev.dates.length - days.length

  const chip = (d: string) => {
    const [dow, , num] = fmtDate(d).split(' ')
    return h(
      'div',
      {
        style: {
          width: 172,
          height: 152,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 26,
          border: '2px dashed rgba(155,147,179,0.45)',
          backgroundImage: 'linear-gradient(165deg, rgba(110,30,121,0.38) 0%, rgba(226,88,34,0.16) 100%)',
        },
      },
      h('div', { style: { display: 'flex', fontSize: 46, fontWeight: 600, color: C.soft, lineHeight: 1 } }, dow),
      h(
        'div',
        { style: { display: 'flex', fontSize: 78, fontWeight: 800, color: C.text, lineHeight: 1.15 } },
        num,
      ),
    )
  }

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' } },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 18 } },
      titleRow(ev, size, text, Math.min(size + 14, 112), photo ? { uri: photo, size: 132 } : null),
      h('div', { style: { display: 'flex', fontSize: 46, color: C.soft } }, subLine(ev)),
    ),
    ev.mode === 'slots'
      ? slotFreshChips(ev)
      : h(
          'div',
          { style: { display: 'flex', gap: 20 } },
          ...days.map(chip),
          extra > 0
            ? h(
                'div',
                {
                  style: {
                    width: 172,
                    height: 152,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 26,
                    border: '2px dashed rgba(155,147,179,0.32)',
                    fontSize: 60,
                    fontWeight: 600,
                    color: C.soft,
                  },
                },
                `+${extra}`,
              )
            : null,
        ),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignSelf: 'flex-start',
            fontSize: 46,
            fontWeight: 600,
            color: C.onEmber,
            backgroundImage: `linear-gradient(100deg, ${C.ember} 0%, ${C.emberDeep} 100%)`,
            padding: '20px 44px',
            borderRadius: 999,
            boxShadow: '0 10px 44px rgba(226,88,34,0.38)',
            whiteSpace: 'nowrap',
          },
        },
        ev.mode === 'slots' ? 'pick the times that work' : 'paint the times you can make',
      ),
      h(
        'div',
        { style: { display: 'flex', fontSize: 44, color: C.soft, whiteSpace: 'nowrap' } },
        '20 seconds, no signup',
      ),
    ),
  )
}

// --- state B: in progress (mini heatmap + count) ---------------------------
interface Band {
  lo: number
  hi: number
}

/** morning / afternoon / evening cuts of the event window; only non-empty bands */
function dayBands(ev: MeetEvent): Band[] {
  const cuts: Band[] = [
    { lo: ev.startMin, hi: Math.min(ev.endMin, 720) },
    { lo: Math.max(ev.startMin, 720), hi: Math.min(ev.endMin, 1020) },
    { lo: Math.max(ev.startMin, 1020), hi: ev.endMin },
  ]
  return cuts.filter((b) => b.hi - b.lo >= ev.slotMin)
}

function heatStyle(count: number, responded: number, w: number, hgt: number): Record<string, unknown> {
  const base: Record<string, unknown> = { width: w, height: hgt, borderRadius: 10, display: 'flex' }
  if (count <= 0) return { ...base, backgroundColor: C.heat0 }
  if (count >= responded && responded >= 2)
    return { ...base, backgroundColor: C.goldHot, boxShadow: '0 0 20px 6px rgba(255,233,168,0.45)' }
  const t = count / Math.max(1, responded)
  return { ...base, backgroundColor: t <= 0.34 ? C.heatLow : t <= 0.67 ? C.heatMid : C.gold }
}

// slots in-progress: a ranked leaderboard of the proposed times. each row is a
// horizontal heat bar filled proportional to headcount (same ember->gold scale
// as the heatmap); the fill stays translucent so the light label reads over it.
function slotRanked(ev: MeetEvent, participants: Participant[], responded: number): El {
  const ranked = hotspots(ev, participants, 4)
  const rowW = 560
  const rowH = 76

  const row = (o: { date: string; startMin: number; endMin: number; count: number }): El => {
    const frac = Math.min(1, o.count / Math.max(1, responded))
    const full = o.count >= responded && responded >= 2
    const fill = full ? 'rgba(246,196,69,0.30)' : `rgba(226,88,34,${(0.16 + 0.56 * frac).toFixed(3)})`
    const fillW = Math.max(rowH, Math.round(frac * rowW))
    return h(
      'div',
      {
        style: {
          position: 'relative',
          display: 'flex',
          width: rowW,
          height: rowH,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: C.heat0,
        },
      },
      h('div', {
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: fillW,
          height: rowH,
          backgroundColor: fill,
          ...(full ? { boxShadow: '0 0 20px 6px rgba(255,233,168,0.4)' } : {}),
        },
      }),
      h(
        'div',
        {
          style: {
            display: 'flex',
            width: rowW,
            height: rowH,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', fontSize: 44, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' } },
          `${fmtDateShort(o.date)} · ${fmtRange(o.startMin, o.endMin)}`,
        ),
        h('div', { style: { display: 'flex', fontSize: 50, fontWeight: 800, color: C.text } }, String(o.count)),
      ),
    )
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }, ...ranked.map(row))
}

function stateProgress(ev: MeetEvent, participants: Participant[], responded: number, photo: string | null): El {
  const { text } = fitTitle(ev.title, 28)
  const titleSize = text.length <= 18 ? 72 : 56

  // slots polls read as a leaderboard of proposed times; the other modes get
  // the mini heatmap. the heatmap math is kept inside a nested fn so its slot
  // scan never runs for a slots event (whose slotMin can legitimately be 0)
  function buildHeatmap(): El {
    const counts = slotCounts(participants.filter((p) => p.slots.length > 0))
    const days = ev.dates.slice(0, 6)
    const extra = ev.dates.length - days.length
    const bands = ev.mode === 'date' ? [] : dayBands(ev)
    const rows = ev.mode === 'date' ? 1 : Math.max(1, bands.length)
    const cols = days.length + (extra > 0 ? 1 : 0)
    const cellW = cols <= 4 ? 100 : 80
    const cellH = rows === 1 ? 132 : rows === 2 ? 86 : 56
    const mins = ev.mode === 'date' ? [] : slotMinsForDay(ev)

    const pooled = (d: string, b: Band) =>
      Math.max(0, ...mins.filter((m) => m >= b.lo && m < b.hi).map((m) => counts.get(slotKey(d, m)) ?? 0))

    const colCells = (d: string): El[] =>
      ev.mode === 'date'
        ? [h('div', { style: heatStyle(counts.get(d) ?? 0, responded, cellW, cellH) })]
        : bands.map((b) => h('div', { style: heatStyle(pooled(d, b), responded, cellW, cellH) }))

    return h(
      'div',
      { style: { display: 'flex', gap: 10 } },
      ...days.map((d) =>
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' } },
          h(
            'div',
            { style: { display: 'flex', fontSize: 38, fontWeight: 600, color: 'rgba(155,147,179,0.55)' } },
            fmtDate(d).slice(0, 1),
          ),
          ...colCells(d),
        ),
      ),
      extra > 0
        ? h(
            'div',
            {
              style: {
                display: 'flex',
                width: cellW,
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 44,
                color: 'rgba(155,147,179,0.4)',
                paddingTop: 48,
              },
            },
            `+${extra}`,
          )
        : null,
    )
  }

  const leftEl = ev.mode === 'slots' ? slotRanked(ev, participants, responded) : buildHeatmap()

  const best = hotspots(ev, participants, 1)[0]
  const bestLabel = best
    ? ev.mode === 'date'
      ? fmtDate(best.date)
      : `${fmtDate(best.date)}, ${fmtRange(best.startMin, best.endMin)}`
    : null

  const countLockup = h(
    'div',
    { style: { display: 'flex', alignItems: 'flex-end', gap: 20 } },
    h(
      'div',
      { style: { display: 'flex', fontSize: 148, fontWeight: 800, lineHeight: 1, color: C.text } },
      String(responded),
    ),
    h(
      'div',
      { style: { display: 'flex', fontSize: 52, color: C.soft, paddingBottom: 12 } },
      ev.groupSize ? `of ${ev.groupSize} in` : 'in so far',
    ),
  )

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: 1 } },
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
      titleRow(ev, titleSize, text, 76, photo ? { uri: photo, size: 124 } : null),
      h('div', { style: { display: 'flex', fontSize: 44, color: C.soft } }, subLine(ev)),
    ),
    h(
      'div',
      { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 56 } },
      leftEl,
      h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 22 } },
        countLockup,
        bestLabel
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              h('div', { style: { display: 'flex', fontSize: 44, color: C.soft } }, 'best so far'),
              h(
                'div',
                { style: { display: 'flex', fontSize: 46, fontWeight: 600, color: C.ember } },
                bestLabel,
              ),
            )
          : null,
      ),
    ),
  )
}

// --- state C: locked (the trophy card) -------------------------------------
function stateLocked(ev: MeetEvent, participants: Participant[], responded: number, photo: string | null): El {
  const lw = ev.locked!
  const { text } = fitTitle(ev.title, 34)
  const active = participants.filter((p) => p.slots.length > 0)

  let canMake: number
  if (ev.mode === 'date') {
    canMake = active.filter((p) => p.slots.includes(lw.date)).length
  } else if (ev.mode === 'slots') {
    // a slots pick locks a whole proposed option; attendance is who chose its key
    const k = optionKey(lw)
    canMake = active.filter((p) => p.slots.includes(k)).length
  } else {
    const keys: string[] = []
    for (let m = lw.startMin; m < lw.endMin; m += ev.slotMin) keys.push(slotKey(lw.date, m))
    canMake = active.filter((p) => keys.every((k) => p.slots.includes(k))).length
  }
  const denom = ev.groupSize ?? responded
  const attendance =
    canMake >= 2 && canMake >= denom
      ? `works for all ${canMake}`
      : canMake > 0
        ? `${canMake} of ${denom} can make it`
        : null

  // datetime and slots both lock a real clock window, so both show the time + tz
  const zone = ev.mode !== 'date' ? tzShort(ev.tz, new Date(`${lw.date}T12:00:00`)) : null

  // with a photo the details column sits beside a large tile, so the date
  // steps down a size to keep the pair inside the central safe zone
  const onRow = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: 18 } },
    h('img', { src: checkUri, width: 52, height: 52 }),
    h(
      'div',
      { style: { display: 'flex', fontSize: 46, fontWeight: 600, color: C.ember, letterSpacing: 2 } },
      "we're on",
    ),
  )
  const dateEl = h(
    'div',
    {
      style: {
        display: 'flex',
        fontSize: photo ? 108 : 132,
        fontWeight: 800,
        lineHeight: 1.02,
        color: C.text,
        textShadow: '0 6px 70px rgba(255,233,168,0.35)',
      },
    },
    fmtDate(lw.date),
  )
  const timeRow =
    ev.mode !== 'date'
      ? h(
          'div',
          { style: { display: 'flex', alignItems: 'flex-end', gap: 18 } },
          h(
            'div',
            { style: { display: 'flex', fontSize: 66, fontWeight: 600, color: C.gold, lineHeight: 1 } },
            fmtRange(lw.startMin, lw.endMin),
          ),
          zone
            ? h('div', { style: { display: 'flex', fontSize: 44, color: C.soft, paddingBottom: 4 } }, zone)
            : null,
        )
      : null
  const attendanceEl = attendance
    ? h('div', { style: { display: 'flex', fontSize: 48, color: C.soft, marginTop: 8 } }, attendance)
    : null

  const center = photo
    ? h(
        'div',
        { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 52 } },
        photoTile(photo, 236, 24),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 18 } },
          onRow,
          dateEl,
          timeRow,
          attendanceEl,
        ),
      )
    : h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
          },
        },
        onRow,
        dateEl,
        timeRow,
        attendanceEl,
      )

  // the photo carries the visual identity in the center, so the top line is text only
  const top = photo
    ? h(
        'div',
        { style: { display: 'flex', fontSize: 52, fontWeight: 800, lineHeight: 1.08, color: C.text } },
        text,
      )
    : titleRow(ev, 52, text, 56)

  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center' } },
    top,
    center,
  )
}

// --- render ----------------------------------------------------------------
export async function renderOg(ev: MeetEvent, participants: Participant[]): Promise<Buffer | null> {
  if (!inter400 || !inter600) return null

  const responded = participants.filter((p) => p.slots.length > 0).length
  const photo = photoUriFor(ev)
  const content = ev.locked
    ? stateLocked(ev, participants, responded, photo)
    : responded === 0
      ? stateFresh(ev, photo)
      : stateProgress(ev, participants, responded, photo)

  const fonts: SatoriOptions['fonts'] = [
    { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
    { name: 'Inter', data: inter600, weight: 600, style: 'normal' },
  ]
  if (inter800) fonts.push({ name: 'Inter', data: inter800, weight: 800, style: 'normal' })

  const bottomPad = !ev.locked && responded === 0 ? 56 : 116
  const svg = await satori(frame(flameRatio(ev, responded), content, bottomPad) as never, {
    width: 1200,
    height: 630,
    fonts,
    loadAdditionalAsset: async (code, segment) => (code === 'emoji' ? loadEmoji(segment) : segment),
  })

  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng() as Buffer
}

// memoized per event by stateVersion; short TTL so a burst of preview
// fetches renders once while memory never holds stale bytes for long
const ogCache = new Map<string, { version: number; at: number; png: Buffer }>()

export async function renderOgCached(ev: MeetEvent, participants: Participant[]): Promise<Buffer | null> {
  const hit = ogCache.get(ev.id)
  if (hit && hit.version === ev.stateVersion && Date.now() - hit.at < 60_000) return hit.png
  const png = await renderOg(ev, participants)
  if (png) {
    ogCache.set(ev.id, { version: ev.stateVersion, at: Date.now(), png })
    if (ogCache.size > 300) {
      const oldest = ogCache.keys().next().value
      if (oldest !== undefined) ogCache.delete(oldest)
    }
  }
  return png
}
