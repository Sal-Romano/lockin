import { useEffect, useMemo, useRef, useState } from 'react'
import type { Hotspot } from '../../shared/slots'
import type { EventMode, LockedWindow, Participant } from '../../shared/types'
import {
  dateRangeLabel,
  fmtDate,
  fmtRange,
  hotspots,
  nameColor,
  optionKey,
  optionLabel,
  pad,
  slotKey,
} from '../../shared/slots'
import { navigate } from '../App'
import Grid from '../components/Grid'
import { api } from '../lib/api'
import { savedName, saveName } from '../lib/device'
import { useEventStream } from '../lib/useEventStream'

const TZ_SHORT: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PT',
  'America/Indiana/Indianapolis': 'ET',
}
const tzLabel = (tz: string) => TZ_SHORT[tz] ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz

interface LockCandidate {
  date: string
  startMin: number
  endMin: number
  label: string
  count: number
  names: string[]
}

export default function EventPage({ refId }: { refId: string }) {
  const [name, setName] = useState<string | null>(savedName())
  const [nameDraft, setNameDraft] = useState('')
  const [needsName, setNeedsName] = useState(false)
  const { payload, setPayload, viewers, anon, conn, gone } = useEventStream(refId, name)

  const [mySlots, setMySlots] = useState<Set<string>>(new Set())
  const mySlotsRef = useRef(mySlots)
  mySlotsRef.current = mySlots
  const seeded = useRef(false)
  const dirty = useRef(false)
  const [saveTrouble, setSaveTrouble] = useState(false)
  const [undoState, setUndoState] = useState<{ prev: Set<string>; label: string } | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [lockUndo, setLockUndo] = useState(false)
  const lockUndoTimer = useRef<number | undefined>(undefined)
  const [lockSheet, setLockSheet] = useState(false)
  const [confirmLock, setConfirmLock] = useState<LockCandidate | null>(null)
  const [glints, setGlints] = useState<Map<string, string>>(new Map())
  const glintTimers = useRef<Set<number>>(new Set())
  const prevOthers = useRef<Map<string, Set<string>>>(new Map())
  const [celebrate, setCelebrate] = useState(0)
  const bestCount = useRef(0)
  const lastCelebration = useRef(0)

  // the shell is exactly one screen and never scrolls; on iOS the keyboard
  // shrinks visualViewport, so we track it and the grid gives up the space
  const [shellH, setShellH] = useState<number>(() => window.visualViewport?.height ?? window.innerHeight)
  useEffect(() => {
    const vv = window.visualViewport
    const onResize = () => setShellH(vv?.height ?? window.innerHeight)
    vv?.addEventListener('resize', onResize)
    window.addEventListener('resize', onResize)
    return () => {
      vv?.removeEventListener('resize', onResize)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // focus mode: collapse the chrome to a thumbnail strip so the grid goes big
  const [focus, setFocus] = useState(false)
  const [coachDismissed, setCoachDismissed] = useState(false)

  // seed my slots once: from my participant row, or from paint the composer
  // handed off before a name existed
  useEffect(() => {
    if (!payload || seeded.current) return
    seeded.current = true
    const mine = payload.participants.find((p) => p.id === payload.me)
    if (mine) {
      setMySlots(new Set(mine.slots))
      return
    }
    try {
      const stash = sessionStorage.getItem(`lockin:paint:${payload.event.id}`)
      if (stash) {
        sessionStorage.removeItem(`lockin:paint:${payload.event.id}`)
        const slots = new Set<string>(JSON.parse(stash))
        if (slots.size > 0) {
          setMySlots(slots)
          setNeedsName(true)
        }
      }
    } catch {
      /* stash is best-effort */
    }
  }, [payload])

  // remote strokes land as painter-colored glints; each timer cleans only its
  // own keys and runs to completion (cancelling on re-render strands entries)
  useEffect(() => {
    if (!payload) return
    const fresh: [string, string][] = []
    for (const p of payload.participants) {
      if (p.id === payload.me) continue
      const prev = prevOthers.current.get(p.id)
      if (prev) {
        for (const s of p.slots) if (!prev.has(s)) fresh.push([s, nameColor(p.name)])
      }
      prevOthers.current.set(p.id, new Set(p.slots))
    }
    if (fresh.length === 0) return
    setGlints((g) => new Map([...g, ...fresh]))
    const keys = fresh.map(([k]) => k)
    const t = window.setTimeout(() => {
      glintTimers.current.delete(t)
      setGlints((g) => {
        const next = new Map(g)
        for (const k of keys) next.delete(k)
        return next
      })
    }, 750)
    glintTimers.current.add(t)
  }, [payload])

  // unmount hygiene for glint timers
  useEffect(
    () => () => {
      for (const t of glintTimers.current) window.clearTimeout(t)
    },
    [],
  )

  const ev = payload?.event
  const merged: Participant[] = useMemo(() => {
    if (!payload) return []
    return [
      ...payload.participants.filter((p) => p.id !== payload.me),
      ...(payload.me || mySlots.size > 0 || name
        ? [{ id: payload.me ?? 'me', name: name ?? 'me', slots: [...mySlots], updatedAt: 0 }]
        : []),
    ]
  }, [payload, mySlots, name])

  const active = merged.filter((p) => p.slots.length > 0)
  // heat is absolute over people who have RESPONDED (matches the OG card);
  // groupSize only feeds the "n of m in" copy and the flame ratio
  const denom = Math.max(1, active.length)
  const spots = useMemo(() => (ev ? hotspots(ev, merged) : []), [ev, merged])

  // celebrate only when the best possible outcome improves (never on shifts)
  useEffect(() => {
    const top = spots[0]?.count ?? 0
    if (top >= 2 && top > bestCount.current && Date.now() - lastCelebration.current > 30_000) {
      lastCelebration.current = Date.now()
      setCelebrate((c) => c + 1)
    }
    bestCount.current = Math.max(bestCount.current, top)
  }, [spots])

  const save = (slots: Set<string>, n = name) => {
    if (!ev || !n) return
    api
      .saveMe(ev.id, n, [...slots])
      .then((p) => {
        dirty.current = false
        setSaveTrouble(false)
        // adopt my participant id so the SSE echo of my own save is never
        // mistaken for another person (the double-count bug class)
        setPayload((prev) => (prev && prev.me !== p.id ? { ...prev, me: p.id } : prev))
      })
      .catch((err) => {
        console.error(err)
        dirty.current = true
        setSaveTrouble(true)
      })
  }

  // dirty paint retries when the network comes back or the tab returns
  useEffect(() => {
    const flush = () => {
      if (dirty.current && document.visibilityState === 'visible') save(mySlotsRef.current)
    }
    window.addEventListener('online', flush)
    document.addEventListener('visibilitychange', flush)
    const tick = window.setInterval(flush, 8000)
    return () => {
      window.removeEventListener('online', flush)
      document.removeEventListener('visibilitychange', flush)
      window.clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev?.id, name])

  const onStroke = (next: Set<string>, summary?: string) => {
    const prev = mySlots
    setMySlots(next)
    if (name) save(next)
    else setNeedsName(true)
    // persistent: the undo button stays until you use it or paint again
    setUndoState({ prev, label: summary ?? 'updated' })
  }

  const undo = () => {
    if (!undoState) return
    setMySlots(undoState.prev)
    if (name) save(undoState.prev)
    setUndoState(null)
  }

  const submitName = () => {
    const n = nameDraft.trim().slice(0, 30)
    if (!n) return
    saveName(n)
    setName(n)
    setNeedsName(false)
    save(mySlots, n)
  }

  const share = async () => {
    if (!ev) return
    let slug = ev.slug
    if (!slug && payload?.isCreator) slug = (await api.mint(ev.id).catch(() => null))?.slug ?? null
    const url = `${window.location.origin}/e/${slug ?? ev.id}`
    try {
      if (navigator.share) {
        // title + url only: passing text breaks the iOS Copy action
        await navigator.share({ title: ev.title || 'lockin', url })
        return
      }
    } catch {
      return // user closed the sheet
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  // everything the creator can lock: the ranked hotspots, then a whole-window
  // option per day, so they can always lock something even when it is quiet.
  const lockCandidates: LockCandidate[] = useMemo(() => {
    if (!ev) return []
    if (ev.mode === 'date') {
      return ev.dates
        .map((d) => {
          const names = merged.filter((p) => p.slots.includes(d)).map((p) => p.name)
          return { date: d, startMin: -1, endMin: -1, label: fmtDate(d), count: names.length, names }
        })
        .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
    }
    if (ev.mode === 'slots') {
      // options are already discrete, so list them straight (no "all of <day>"
      // whole-window entries), ranked by who selected each one
      return ev.options
        .map((o) => {
          const k = optionKey(o)
          const names = merged.filter((p) => p.slots.includes(k)).map((p) => p.name)
          return { date: o.date, startMin: o.startMin, endMin: o.endMin, label: optionLabel(o), count: names.length, names }
        })
        .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date) || a.startMin - b.startMin)
    }
    const out: LockCandidate[] = spots.map((s) => ({
      date: s.date,
      startMin: s.startMin,
      endMin: s.endMin,
      label: `${fmtDate(s.date)} · ${fmtRange(s.startMin, s.endMin)}`,
      count: s.count,
      names: s.names,
    }))
    for (const d of ev.dates) {
      const names = whoCanMake({ date: d, startMin: ev.startMin, endMin: ev.endMin }, merged, ev.slotMin, ev.mode)
      out.push({
        date: d,
        startMin: ev.startMin,
        endMin: ev.endMin,
        label: `all of ${fmtDate(d)} · ${fmtRange(ev.startMin, ev.endMin)}`,
        count: names.length,
        names,
      })
    }
    return out
  }, [ev, merged, spots])

  const doLock = async (c: LockCandidate) => {
    if (!ev) return
    setConfirmLock(null)
    setLockSheet(false)
    try {
      await api.lock(ev.id, { date: c.date, startMin: c.startMin, endMin: c.endMin })
    } catch (err) {
      console.error(err)
      return // no undo chip for a lock that never happened
    }
    setLockUndo(true)
    window.clearTimeout(lockUndoTimer.current)
    lockUndoTimer.current = window.setTimeout(() => setLockUndo(false), 6000)
  }

  const unlock = async () => {
    if (!ev) return
    setLockUndo(false)
    await api.unlock(ev.id).catch(console.error)
  }

  if (gone && !payload) {
    return (
      <div className="flex min-h-full items-center justify-center p-8 text-center" style={{ color: 'var(--ink-soft)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
            this link fizzled
          </div>
          <div className="text-sm">it may have been deleted, or the url got mangled in transit. ask for a fresh one.</div>
          <button
            onClick={() => navigate('/')}
            className="mt-2 rounded-full px-5 py-2.5 text-sm font-bold"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            start a new one
          </button>
        </div>
      </div>
    )
  }

  if (!payload || !ev) {
    return (
      <div className="mx-auto max-w-2xl animate-pulse px-5 py-8">
        <div className="mb-3 h-8 w-2/3 rounded-lg" style={{ background: 'var(--bg-sunken)' }} />
        <div className="mb-8 h-4 w-1/3 rounded" style={{ background: 'var(--bg-sunken)' }} />
        <div className="h-72 rounded-2xl" style={{ background: 'var(--bg-sunken)' }} />
      </div>
    )
  }

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzNote = viewerTz !== ev.tz ? `times are in ${tzLabel(ev.tz)}` : null
  const inLine = ev.groupSize ? `${active.length} of ${ev.groupSize} in` : active.length > 0 ? `${active.length} in` : null
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const isPast = ev.dates.every((d) => d < todayKey)
  // stage emphasis: until you have painted, the grid is the hero and the
  // hotspots stay out of the way; once you are in, the answer takes the stage
  const hasPainted = mySlots.size > 0 || payload.me != null
  // name-first: a fresh visitor names themselves before the grid appears, so
  // their cells are unmistakably theirs from the first stroke
  const gateActive = !name && !isPast && !ev.locked

  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden px-4"
      style={{ height: shellH }}
    >
      {/* focus mode: the need-to-knows shrink to one line so the grid goes big */}
      {focus && (
        <div className="flex flex-none items-center gap-2 pb-2 pt-3">
          <span className="flex-none text-lg">{ev.emoji}</span>
          <span className="truncate text-sm font-bold">{ev.title || 'hang?'}</span>
          {inLine && (
            <span className="flex-none text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              {inLine}
            </span>
          )}
          <button
            onClick={() => setFocus(false)}
            className="ml-auto flex-none rounded-full px-4 py-1.5 text-sm font-bold"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            done
          </button>
        </div>
      )}

      {/* header */}
      {!focus && (
      <header className="flex flex-none items-start justify-between gap-3 pb-2 pt-4">

        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">
            {ev.emoji && <span className="mr-1.5">{ev.emoji}</span>}
            {ev.title || 'hang?'}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm" style={{ color: 'var(--ink-soft)' }}>
            <span>
              {dateRangeLabel(ev.dates)}
              {ev.mode === 'datetime' && ` · ${fmtRange(ev.startMin, ev.endMin)}`}
            </span>
            {inLine && (
              <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                {inLine}
              </span>
            )}
            {tzNote && <span className="text-xs">({tzNote})</span>}
          </p>
        </div>
        <button
          onClick={share}
          className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-95"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {copied ? 'copied!' : 'share'}
        </button>
      </header>
      )}

      {/* presence: honest, connection-derived */}
      {!focus && (
      <div className="flex min-h-7 flex-none items-center gap-1.5 pb-2">
        {viewers.map((v) => (
          <span
            key={v.pid}
            className="flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-bold text-white"
            style={{ backgroundColor: nameColor(v.name) }}
            title={v.name}
          >
            {v.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
        {anon > 0 && (
          <span
            className="flex h-7 items-center rounded-full border border-dashed px-2 text-xs"
            style={{ borderColor: 'var(--ink-faint)', color: 'var(--ink-soft)' }}
          >
            +{anon} peeking
          </span>
        )}
        <span className="ml-1 flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${conn === 'connecting' ? 'pulse-soft' : ''}`}
            style={{ background: conn === 'live' ? 'var(--live)' : 'var(--gold)' }}
          />
          {conn === 'live' ? 'live' : 'connecting'}
        </span>
      </div>
      )}

      {gateActive ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 pb-10 text-center">
          <div className="text-4xl">👋</div>
          <div className="flex flex-col gap-1">
            <div className="text-lg font-bold" style={{ color: 'var(--ink)' }}>
              what should we call you?
            </div>
            <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              {active.length > 0
                ? `${active.length} already in${
                    spots[0]
                      ? ` · best so far ${fmtDate(spots[0].date)}${
                          spots[0].startMin >= 0 ? `, ${fmtRange(spots[0].startMin, spots[0].endMin)}` : ''
                        }`
                      : ''
                  }`
                : 'be the first to drop your times'}
            </div>
          </div>
          <form
            className="flex w-full max-w-xs items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submitName()
            }}
          >
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="your name"
              maxLength={30}
              autoFocus
              className="min-w-0 flex-1 rounded-full border px-4 py-3 text-[16px] outline-none"
              style={{ background: 'var(--bg-raised)', borderColor: 'var(--accent)', color: 'var(--ink)' }}
            />
            <button
              type="submit"
              disabled={!nameDraft.trim()}
              className="flex-none rounded-full px-5 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-30"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              jump in
            </button>
          </form>
          <div className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            saved on this device, so you only do this once
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 pb-2">
          {/* decided hero / ranked hotspots / notes (hidden in focus mode) */}
          {!focus && (
            <>
          {ev.locked ? (
        <LockedHero
          locked={ev.locked}
          title={ev.title}
          emoji={ev.emoji}
          names={whoCanMake(ev.locked, merged, ev.slotMin, ev.mode)}
          groupSize={ev.groupSize}
          slugOrId={ev.slug ?? ev.id}
          isCreator={payload.isCreator}
          onShare={share}
          onUnlock={unlock}
        />
      ) : (
        /* one stable, compact best-so-far line: it never grows or squishes the
           grid as people pick. the full ranked list + lock lives in the lock sheet */
        spots.length > 0 && (
          <div className="flex flex-none items-center gap-2 text-sm">
            <span className="shrink-0">🔥</span>
            <span className="min-w-0 truncate font-semibold" style={{ color: 'var(--ink)' }}>
              {fmtDate(spots[0].date)}
              {spots[0].startMin >= 0 ? ` · ${fmtRange(spots[0].startMin, spots[0].endMin)}` : ''}
              {spots[0].count >= denom && denom >= 2 ? ' · everyone!' : ''}
            </span>
            <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--ink-soft)' }}>
              {spots[0].count}
              {ev.groupSize ? ` of ${ev.groupSize}` : ''} in
            </span>
          </div>
        )
      )}

      {isPast && (
        <p
          className="rounded-2xl border px-4 py-2.5 text-sm"
          style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)', color: 'var(--ink-soft)' }}
        >
          this one already happened. the heat stays up for the memories.
        </p>
      )}

      {/* creator can lock any time, anytime, even before it is a clear winner */}
      {payload.isCreator && !ev.locked && !isPast && (
        <button
          onClick={() => setLockSheet(true)}
          className="flex flex-none items-center justify-center gap-1.5 self-start rounded-full border px-3.5 py-1.5 text-xs font-semibold active:scale-95"
          style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)', color: 'var(--ink-soft)' }}
        >
          🔒 lock the plan
        </button>
      )}

      {/* shown only when there is no best-so-far line, so exactly one status
          line is ever present and the grid never shifts */}
      {spots.length === 0 && !ev.locked && !isPast && (
        <p className="flex-none text-sm" style={{ color: 'var(--ink-soft)' }}>
          {ev.mode === 'date'
            ? "nobody's picked days yet. go first!"
            : ev.mode === 'slots'
              ? "nobody's tapped a block yet. go first!"
              : 'nobody has painted yet. first stroke decides the vibe.'}
        </p>
      )}
            </>
          )}

          <div className="flex min-h-0 flex-1 flex-col pt-0.5">
            <Grid
              event={ev}
              others={merged.filter((p) => p.id !== (payload.me ?? 'me'))}
              mySlots={mySlots}
              onStroke={onStroke}
              denom={denom}
              locked={ev.locked}
              glints={glints}
              animateIn
              readOnly={isPast || ev.locked != null}
            />
          </div>

          {/* controls: persistent undo (last action) + focus toggle */}
          <div className="flex flex-none items-center justify-between gap-2 pt-1.5">
            {undoState && !isPast && !ev.locked ? (
              <button
                onClick={undo}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold active:scale-95"
                style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)', color: 'var(--ink)' }}
              >
                <span className="text-sm leading-none">↶</span> undo
              </button>
            ) : (
              <span className="truncate text-xs" style={{ color: saveTrouble ? 'var(--accent)' : 'var(--ink-faint)' }}>
                {ev.locked
                  ? '🔒 locked in. the grid is closed.'
                  : saveTrouble
                    ? 'that stroke did not save. retrying.'
                    : isPast
                      ? 'this one already happened.'
                      : ev.mode === 'datetime'
                        ? 'drag to paint, or tap a day to grab it all'
                        : ev.mode === 'slots'
                          ? 'tap the blocks that work for you'
                          : 'tap the days you can make'}
              </span>
            )}
            {/* focus mode only helps the timed grid; all-day tiles are already big */}
            {!isPast && !focus && !ev.locked && ev.mode === 'datetime' && (
              <button
                onClick={() => setFocus(true)}
                className="flex flex-none items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold active:scale-95"
                style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)', color: 'var(--ink-soft)' }}
              >
                bigger
                <span className="text-[13px] leading-none">⤢</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* floating: lock undo (stroke undo lives in the controls row now) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {lockUndo && (
          <button
            onClick={unlock}
            className="pointer-events-auto rounded-full px-4 py-2 text-sm font-semibold shadow-lg"
            style={{ background: 'var(--ink)', color: 'var(--bg)' }}
          >
            locked! tap to undo
          </button>
        )}
      </div>

      {/* lock chooser: every day/window is lockable, even when it is quiet */}
      {lockSheet && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setLockSheet(false)}
        >
          <div
            className="max-h-[80dvh] overflow-y-auto rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            style={{ background: 'var(--bg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-lg font-bold">lock a time</div>
            <div className="mb-4 text-sm" style={{ color: 'var(--ink-soft)' }}>
              pick when it's happening. you can lock any of these, even the quiet ones.
            </div>
            <div className="flex flex-col gap-2">
              {lockCandidates.map((c, i) => (
                <button
                  key={`${c.date}${c.startMin}${i}`}
                  onClick={() => setConfirmLock(c)}
                  className="flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left active:scale-[0.99]"
                  style={{ borderColor: 'var(--line)', background: 'var(--bg-raised)' }}
                >
                  <span className="min-w-0 truncate text-sm font-semibold">{c.label}</span>
                  <span className="shrink-0 text-xs" style={{ color: c.count > 0 ? 'var(--accent)' : 'var(--ink-faint)' }}>
                    {ev.groupSize ? `${c.count} of ${ev.groupSize}` : `${c.count} in`}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setLockSheet(false)}
              className="mt-3 w-full rounded-2xl py-3 text-sm font-semibold"
              style={{ background: 'var(--bg-sunken)', color: 'var(--ink-soft)' }}
            >
              never mind
            </button>
          </div>
        </div>
      )}

      {/* the "are you sure?" confirm before it closes for everyone */}
      {confirmLock && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setConfirmLock(null)}
        >
          <div
            className="w-full max-w-xs rounded-3xl p-5 text-center"
            style={{ background: 'var(--bg-raised)', boxShadow: 'var(--shadow-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-2xl">🔒</div>
            <div className="mt-2 text-lg font-bold leading-tight">lock {confirmLock.label}?</div>
            <div className="mt-1.5 text-sm" style={{ color: 'var(--ink-soft)' }}>
              {confirmLock.count === 0
                ? 'nobody has said they can make this yet.'
                : `${confirmLock.count}${ev.groupSize ? ` of ${ev.groupSize}` : ''} can make it${
                    confirmLock.names.length ? `: ${confirmLock.names.slice(0, 5).join(', ')}` : ''
                  }${confirmLock.names.length > 5 ? ` +${confirmLock.names.length - 5}` : ''}.`}
              <br />
              this ends voting and closes the grid for everyone.
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => doLock(confirmLock)}
                className="w-full rounded-2xl py-3 text-sm font-bold"
                style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
              >
                lock it in
              </button>
              <button
                onClick={() => setConfirmLock(null)}
                className="w-full rounded-2xl py-2.5 text-sm font-semibold"
                style={{ color: 'var(--ink-soft)' }}
              >
                not yet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function whoCanMake(locked: LockedWindow, participants: Participant[], slotMin: number, mode?: EventMode): string[] {
  if (mode === 'slots') {
    // the locked window IS an option; match on its exact key
    const k = optionKey({ date: locked.date, startMin: locked.startMin, endMin: locked.endMin })
    return participants.filter((p) => p.slots.includes(k)).map((p) => p.name)
  }
  if (locked.startMin < 0) return participants.filter((p) => p.slots.includes(locked.date)).map((p) => p.name)
  // datetime: must cover the WHOLE locked window, not just touch the day
  const keys: string[] = []
  for (let m = locked.startMin; m < locked.endMin; m += slotMin) keys.push(slotKey(locked.date, m))
  return participants.filter((p) => keys.every((k) => p.slots.includes(k))).map((p) => p.name)
}

function LockedHero({
  locked,
  title,
  emoji,
  names,
  groupSize,
  slugOrId,
  isCreator,
  onShare,
  onUnlock,
}: {
  locked: LockedWindow
  title: string
  emoji: string
  names: string[]
  groupSize: number | null
  slugOrId: string
  isCreator: boolean
  onShare: () => void
  onUnlock: () => void
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: 'var(--gold)', borderColor: 'var(--accent)', color: '#221d18' }}
    >
      <div className="flex items-center gap-2 text-sm font-bold">
        <span>🏆</span>
        <span className="truncate">
          {emoji ? `${emoji} ` : ''}
          {title || 'the plan'} is on
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold leading-tight">
        {fmtDate(locked.date)}
        {locked.startMin >= 0 && <span className="block text-lg">{fmtRange(locked.startMin, locked.endMin)}</span>}
      </div>
      <div className="mt-2 text-sm opacity-80">
        {names.length > 0 ? (
          <>
            <span className="font-semibold">
              {names.length}
              {groupSize ? ` of ${groupSize}` : ''} going:
            </span>{' '}
            {names.join(', ')}
          </>
        ) : (
          'no confirmations yet, tell the group!'
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={`/e/${slugOrId}/ics`}
          className="rounded-full px-4 py-2 text-sm font-bold"
          style={{ background: '#221d18', color: 'var(--gold)' }}
        >
          add to calendar
        </a>
        <button
          onClick={onShare}
          className="rounded-full border-2 px-4 py-2 text-sm font-bold"
          style={{ borderColor: '#221d18' }}
        >
          tell the group
        </button>
        {isCreator && (
          <button onClick={onUnlock} className="ml-auto text-xs font-semibold underline opacity-60">
            unlock
          </button>
        )}
      </div>
    </div>
  )
}

/** three embers drifting off the crown chip; scarce by design */
function Embers() {
  return (
    <span className="pointer-events-none absolute -top-1 right-6">
      {[-14, 2, 16].map((dx, i) => (
        <span
          key={i}
          className="ember absolute inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--accent)', ['--dx' as string]: `${dx}px`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  )
}
