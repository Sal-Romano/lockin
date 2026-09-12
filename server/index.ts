import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { CreateEventInput, EventPayload, LockedWindow, MeetEvent, PatchEventInput, TimeOption } from '../shared/types'
import { allSlotKeys, dateRangeLabel, fmtDate, fmtRange, DAY_MIN, MAX_END_MIN, optionKey, pad, parseDate } from '../shared/slots'
import * as db from './db'
import * as rooms from './rooms'
import { renderOgCached } from './og'

const PORT = Number(process.env.PORT || 9834)
const ORIGIN = process.env.PUBLIC_ORIGIN || 'https://lockin.sals.site'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// creator-attached event photos live on disk next to the db (data/ is gitignored)
const uploadsDir = join(root, 'data', 'uploads')
mkdirSync(uploadsDir, { recursive: true })
const photoPath = (eventId: string) => join(uploadsDir, `${eventId}.jpg`)

type Env = { Variables: { device: string } }
const app = new Hono<Env>()

// device identity: the HttpOnly cookie is the source of truth (it survives
// Safari ITP purging script-writable storage); the x-device header is the
// bootstrap for the first-ever request. Re-issued every visit so the 399-day
// clock keeps resetting.
app.use('*', async (c, next) => {
  const device = getCookie(c, 'mdid') || c.req.header('x-device') || randomUUID()
  c.set('device', device)
  setCookie(c, 'mdid', device, {
    maxAge: 60 * 60 * 24 * 399, // browsers cap cookies at 400 days
    sameSite: 'Lax',
    httpOnly: true,
    secure: true,
    path: '/',
  })
  await next()
})

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

type FullEvent = MeetEvent & { creatorDevice: string }

const publicEvent = ({ creatorDevice: _cd, ...ev }: FullEvent): MeetEvent => ({
  ...ev,
  hasPhoto: existsSync(photoPath(ev.id)),
})

function payloadFor(ev: FullEvent, device: string): EventPayload {
  const participants = db.getParticipants(ev.id)
  const me = participants.find((p) => p.device === device)?.id ?? null
  const { viewers, anon } = rooms.presence(ev.id)
  return {
    event: publicEvent(ev),
    participants: participants.map(({ device: _d, ...p }) => p),
    me,
    isCreator: device === ev.creatorDevice,
    viewers,
    anon,
  }
}

function broadcastEvent(id: string) {
  const ev = db.getEvent(id)
  if (ev) rooms.broadcast(ev.id, { type: 'event', event: publicEvent(ev) })
}

const validDates = (dates: unknown): string[] | null => {
  if (!Array.isArray(dates)) return null
  const out = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).map(String))].sort()
  return out.length >= 1 && out.length <= 14 ? out : null
}

// collapse control chars/newlines: protects the <title> tag, OG meta, slug
// minting, and ics SUMMARY in one place
const cleanTitle = (raw: unknown) => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

/** clamp + snap a window to the slot size; null when it does not make sense */
function validWindow(startRaw: unknown, endRaw: unknown, slotMin: number): { startMin: number; endMin: number } | null {
  const s0 = Number(startRaw)
  const e0 = Number(endRaw)
  if (Number.isNaN(s0) || Number.isNaN(e0)) return null
  // a window may start anywhere in the day and run past midnight into the small
  // hours of the next one, which is why the end clamps to MAX_END_MIN, not DAY_MIN
  const startMin = Math.floor(Math.max(0, Math.min(DAY_MIN, s0)) / slotMin) * slotMin
  const endMin = Math.ceil(Math.max(0, Math.min(MAX_END_MIN, e0)) / slotMin) * slotMin
  return endMin > startMin ? { startMin, endMin } : null
}

/** validate + dedupe proposed time options for 'slots' mode; null when unusable */
function validOptions(raw: unknown): TimeOption[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const out: TimeOption[] = []
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue
    const date = String((o as { date?: unknown }).date ?? '')
    const startMin = Number((o as { startMin?: unknown }).startMin)
    const endMin = Number((o as { endMin?: unknown }).endMin)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin)) continue
    if (startMin < 0 || startMin > DAY_MIN || endMin < 0 || endMin > MAX_END_MIN) continue
    if (endMin <= startMin) continue
    const opt: TimeOption = { date, startMin, endMin }
    const k = optionKey(opt)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(opt)
  }
  return out.length >= 1 && out.length <= 30 ? out : null
}

/** after an event's shape changes, painted slots outside the new shape go with it */
function refitParticipants(eventId: string) {
  const fresh = db.getEvent(eventId)
  if (!fresh) return
  const valid = new Set(allSlotKeys(publicEvent(fresh)))
  for (const p of db.getParticipants(eventId)) {
    const kept = p.slots.filter((s) => valid.has(s))
    if (kept.length !== p.slots.length) {
      const updated = db.upsertParticipant(eventId, p.device, p.name, kept)
      rooms.broadcast(eventId, { type: 'participant', participant: updated })
    }
  }
}

// ---------- api ----------

app.post('/api/events', async (c) => {
  const body = await c.req.json<CreateEventInput>().catch(() => null)
  if (!body) return c.json({ error: 'bad json' }, 400)

  const mode: MeetEvent['mode'] =
    body.mode === 'slots' ? 'slots' : body.mode === 'date' ? 'date' : 'datetime'

  let dates: string[]
  let startMin: number
  let endMin: number
  let slotMin: number
  let options: TimeOption[]

  if (mode === 'slots') {
    const opts = validOptions(body.options)
    if (!opts) return c.json({ error: '1 to 30 valid time options required' }, 400)
    options = opts
    // date-range labels read off dates, so derive them from the option dates
    dates = [...new Set(opts.map((o) => o.date))].sort()
    slotMin = 30
    // the option grid renders rows over [startMin,endMin]; span the offered
    // blocks (snapped to the slot) so the grid always has rows to show
    startMin = Math.floor(Math.min(...opts.map((o) => o.startMin)) / slotMin) * slotMin
    endMin = Math.ceil(Math.max(...opts.map((o) => o.endMin)) / slotMin) * slotMin
  } else {
    const d = validDates(body.dates)
    if (!d) return c.json({ error: '1 to 14 dates required' }, 400)
    dates = d
    slotMin = [15, 30, 60].includes(Number(body.slotMin)) ? Number(body.slotMin) : 30
    const win = validWindow(body.startMin ?? 17 * 60, body.endMin ?? 23 * 60, slotMin)
    if (!win) return c.json({ error: 'bad time window' }, 400)
    startMin = win.startMin
    endMin = win.endMin
    options = []
  }

  const groupSize = Number(body.groupSize)
  const ev = db.createEvent(
    {
      title: cleanTitle(body.title),
      emoji: String(body.emoji ?? '').slice(0, 8),
      mode,
      tz: String(body.tz ?? 'America/New_York').slice(0, 64),
      dates,
      startMin,
      endMin,
      slotMin,
      options,
      groupSize: groupSize >= 2 && groupSize <= 100 ? Math.floor(groupSize) : null,
    },
    c.get('device'),
  )
  return c.json(publicEvent(ev))
})

// composer-phase live edits: creator only, and only until the slug is minted
// (once the link is out, the shape of the event is frozen)
app.patch('/api/events/:id', async (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)
  if (ev.slug) return c.json({ error: 'event is frozen once shared' }, 409)

  const body = await c.req.json<PatchEventInput>().catch(() => null)
  if (!body) return c.json({ error: 'bad json' }, 400)

  const fields: Parameters<typeof db.patchEvent>[1] = {}
  if (body.title !== undefined) fields.title = cleanTitle(body.title)
  if (body.emoji !== undefined) fields.emoji = String(body.emoji).slice(0, 8)
  if (body.mode !== undefined) fields.mode = body.mode === 'date' ? 'date' : 'datetime'
  if (body.dates !== undefined) {
    const dates = validDates(body.dates)
    if (!dates) return c.json({ error: '1 to 14 dates required' }, 400)
    fields.dates = dates
  }
  if (body.startMin !== undefined || body.endMin !== undefined) {
    // partial input resolves against the stored event, same rules as create
    const win = validWindow(body.startMin ?? ev.startMin, body.endMin ?? ev.endMin, ev.slotMin)
    if (!win) return c.json({ error: 'bad time window' }, 400)
    fields.startMin = win.startMin
    fields.endMin = win.endMin
  }
  if (body.groupSize !== undefined) {
    const g = Number(body.groupSize)
    fields.groupSize = g >= 2 && g <= 100 ? Math.floor(g) : null
  }
  db.patchEvent(ev.id, fields)
  // a shape change (mode/dates/window) may orphan painted slots; trim them
  if (fields.mode !== undefined || fields.dates !== undefined || fields.startMin !== undefined) {
    refitParticipants(ev.id)
  }
  broadcastEvent(ev.id)
  return c.json(publicEvent(db.getEvent(ev.id)!))
})

// mint the readable slug (first share or first paint); idempotent
app.post('/api/events/:id/mint', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  db.mintSlug(ev.id)
  const fresh = db.getEvent(ev.id)!
  broadcastEvent(ev.id)
  return c.json(publicEvent(fresh))
})

app.post('/api/events/:id/lock', async (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)
  const body = await c.req.json<LockedWindow>().catch(() => null)
  if (!body || !ev.dates.includes(body.date)) return c.json({ error: 'bad window' }, 400)
  const locked: LockedWindow =
    ev.mode === 'date'
      ? { date: body.date, startMin: -1, endMin: -1 }
      : { date: body.date, startMin: Number(body.startMin), endMin: Number(body.endMin) }
  db.setLocked(ev.id, locked)
  broadcastEvent(ev.id)
  return c.json(publicEvent(db.getEvent(ev.id)!))
})

app.delete('/api/events/:id/lock', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)
  db.setLocked(ev.id, null)
  broadcastEvent(ev.id)
  return c.json(publicEvent(db.getEvent(ev.id)!))
})

const PHOTO_MAX_BYTES = 8 * 1024 * 1024

/** magic-byte sniff; iOS Safari transcodes HEIC to JPEG for file inputs, so this covers iPhone */
function sniffImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'webp'
  return null
}

// creator attaches a photo: raw image bytes as the body, not multipart
app.post('/api/events/:id/photo', async (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)

  const buf = Buffer.from(await c.req.arrayBuffer())
  if (buf.byteLength > PHOTO_MAX_BYTES) return c.json({ error: 'photo too big, keep it under 8MB' }, 413)
  if (!sniffImage(buf)) return c.json({ error: 'jpeg, png, or webp only' }, 400)

  try {
    // rotate() honors EXIF orientation, and re-encoding strips metadata
    await sharp(buf)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(photoPath(ev.id))
  } catch {
    return c.json({ error: 'could not read that image' }, 400)
  }

  db.touchEvent(ev.id)
  broadcastEvent(ev.id)
  return c.json(publicEvent(db.getEvent(ev.id)!))
})

app.delete('/api/events/:id/photo', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)
  if (existsSync(photoPath(ev.id))) {
    rmSync(photoPath(ev.id), { force: true })
    db.touchEvent(ev.id)
    broadcastEvent(ev.id)
  }
  return c.json(publicEvent(db.getEvent(ev.id)!))
})

app.delete('/api/events/:id', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  if (c.get('device') !== ev.creatorDevice) return c.json({ error: 'not yours' }, 403)
  rooms.broadcast(ev.id, { type: 'gone' })
  db.deleteEvent(ev.id)
  return c.json({ ok: true })
})

app.get('/api/events/:id', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)
  return c.json(payloadFor(ev, c.get('device')))
})

app.put('/api/events/:id/me', async (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{ name?: string; slots?: string[] }>().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 30)
  if (!name) return c.json({ error: 'name required' }, 400)

  const valid = new Set(allSlotKeys(publicEvent(ev)))
  const slots = [...new Set((body?.slots ?? []).map(String))].filter((s) => valid.has(s))

  const device = c.get('device')
  const participant = db.upsertParticipant(ev.id, device, name, slots)
  rooms.identify(ev.id, device, name, participant.id)
  rooms.broadcast(ev.id, { type: 'participant', participant })
  rooms.broadcastPresence(ev.id)
  return c.json(participant)
})

// EventSource cannot set headers, so device rides the query string (cookie as fallback)
app.get('/api/events/:id/stream', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.json({ error: 'not found' }, 404)

  // cookie-first here too: a purge-minted UUID in the query string must not
  // displace a surviving cookie identity
  const device = getCookie(c, 'mdid') || c.req.query('device') || c.get('device')
  const existing = db.findParticipant(ev.id, device)
  const name = (c.req.query('name') || existing?.name || '').trim().slice(0, 30)
  const cid = randomUUID()

  return streamSSE(c, async (stream) => {
    const client: rooms.Client = {
      cid,
      device,
      pid: existing?.id ?? null,
      name,
      send: (msg) => {
        void stream.writeSSE({ data: JSON.stringify(msg) }).catch(() => {})
      },
    }
    rooms.join(ev.id, client)
    rooms.broadcastPresence(ev.id)

    let open = true
    stream.onAbort(() => {
      open = false
      rooms.leave(ev.id, cid)
      rooms.broadcastPresence(ev.id)
    })

    client.send({ type: 'state', payload: payloadFor(ev, device) })

    // keepalive well under Cloudflare's idle timeout
    while (open) {
      await stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {})
      await stream.sleep(20_000)
    }
  })
})

// ---------- og image, ics, event pages ----------

app.get('/e/:id/og.png', async (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.text('not found', 404)
  const png = await renderOgCached(publicEvent(ev), db.getParticipants(ev.id))
  if (!png) return c.text('og renderer unavailable', 503)
  return c.body(new Uint8Array(png), 200, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=60',
  })
})

app.get('/e/:id/photo.jpg', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev) return c.text('not found', 404)
  const p = photoPath(ev.id)
  if (!existsSync(p)) return c.text('no photo', 404)
  return c.body(new Uint8Array(readFileSync(p)), 200, {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=300',
  })
})

// calendar file for a locked event; TZID without VTIMEZONE is accepted by
// Apple and Google calendars for IANA zone names
app.get('/e/:id/ics', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  if (!ev?.locked) return c.text('not locked yet', 404)
  const { date, startMin, endMin } = ev.locked
  const d = parseDate(date)
  const ymdOf = (x: Date) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`
  const t = (min: number) => `${pad(Math.floor(min / 60))}${pad(min % 60)}00`
  // windows ending at midnight roll DTEND to the next day; all-day DTEND is exclusive
  const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  const dt =
    ev.mode === 'date' || startMin < 0
      ? [`DTSTART;VALUE=DATE:${ymdOf(d)}`, `DTEND;VALUE=DATE:${ymdOf(nextDay)}`]
      : [
          `DTSTART;TZID=${ev.tz}:${ymdOf(d)}T${t(startMin)}`,
          `DTEND;TZID=${ev.tz}:${ymdOf(endMin >= 1440 ? nextDay : d)}T${t(endMin % 1440)}`,
        ]
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lockin.sals.site//EN',
    'BEGIN:VEVENT',
    `UID:${ev.id}@lockin.sals.site`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z')}`,
    ...dt,
    `SUMMARY:${(ev.emoji ? ev.emoji + ' ' : '') + ev.title.replace(/[,;\\\r\n]+/g, ' ')}`,
    `URL:${ORIGIN}/e/${ev.slug ?? ev.id}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  return c.body(ics, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="${ev.slug ?? ev.id}.ics"`,
  })
})

function indexHtml(): string {
  const built = join(root, 'dist', 'index.html')
  if (existsSync(built)) return readFileSync(built, 'utf8')
  return readFileSync(join(root, 'index.html'), 'utf8')
}

const DEFAULT_META = `
<meta property="og:title" content="lockin" />
<meta property="og:description" content="find the time that works for everyone" />
<meta property="og:site_name" content="lockin" />
`

function eventMeta(ev: FullEvent): string {
  const participants = db.getParticipants(ev.id)
  const active = participants.filter((p) => p.slots.length > 0)
  const ref = ev.slug ?? ev.id
  const title = `${ev.emoji ? ev.emoji + ' ' : ''}${ev.title || 'hang?'}`
  const when = `${dateRangeLabel(ev.dates)}${ev.mode === 'datetime' ? ` · ${fmtRange(ev.startMin, ev.endMin)}` : ''}`
  const inCount = ev.groupSize ? `${active.length} of ${ev.groupSize} in` : `${active.length} in`
  const desc = ev.locked
    ? `locked: ${fmtDate(ev.locked.date)}${ev.locked.startMin >= 0 ? ` ${fmtRange(ev.locked.startMin, ev.locked.endMin)}` : ''}`
    : active.length > 0
      ? `${when} · ${inCount} so far`
      : `${when} · paint the times you can make`
  return `
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:image" content="${ORIGIN}/e/${ref}/og.png?v=${ev.stateVersion}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${ORIGIN}/e/${ref}" />
<meta property="og:site_name" content="lockin" />
<meta name="twitter:card" content="summary_large_image" />
`
}

app.get('/e/:id', (c) => {
  const ev = db.getEvent(c.req.param('id'))
  const html = indexHtml()
  if (!ev) return c.html(html.replace('<!--APP_META-->', DEFAULT_META))
  // first-frame truth: the SPA boots from this snapshot, no loading spinner.
  // __DEVICE__ tells the client which identity the snapshot was computed for,
  // so a fresh browser adopts the server-minted id instead of forking one.
  const snapshot = `<script>window.__DEVICE__ = ${JSON.stringify(c.get('device'))}; window.__SNAPSHOT__ = ${JSON.stringify(payloadFor(ev, c.get('device'))).replace(/</g, '\\u003c')}</script>`
  return c.html(
    html
      .replace('<!--APP_META-->', eventMeta(ev) + snapshot)
      .replace('<title>lockin</title>', `<title>${esc(ev.title || 'lockin')}</title>`),
  )
})

// ---------- static spa ----------

app.use('/assets/*', serveStatic({ root: './dist' }))
app.get('*', (c) => c.html(indexHtml().replace('<!--APP_META-->', DEFAULT_META)))

// stale-event purge: on boot and daily
const purged = db.purgeStale()
if (purged > 0) console.log(`purged ${purged} stale events`)
setInterval(() => db.purgeStale(), 24 * 60 * 60 * 1000)

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`lockin server on http://localhost:${info.port} (origin ${ORIGIN})`)
})
