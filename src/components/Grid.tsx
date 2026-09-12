import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LockedWindow, MeetEvent, Participant, TimeOption } from '../../shared/types'
import {
  fmtDate,
  fmtDateShort,
  fmtMin,
  fmtRange,
  heatColor,
  monthChangeTags,
  monthOf,
  nameColor,
  optionKey,
  optionLabel,
  parseDate,
  slotCounts,
  slotKey,
  slotMinsForDay,
} from '../../shared/slots'

const GUTTER = 40
const HEADER_H = 44
const MIN_ROW = 24
const MAX_ROW = 60
const MIN_COL = 72
const HINT_KEY = 'lockin:paint-hint-done'
const TAP_HINT_KEY = 'lockin:tap-hint-done'
const SLOT_HINT_KEY = 'lockin:slot-hint-done'

export interface GridProps {
  event: Pick<MeetEvent, 'mode' | 'dates' | 'startMin' | 'endMin' | 'slotMin' | 'options'>
  /** everyone except me */
  others: Participant[]
  mySlots: Set<string>
  /** committed stroke: the full new set plus a human summary of what changed */
  onStroke: (next: Set<string>, summary?: string) => void
  /** heat denominator: people who have responded */
  denom: number
  /** my display name, for the "you" bubble piped into options i picked */
  meName?: string | null
  locked?: LockedWindow | null
  /** slotKey -> painter color, for remote-stroke glints */
  glints?: Map<string, string>
  animateIn?: boolean
  /** view-only: heat renders, painting is off (past events) */
  readOnly?: boolean
}

interface CellRef {
  di: number
  si: number
}

/**
 * The paint surface. Fit-to-screen: row height derives from the viewport so
 * the whole window fits with no internal scroll (24px floor, internal scroll
 * only as a fallback for huge windows). One finger paints a rectangle marquee
 * narrated by a floating pill ("Tue · 7 to 9:30pm"); two fingers pan. Runs of
 * equal state merge into rounded capsules so the grid reads as time windows.
 */
export default function Grid(props: GridProps) {
  if (props.event.mode === 'date') return <DateTiles {...props} />
  // slots mode is two interactions on ONE grid: the organizer PAINTS blocks in
  // the composer (options still empty -> TimeGrid paint), then guests SELECT
  // from those painted blocks on the event page (options present -> OptionGrid).
  if (props.event.mode === 'slots' && props.event.options.length > 0) return <OptionGrid {...props} />
  return <TimeGrid {...props} />
}

function TimeGrid({ event, others, mySlots, onStroke, denom, locked, glints, animateIn, readOnly }: GridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [colW, setColW] = useState(MIN_COL)
  const [rowH, setRowH] = useState(MAX_ROW)
  const [preview, setPreview] = useState<Set<string> | null>(null)
  const [focusCell, setFocusCell] = useState<CellRef | null>(null)
  const [narrator, setNarrator] = useState<{ x: number; y: number; label: string; erasing: boolean } | null>(null)
  const [showHint, setShowHint] = useState(
    () => !readOnly && mySlots.size === 0 && !localStorage.getItem(HINT_KEY),
  )

  const stroke = useRef<{ mode: 'add' | 'erase'; anchor: CellRef; last: CellRef; pointerId: number } | null>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panLast = useRef<{ x: number; y: number } | null>(null)
  const ptr = useRef({ x: 0, y: 0 }) // last pointer during a stroke, for edge auto-scroll
  const rafId = useRef<number | undefined>(undefined)

  const mins = useMemo(() => slotMinsForDay(event as MeetEvent), [event])
  const dates = event.dates
  // month abbreviation per column, only where the month actually changes
  const monthTags = useMemo(() => monthChangeTags(dates), [dates])
  // the corner announces the month of the LEFTMOST VISIBLE column, not dates[0]:
  // with enough days the grid scrolls sideways and a pinned dates[0] would lie
  const [leftCol, setLeftCol] = useState(0)
  const colRaf = useRef(0)
  const onScrollX = () => {
    if (colRaf.current) return
    colRaf.current = requestAnimationFrame(() => {
      colRaf.current = 0
      const el = scrollerRef.current
      if (!el) return
      setLeftCol(Math.min(dates.length - 1, Math.max(0, Math.floor(el.scrollLeft / colW))))
    })
  }
  useEffect(() => () => { if (colRaf.current) cancelAnimationFrame(colRaf.current) }, [])

  const counts = useMemo(() => slotCounts(others), [others])
  const shown = preview ?? mySlots

  // fit-to-container: the scroller fills whatever height its flex parent gives
  // it, and rows divide that space so the whole window shows without scrolling
  // (24px floor; only then does it scroll). ResizeObserver catches the parent
  // resizing, layout above collapsing, and the keyboard shrinking the shell.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const availW = el.clientWidth - GUTTER
      setColW(availW >= dates.length * MIN_COL ? Math.floor(availW / dates.length) : MIN_COL)
      const availH = el.clientHeight - HEADER_H
      const rh = Math.floor(availH / Math.max(1, mins.length))
      setRowH(Math.max(MIN_ROW, Math.min(MAX_ROW, rh)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dates.length, mins.length])

  const cellAt = (clientX: number, clientY: number): CellRef | null => {
    const el = scrollerRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const vx = clientX - r.left
    const vy = clientY - r.top
    if (vx < GUTTER || vy < HEADER_H) return null // sticky rails are not paint targets
    const di = Math.floor((vx + el.scrollLeft - GUTTER) / colW)
    const si = Math.floor((vy + el.scrollTop - HEADER_H) / rowH)
    if (di < 0 || di >= dates.length || si < 0 || si >= mins.length) return null
    return { di, si }
  }

  const rectSet = (a: CellRef, b: CellRef, mode: 'add' | 'erase'): Set<string> => {
    const next = new Set(mySlots)
    for (let di = Math.min(a.di, b.di); di <= Math.max(a.di, b.di); di++) {
      for (let si = Math.min(a.si, b.si); si <= Math.max(a.si, b.si); si++) {
        const key = slotKey(dates[di], mins[si])
        if (mode === 'add') next.add(key)
        else next.delete(key)
      }
    }
    return next
  }

  const strokeSummary = (a: CellRef, b: CellRef, mode: 'add' | 'erase'): string => {
    const d0 = Math.min(a.di, b.di)
    const d1 = Math.max(a.di, b.di)
    const s0 = Math.min(a.si, b.si)
    const s1 = Math.max(a.si, b.si)
    const days = d0 === d1 ? fmtDate(dates[d0]) : `${fmtDateShort(dates[d0])} to ${fmtDateShort(dates[d1])}`
    const time = fmtRange(mins[s0], mins[s1] + event.slotMin)
    return `${mode === 'erase' ? 'out of' : 'in for'} ${days} · ${time}`
  }

  // is the whole day already mine?
  const dayFull = (di: number) => mins.every((m) => mySlots.has(slotKey(dates[di], m)))

  // tap a day header to grab (or drop) the whole day at once: the quick
  // "i'm free all of friday" that complements fine-grained painting
  const toggleDay = (di: number) => {
    if (readOnly) return
    const full = dayFull(di)
    const next = new Set(mySlots)
    for (const m of mins) {
      const k = slotKey(dates[di], m)
      if (full) next.delete(k)
      else next.add(k)
    }
    onStroke(next, `${full ? 'out of' : 'all of'} ${fmtDate(dates[di])}`)
  }

  const endStroke = (commit: boolean) => {
    const s = stroke.current
    stroke.current = null
    setNarrator(null)
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
      rafId.current = undefined
    }
    if (!s) return
    if (commit) {
      setPreview(null)
      localStorage.setItem(HINT_KEY, '1')
      onStroke(rectSet(s.anchor, s.last, s.mode), strokeSummary(s.anchor, s.last, s.mode))
    } else {
      setPreview(null)
    }
  }

  const narrate = (s: NonNullable<typeof stroke.current>, x: number, y: number) => {
    const d0 = Math.min(s.anchor.di, s.last.di)
    const d1 = Math.max(s.anchor.di, s.last.di)
    const s0 = Math.min(s.anchor.si, s.last.si)
    const s1 = Math.max(s.anchor.si, s.last.si)
    const days = d0 === d1 ? fmtDateShort(dates[d0]) : `${fmtDateShort(dates[d0])} to ${fmtDateShort(dates[d1])}`
    setNarrator({ x, y, label: `${days} · ${fmtRange(mins[s0], mins[s1] + event.slotMin)}`, erasing: s.mode === 'erase' })
  }

  // edge auto-scroll: while painting, holding the finger near the top/bottom of
  // the pane scrolls it and keeps extending the marquee, so a block spanning
  // off-screen rows is one continuous drag instead of drag-lift-scroll-repeat
  const autoScroll = () => {
    const el = scrollerRef.current
    const s = stroke.current
    if (!el || !s) {
      rafId.current = undefined
      return
    }
    const r = el.getBoundingClientRect()
    const EDGE = 64
    const MAX = 18
    const { x, y } = ptr.current
    const topZone = r.top + HEADER_H + EDGE
    let dy = 0
    if (y < topZone) dy = -Math.ceil(MAX * Math.min(1, (topZone - y) / EDGE))
    else if (y > r.bottom - EDGE) dy = Math.ceil(MAX * Math.min(1, (y - (r.bottom - EDGE)) / EDGE))
    if (dy !== 0) {
      const before = el.scrollTop
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + dy))
      if (el.scrollTop !== before) {
        const cy = Math.max(r.top + HEADER_H + 1, Math.min(r.bottom - 1, y))
        const cell = cellAt(x, cy)
        if (cell && (cell.di !== s.last.di || cell.si !== s.last.si)) {
          s.last = cell
          setPreview(rectSet(s.anchor, cell, s.mode))
          narrate(s, x, cy)
        }
      }
    }
    rafId.current = requestAnimationFrame(autoScroll)
  }

  useEffect(
    () => () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    },
    [],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2) {
      endStroke(false)
      const pts = [...pointers.current.values()]
      panLast.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      return
    }

    if (readOnly) return
    const cell = cellAt(e.clientX, e.clientY)
    if (!cell) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
    }
    setShowHint(false)
    const key = slotKey(dates[cell.di], mins[cell.si])
    stroke.current = { mode: mySlots.has(key) ? 'erase' : 'add', anchor: cell, last: cell, pointerId: e.pointerId }
    setPreview(rectSet(cell, cell, stroke.current.mode))
    narrate(stroke.current, e.clientX, e.clientY)
    ptr.current = { x: e.clientX, y: e.clientY }
    if (rafId.current == null) rafId.current = requestAnimationFrame(autoScroll)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (pointers.current.size >= 2 && panLast.current) {
      const pts = [...pointers.current.values()]
      const cx = (pts[0].x + pts[1].x) / 2
      const cy = (pts[0].y + pts[1].y) / 2
      const el = scrollerRef.current
      if (el) {
        el.scrollLeft -= cx - panLast.current.x
        el.scrollTop -= cy - panLast.current.y
      }
      panLast.current = { x: cx, y: cy }
      return
    }

    const s = stroke.current
    if (!s || e.pointerId !== s.pointerId) return
    ptr.current = { x: e.clientX, y: e.clientY }
    const cell = cellAt(e.clientX, e.clientY)
    if (cell && (cell.di !== s.last.di || cell.si !== s.last.si)) {
      s.last = cell
      setPreview(rectSet(s.anchor, cell, s.mode))
    }
    narrate(s, e.clientX, e.clientY)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) panLast.current = null
    if (stroke.current && e.pointerId === stroke.current.pointerId) endStroke(true)
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) panLast.current = null
    if (stroke.current && e.pointerId === stroke.current.pointerId) endStroke(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (moves[e.key]) {
      e.preventDefault()
      const cur = focusCell ?? { di: 0, si: 0 }
      const [dx, dy] = moves[e.key]
      setFocusCell({
        di: Math.max(0, Math.min(dates.length - 1, cur.di + dx)),
        si: Math.max(0, Math.min(mins.length - 1, cur.si + dy)),
      })
    } else if ((e.key === ' ' || e.key === 'Enter') && focusCell) {
      e.preventDefault()
      const key = slotKey(dates[focusCell.di], mins[focusCell.si])
      const mode = mySlots.has(key) ? 'erase' : 'add'
      onStroke(rectSet(focusCell, focusCell, mode), strokeSummary(focusCell, focusCell, mode))
    }
  }

  const inLocked = (d: string, m: number) =>
    locked != null && locked.date === d && m >= locked.startMin && m < locked.endMin

  // capsule merging: a cell fuses with its vertical neighbor when both carry
  // the same visual signature (mine, or the same others-heat level), so
  // contiguous runs render as one rounded window. `others` drives the warm
  // heat; `mine` is a solid cool block on top, so your own times are never
  // mistaken for the group's.
  const cellState = (di: number, si: number): { others: number; mine: boolean } | null => {
    if (si < 0 || si >= mins.length) return null
    const key = slotKey(dates[di], mins[si])
    return { others: counts.get(key) ?? 0, mine: shown.has(key) }
  }
  // visual signature for capsule fusion: cells fuse only when they look
  // identical. mine-alone (cool) / mine-with-others (warm + ring) / others-only
  // (warm) / empty are all distinct.
  const sig = (c: { others: number; mine: boolean } | null) =>
    c == null || (!c.mine && c.others === 0)
      ? ''
      : c.mine && c.others === 0
        ? 'me'
        : c.mine
          ? `mh${c.others}`
          : `h${c.others}`

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        role="grid"
        onScroll={onScrollX}
        aria-label="availability grid: days across, times down. arrow keys move, space toggles."
        aria-rowcount={mins.length}
        aria-colcount={dates.length}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-2xl border focus-visible:outline-2"
        style={{
          borderColor: 'var(--line)',
          background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-card)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onBlur={() => setFocusCell(null)}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${GUTTER}px repeat(${dates.length}, ${colW}px)`,
            gridTemplateRows: `${HEADER_H}px repeat(${mins.length}, ${rowH}px)`,
            width: GUTTER + dates.length * colW,
          }}
        >
          {/* establishing month: the corner is otherwise dead space, and it means
              the columns never have to repeat a month that has not changed */}
          <div
            className="sticky left-0 top-0 z-30 flex items-center justify-center"
            style={{ background: 'var(--bg-raised)' }}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              {dates.length > 0 ? monthOf(dates[leftCol] ?? dates[0]) : ''}
            </span>
          </div>

          {dates.map((d, di) => {
            const dt = parseDate(d)
            const full = dayFull(di)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(di)}
                aria-label={`${full ? 'clear' : 'select'} all of ${fmtDate(d)}`}
                disabled={readOnly}
                className={`sticky top-0 z-20 flex flex-col items-center justify-center ${animateIn ? 'ignite' : ''}`}
                style={{
                  background: full ? 'var(--you)' : 'var(--bg-raised)',
                  ['--col' as string]: di,
                }}
              >
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: full ? 'rgba(255,255,255,0.85)' : 'var(--ink-soft)' }}
                >
                  {fmtDate(d).split(' ')[0]}
                </span>
                <span
                  className="text-sm font-bold leading-tight"
                  style={{ color: full ? '#fff' : locked?.date === d ? 'var(--gold)' : 'var(--ink)' }}
                >
                  {monthTags[di] && (
                    <span
                      className="mr-0.5 text-[10px] font-bold uppercase"
                      style={{ color: full ? 'rgba(255,255,255,0.9)' : 'var(--accent)' }}
                    >
                      {monthTags[di]}
                    </span>
                  )}
                  {dt.getDate()}
                </span>
              </button>
            )
          })}

          {mins.map((m, si) => (
            <RowCells
              key={m}
              m={m}
              si={si}
              dates={dates}
              mins={mins}
              shown={shown}
              mySlots={mySlots}
              denom={denom}
              glints={glints}
              inLocked={inLocked}
              animateIn={animateIn}
              focusCell={focusCell}
              rowH={rowH}
              cellState={cellState}
              sig={sig}
            />
          ))}
        </div>
      </div>

      {/* legend: two colors, two meanings, so "mine" is never in doubt */}
      <div className="mt-1.5 flex flex-none items-center justify-center gap-4 text-[11px] font-medium" style={{ color: 'var(--ink-soft)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded" style={{ background: 'var(--you)' }} />
          you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded" style={{ background: heatColor(denom, denom) === 'var(--gold)' ? 'var(--gold)' : 'rgba(234, 88, 12, 0.7)' }} />
          the group
        </span>
      </div>

      {/* the stroke narrator: says what your finger is doing, in words.
          portaled to body so no animated ancestor's transform can trap the
          fixed positioning */}
      {narrator &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold shadow-lg"
            style={{
              left: Math.max(90, Math.min(window.innerWidth - 90, narrator.x)),
              top: Math.max(8, narrator.y - 56),
              background: narrator.erasing ? 'var(--ink)' : 'var(--accent)',
              color: narrator.erasing ? 'var(--bg)' : 'var(--on-accent)',
            }}
          >
            {narrator.erasing ? 'clearing ' : ''}
            {narrator.label}
          </div>,
          document.body,
        )}

      {/* once-per-device ghost stroke: teaches the gesture without a tutorial */}
      {showHint && !readOnly && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div
            className="flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--accent)', color: 'var(--ink)' }}
          >
            <span className="ghost-dot inline-block h-3.5 w-3.5 rounded-full" style={{ background: 'var(--accent)' }} />
            drag the times you can do
          </div>
        </div>
      )}
    </div>
  )
}

function RowCells({
  m,
  si,
  dates,
  mins,
  shown,
  mySlots,
  denom,
  glints,
  inLocked,
  animateIn,
  focusCell,
  rowH,
  cellState,
  sig,
}: {
  m: number
  si: number
  dates: string[]
  mins: number[]
  shown: Set<string>
  mySlots: Set<string>
  denom: number
  glints?: Map<string, string>
  inLocked: (d: string, m: number) => boolean
  animateIn?: boolean
  focusCell: CellRef | null
  rowH: number
  cellState: (di: number, si: number) => { others: number; mine: boolean } | null
  sig: (c: { others: number; mine: boolean } | null) => string
}) {
  const compact = rowH < 32
  return (
    <>
      <div
        className="sticky left-0 z-10 pr-1.5 text-right font-medium"
        style={{
          background: 'var(--bg-raised)',
          color: 'var(--ink-faint)',
          fontSize: compact ? 9 : 10,
          transform: 'translateY(-0.4em)',
        }}
        aria-hidden
      >
        {m % 60 === 0 ? fmtMin(m) : ''}
      </div>
      {dates.map((d, di) => {
        const key = slotKey(d, m)
        const me = cellState(di, si)!
        const mySig = sig(me)
        const fuseUp = mySig !== '' && sig(cellState(di, si - 1)) === mySig
        const fuseDown = mySig !== '' && sig(cellState(di, si + 1)) === mySig
        const glint = glints?.get(key)
        const justPainted = me.mine && !mySlots.has(key)
        const focused = focusCell?.di === di && focusCell?.si === si
        const total = me.others + (me.mine ? 1 : 0)
        // your solo cells are cool (clearly yours); a cell others are also in
        // stays warm (never looks erased) with a cool ring showing you're in it
        const bg =
          me.others > 0 ? (heatColor(total, denom) ?? 'var(--cell-empty)') : me.mine ? 'var(--you)' : 'var(--cell-empty)'
        const ring = me.mine ? 2.5 : 0
        const r = compact ? 8 : 10
        return (
          <div
            key={key}
            role="gridcell"
            aria-rowindex={si + 1}
            aria-colindex={di + 1}
            aria-selected={me.mine}
            aria-label={`${fmtDate(d)} ${fmtMin(m)}, ${total} available${me.mine ? ', including you' : ''}`}
            className={`paint-surface relative ${glint ? 'cell-glint' : ''} ${justPainted ? 'cell-stamp' : ''} ${
              animateIn && si === 0 ? 'ignite' : ''
            }`}
            style={{
              background: bg,
              boxSizing: 'border-box',
              borderStyle: 'solid',
              borderColor: 'var(--you)',
              borderLeftWidth: ring,
              borderRightWidth: ring,
              borderTopWidth: fuseUp ? 0 : ring,
              borderBottomWidth: fuseDown ? 0 : ring,
              margin: `${fuseUp ? 0 : 1.5}px 1.5px ${fuseDown ? 0 : 1.5}px`,
              borderRadius: `${fuseUp ? 0 : r}px ${fuseUp ? 0 : r}px ${fuseDown ? 0 : r}px ${fuseDown ? 0 : r}px`,
              ...(glint ? { ['--glint-color' as string]: glint } : {}),
              ...(inLocked(d, m) ? { outline: '2px solid var(--gold)', outlineOffset: '-2px' } : {}),
              ...(focused ? { outline: '2px solid var(--ink)', outlineOffset: '1px' } : {}),
              ...(animateIn && si === 0 ? { ['--col' as string]: di } : {}),
            }}
          />
        )
      })}
    </>
  )
}

/**
 * date mode ("all day"): day tiles that fit the container. Tiles shrink so
 * every candidate day shows at once (no scroll); rows and tile height derive
 * from the measured box. Your days are a solid cool fill, the group is warm
 * heat, matching the time grid so "mine" reads the same everywhere.
 */
function DateTiles({ event, others, mySlots, onStroke, denom, locked, glints, readOnly }: GridProps) {
  const dates = event.dates
  const counts = useMemo(() => slotCounts(others), [others])
  const stroke = useRef<{ mode: 'add' | 'erase'; touched: Set<string>; pointerId: number } | null>(null)
  const [preview, setPreview] = useState<Set<string> | null>(null)
  const view = preview ?? mySlots

  const boxRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  const [tileH, setTileH] = useState(72)
  const rows = Math.ceil(dates.length / cols)
  const [showHint, setShowHint] = useState(
    () => !readOnly && mySlots.size === 0 && !localStorage.getItem(TAP_HINT_KEY),
  )

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => {
      const c = el.clientWidth >= 560 ? 4 : 3
      setCols(c)
      const rws = Math.ceil(dates.length / c)
      const gaps = (rws - 1) * 8
      const h = Math.floor((el.clientHeight - gaps) / Math.max(1, rws))
      setTileH(Math.max(52, Math.min(120, h)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dates.length])

  const apply = (d: string | undefined) => {
    const s = stroke.current
    if (!s || !d || s.touched.has(d)) return
    s.touched.add(d)
    setPreview((prev) => {
      const next = new Set(prev ?? mySlots)
      if (s.mode === 'add') next.add(d)
      else next.delete(d)
      return next
    })
  }

  const tileAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]')?.dataset.day

  const summary = (slots: Set<string>) => {
    const added = [...slots].filter((d) => !mySlots.has(d)).length
    const removed = [...mySlots].filter((d) => !slots.has(d)).length
    if (added && !removed) return `in for ${added} day${added > 1 ? 's' : ''}`
    if (removed && !added) return `out of ${removed} day${removed > 1 ? 's' : ''}`
    return 'days updated'
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={boxRef}
        className="paint-surface grid min-h-0 flex-1 content-start gap-2"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: `${tileH}px`,
        }}
        onPointerDown={(e) => {
          if (readOnly) return
          if (stroke.current) {
            stroke.current = null
            setPreview(null)
            return
          }
          const d = tileAt(e.clientX, e.clientY)
          if (!d) return
          setShowHint(false)
          localStorage.setItem(TAP_HINT_KEY, '1')
          try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          } catch {
            /* best-effort */
          }
          stroke.current = { mode: mySlots.has(d) ? 'erase' : 'add', touched: new Set(), pointerId: e.pointerId }
          apply(d)
        }}
        onPointerMove={(e) => {
          if (stroke.current && e.pointerId === stroke.current.pointerId) apply(tileAt(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          if (!stroke.current || e.pointerId !== stroke.current.pointerId) return
          stroke.current = null
          if (preview) {
            onStroke(preview, summary(preview))
            setPreview(null)
          }
        }}
        onPointerCancel={(e) => {
          if (!stroke.current || e.pointerId !== stroke.current.pointerId) return
          stroke.current = null
          setPreview(null)
        }}
      >
        {dates.map((d) => {
          const mine = view.has(d)
          const others = counts.get(d) ?? 0
          const total = others + (mine ? 1 : 0)
          const isLocked = locked?.date === d
          // solo-you = cool; a day others also want stays warm with a cool ring
          // + check, so your tap never looks like it erased them
          const warm = others > 0
          const bg = warm ? (heatColor(total, denom) ?? 'var(--bg-raised)') : mine ? 'var(--you)' : 'var(--bg-raised)'
          const solo = mine && !warm
          return (
            <div
              key={d}
              data-day={d}
              className={`relative flex flex-col items-center justify-center rounded-2xl transition-colors ${
                glints?.has(d) ? 'cell-glint' : ''
              }`}
              style={{
                background: bg,
                color: solo ? '#fff' : 'var(--ink)',
                boxSizing: 'border-box',
                borderStyle: 'solid',
                borderWidth: mine ? 3 : 1,
                borderColor: isLocked ? 'var(--gold)' : mine ? 'var(--you)' : 'var(--line)',
                ...(glints?.has(d) ? { ['--glint-color' as string]: glints.get(d) } : {}),
              }}
            >
              {mine && (
                <span
                  className="pointer-events-none absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--you)', color: '#fff' }}
                  aria-hidden
                >
                  ✓
                </span>
              )}
              <span className="pointer-events-none text-sm font-bold">{fmtDate(d)}</span>
              <span
                className="pointer-events-none text-xs"
                style={{ color: solo ? 'rgba(255,255,255,0.85)' : 'var(--ink-soft)' }}
              >
                {total > 0 ? `${total} in` : ' '}
              </span>
            </div>
          )
        })}
      </div>

      {/* once-per-device ghost hint: all-day is tapped, not dragged */}
      {showHint && !readOnly && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 justify-center">
          <div
            className="flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--accent)', color: 'var(--ink)' }}
          >
            <span className="ghost-dot inline-block h-3.5 w-3.5 rounded-full" style={{ background: 'var(--accent)' }} />
            tap the days you can do
          </div>
        </div>
      )}

      <div className="mt-1.5 flex flex-none items-center justify-center gap-4 text-[11px] font-medium" style={{ color: 'var(--ink-soft)' }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded" style={{ background: 'var(--you)' }} />
          you
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded" style={{ background: 'rgba(234, 88, 12, 0.7)' }} />
          the group
        </span>
      </div>
    </div>
  )
}

/**
 * slots mode, SELECT ("pick from times i set"): the SAME day x time grid as
 * TimeGrid, but the organizer has already PAINTED the blocks on offer. Only
 * cells inside an offered option are live and colored; everything else is
 * blank and inert. Each option renders as ONE fused capsule (a mini card with
 * its time range + headcount), and tapping/dragging over a block toggles that
 * whole option in your selection. You cannot paint arbitrary times here, only
 * select from what was offered. Same color model as TimeGrid/DateTiles: your
 * solo pick is a solid cool fill, a pick others share stays warm heat by total
 * with a cool ring + check, others-only is warm, and an untaken offer is a
 * clearly tappable neutral.
 */
function OptionGrid({ event, others, mySlots, onStroke, denom, meName, locked, glints, animateIn, readOnly }: GridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [colW, setColW] = useState(MIN_COL)
  const [rowH, setRowH] = useState(MAX_ROW)
  const [preview, setPreview] = useState<Set<string> | null>(null)
  const [showHint, setShowHint] = useState(
    () => !readOnly && mySlots.size === 0 && !localStorage.getItem(SLOT_HINT_KEY),
  )
  // liquid rises from empty on first paint, then eases as votes change
  const [risen, setRisen] = useState(!animateIn)
  useEffect(() => {
    if (risen) return
    const t = window.setTimeout(() => setRisen(true), 30)
    return () => window.clearTimeout(t)
  }, [risen])

  const stroke = useRef<{ mode: 'add' | 'erase'; touched: Set<string>; pointerId: number } | null>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const panLast = useRef<{ x: number; y: number } | null>(null)

  const mins = useMemo(() => slotMinsForDay(event as MeetEvent), [event])
  const dates = event.dates
  // month abbreviation per column, only where the month actually changes
  const monthTags = useMemo(() => monthChangeTags(dates), [dates])
  // the corner announces the month of the LEFTMOST VISIBLE column, not dates[0]:
  // with enough days the grid scrolls sideways and a pinned dates[0] would lie
  const [leftCol, setLeftCol] = useState(0)
  const colRaf = useRef(0)
  const onScrollX = () => {
    if (colRaf.current) return
    colRaf.current = requestAnimationFrame(() => {
      colRaf.current = 0
      const el = scrollerRef.current
      if (!el) return
      setLeftCol(Math.min(dates.length - 1, Math.max(0, Math.floor(el.scrollLeft / colW))))
    })
  }
  useEffect(() => () => { if (colRaf.current) cancelAnimationFrame(colRaf.current) }, [])

  const options = event.options
  const counts = useMemo(() => slotCounts(others), [others])
  const view = preview ?? mySlots

  // key -> option, so a stroke summary can name the single option you toggled
  const byKey = useMemo(() => {
    const m = new Map<string, TimeOption>()
    for (const o of options) m.set(optionKey(o), o)
    return m
  }, [options])

  // one capsule per option: its column, and the row span it covers on this grid
  const blocks = useMemo(() => {
    const out: { key: string; opt: TimeOption; di: number; siStart: number; siEnd: number }[] = []
    for (const o of options) {
      const di = dates.indexOf(o.date)
      if (di < 0) continue
      let siStart = -1
      let siEnd = -1
      for (let i = 0; i < mins.length; i++) {
        if (mins[i] >= o.startMin && mins[i] < o.endMin) {
          if (siStart === -1) siStart = i
          siEnd = i
        }
      }
      if (siStart === -1) continue
      out.push({ key: optionKey(o), opt: o, di, siStart, siEnd })
    }
    return out
  }, [options, dates, mins])

  // the required (date,min) -> containing option lookup: a cell is "offered"
  // (live + colored) only if it lands inside one of these keys
  const offered = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of blocks) {
      for (let si = b.siStart; si <= b.siEnd; si++) m.set(slotKey(dates[b.di], mins[si]), b.key)
    }
    return m
  }, [blocks, dates, mins])

  // fit-to-container: identical to TimeGrid so both slots interactions (paint in
  // the composer, select here) share one look and one sizing rhythm
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => {
      const availW = el.clientWidth - GUTTER
      setColW(availW >= dates.length * MIN_COL ? Math.floor(availW / dates.length) : MIN_COL)
      const availH = el.clientHeight - HEADER_H
      const rh = Math.floor(availH / Math.max(1, mins.length))
      setRowH(Math.max(MIN_ROW, Math.min(MAX_ROW, rh)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dates.length, mins.length])

  const cellAt = (clientX: number, clientY: number): CellRef | null => {
    const el = scrollerRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const vx = clientX - r.left
    const vy = clientY - r.top
    if (vx < GUTTER || vy < HEADER_H) return null // sticky rails aren't targets
    const di = Math.floor((vx + el.scrollLeft - GUTTER) / colW)
    const si = Math.floor((vy + el.scrollTop - HEADER_H) / rowH)
    if (di < 0 || di >= dates.length || si < 0 || si >= mins.length) return null
    return { di, si }
  }

  // the offered option under the pointer, or undefined over a non-offered cell
  const keyAt = (x: number, y: number): string | undefined => {
    const c = cellAt(x, y)
    if (!c) return undefined
    return offered.get(slotKey(dates[c.di], mins[c.si]))
  }

  const apply = (k: string | undefined) => {
    const s = stroke.current
    if (!s || !k || s.touched.has(k)) return
    s.touched.add(k)
    setPreview((prev) => {
      const next = new Set(prev ?? mySlots)
      if (s.mode === 'add') next.add(k)
      else next.delete(k)
      return next
    })
  }

  const labelForKey = (k: string) => {
    const o = byKey.get(k)
    return o ? optionLabel(o) : 'that time'
  }

  const summary = (slots: Set<string>) => {
    const added = [...slots].filter((k) => !mySlots.has(k))
    const removed = [...mySlots].filter((k) => !slots.has(k))
    if (added.length === 1 && removed.length === 0) return `in for ${labelForKey(added[0])}`
    if (removed.length === 1 && added.length === 0) return `out of ${labelForKey(removed[0])}`
    if (added.length && !removed.length) return `in for ${added.length} times`
    if (removed.length && !added.length) return `out of ${removed.length} times`
    return 'times updated'
  }

  const abortStroke = () => {
    stroke.current = null
    setPreview(null)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // second finger: drop any live selection and start a two-finger pan
    if (pointers.current.size >= 2) {
      abortStroke()
      const pts = [...pointers.current.values()]
      panLast.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      return
    }

    if (readOnly) return
    const k = keyAt(e.clientX, e.clientY)
    if (!k) return // non-offered cell: nothing to select here
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
    }
    setShowHint(false)
    localStorage.setItem(SLOT_HINT_KEY, '1')
    stroke.current = { mode: mySlots.has(k) ? 'erase' : 'add', touched: new Set(), pointerId: e.pointerId }
    apply(k)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && panLast.current) {
      const pts = [...pointers.current.values()]
      const cx = (pts[0].x + pts[1].x) / 2
      const cy = (pts[0].y + pts[1].y) / 2
      const el = scrollerRef.current
      if (el) {
        el.scrollLeft -= cx - panLast.current.x
        el.scrollTop -= cy - panLast.current.y
      }
      panLast.current = { x: cx, y: cy }
      return
    }

    const s = stroke.current
    if (!s || e.pointerId !== s.pointerId) return
    apply(keyAt(e.clientX, e.clientY))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) panLast.current = null
    const s = stroke.current
    if (!s || e.pointerId !== s.pointerId) return
    stroke.current = null
    if (preview) {
      onStroke(preview, summary(preview))
      setPreview(null)
    }
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) panLast.current = null
    if (stroke.current && e.pointerId === stroke.current.pointerId) abortStroke()
  }

  const compact = rowH < 32

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        role="grid"
        onScroll={onScrollX}
        aria-label="offered times: days across, times down. tap the blocks that work."
        aria-rowcount={mins.length}
        aria-colcount={dates.length}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-2xl border focus-visible:outline-2"
        style={{
          borderColor: 'var(--line)',
          background: 'var(--bg-raised)',
          boxShadow: 'var(--shadow-card)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${GUTTER}px repeat(${dates.length}, ${colW}px)`,
            gridTemplateRows: `${HEADER_H}px repeat(${mins.length}, ${rowH}px)`,
            width: GUTTER + dates.length * colW,
          }}
        >
          {/* corner: carries the establishing month so columns only ever show a
              month when it actually changes */}
          <div
            className="sticky left-0 top-0 z-30 flex items-center justify-center"
            style={{ gridColumn: 1, gridRow: 1, background: 'var(--bg-raised)' }}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              {dates.length > 0 ? monthOf(dates[leftCol] ?? dates[0]) : ''}
            </span>
          </div>

          {/* sticky day headers (display only: you select blocks, not days) */}
          {dates.map((d, di) => {
            const dt = parseDate(d)
            return (
              <div
                key={d}
                className={`sticky top-0 z-20 flex flex-col items-center justify-center ${animateIn ? 'ignite' : ''}`}
                style={{ gridColumn: 2 + di, gridRow: 1, background: 'var(--bg-raised)', ['--col' as string]: di }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                  {fmtDate(d).split(' ')[0]}
                </span>
                <span
                  className="text-sm font-bold leading-tight"
                  style={{ color: locked?.date === d ? 'var(--gold)' : 'var(--ink)' }}
                >
                  {monthTags[di] && (
                    <span className="mr-0.5 text-[10px] font-bold uppercase" style={{ color: 'var(--accent)' }}>
                      {monthTags[di]}
                    </span>
                  )}
                  {dt.getDate()}
                </span>
              </div>
            )
          })}

          {/* sticky time gutter */}
          {mins.map((m, si) => (
            <div
              key={m}
              className="sticky left-0 z-10 pr-1.5 text-right font-medium"
              style={{
                gridColumn: 1,
                gridRow: 2 + si,
                background: 'var(--bg-raised)',
                color: 'var(--ink-faint)',
                fontSize: compact ? 9 : 10,
                transform: 'translateY(-0.4em)',
              }}
              aria-hidden
            >
              {m % 60 === 0 ? fmtMin(m) : ''}
            </div>
          ))}

          {/* one fused capsule per offered option; non-offered cells render
              nothing, so the raised background reads as "not on offer" */}
          {blocks.map((b) => {
            const { key: k, opt: o, di, siStart, siEnd } = b
            const mine = view.has(k)
            const otherCount = counts.get(k) ?? 0
            const total = otherCount + (mine ? 1 : 0)
            const isLocked =
              locked?.date === o.date && locked?.startMin === o.startMin && locked?.endMin === o.endMin
            const everyone = total > 0 && total >= denom && denom >= 2
            // the glass fills to the share of responders who are in; a lone vote
            // still shows a visible sliver, and everyone tops it off completely
            const frac = denom > 0 ? Math.min(1, total / denom) : 0
            const fillPct = total === 0 ? 0 : everyone ? 100 : Math.max(12, Math.round(frac * 100))
            const spanH = (siEnd - siStart + 1) * rowH
            const justPainted = mine && !mySlots.has(k)
            const r = compact ? 8 : 10
            // who is in, piped in as bubbles: you first (accent), then others
            const voters = others.filter((p) => p.slots.includes(k))
            const bubbles = [
              ...(mine ? [{ label: (meName || 'you').slice(0, 1).toUpperCase(), me: true, color: 'var(--accent)' }] : []),
              ...voters.map((p) => ({ label: p.name.slice(0, 1).toUpperCase(), me: false, color: nameColor(p.name) })),
            ]
            const shown = bubbles.slice(0, 3)
            const extra = bubbles.length - shown.length
            return (
              <div
                key={k}
                role="gridcell"
                aria-selected={mine}
                aria-label={`${optionLabel(o)}, ${total} in${mine ? ', including you' : ''}${everyone ? ', everyone' : ''}`}
                className={`relative flex flex-col items-center overflow-hidden text-center ${
                  glints?.has(k) ? 'cell-glint' : ''
                } ${justPainted ? 'cell-stamp' : ''}`}
                style={{
                  gridColumn: 2 + di,
                  gridRow: `${2 + siStart} / ${3 + siEnd}`,
                  margin: 2,
                  borderRadius: r,
                  background: 'var(--bg-sunken)',
                  color: 'var(--ink)',
                  boxSizing: 'border-box',
                  boxShadow: isLocked
                    ? 'inset 0 0 0 2px var(--gold)'
                    : mine
                      ? 'inset 0 0 0 2px var(--accent)'
                      : 'inset 0 0 0 1px var(--line)',
                  ...(glints?.has(k) ? { ['--glint-color' as string]: glints.get(k) } : {}),
                }}
              >
                {/* the liquid: height = share of the group who are in */}
                <div
                  className={`lockin-fill ${everyone ? 'lockin-fill-full' : ''}`}
                  style={{ height: risen ? `${fillPct}%` : '0%' }}
                  aria-hidden
                />
                {/* content sits above the liquid */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-1.5">
                  <div className="flex flex-col items-center gap-0.5">
                    <span
                      className="text-xs font-bold leading-tight"
                      style={{ color: 'var(--ink)', textShadow: '0 1px 2px rgba(0,0,0,0.28)' }}
                    >
                      {fmtRange(o.startMin, o.endMin)}
                    </span>
                    {everyone ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                        style={{ background: 'var(--gold)', color: '#3a2a05' }}
                      >
                        everyone
                      </span>
                    ) : (
                      total > 0 && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--ink-soft)', textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>
                          {total}
                          {denom >= 2 ? ` of ${denom}` : ''} in
                        </span>
                      )
                    )}
                  </div>
                  {spanH >= 52 && bubbles.length > 0 && (
                    <div className="flex items-center pl-1">
                      {shown.map((bub, i) => (
                        <span
                          key={i}
                          className="-ml-1 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold first:ml-0"
                          style={{
                            background: bub.color,
                            color: bub.me ? 'var(--on-accent)' : '#fff',
                            boxShadow: bub.me
                              ? '0 0 0 1.5px var(--bg-sunken), 0 0 0 3px var(--accent)'
                              : '0 0 0 1.5px var(--bg-sunken)',
                          }}
                        >
                          {bub.label}
                        </span>
                      ))}
                      {extra > 0 && (
                        <span
                          className="-ml-1 flex h-5 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                          style={{ background: 'var(--bg-raised)', color: 'var(--ink-soft)', boxShadow: '0 0 0 1.5px var(--bg-sunken)' }}
                        >
                          +{extra}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* once-per-device ghost hint: here you SELECT offered blocks, not paint */}
      {showHint && !readOnly && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div
            className="flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg"
            style={{ background: 'var(--bg-raised)', borderColor: 'var(--accent)', color: 'var(--ink)' }}
          >
            <span className="ghost-dot inline-block h-3.5 w-3.5 rounded-full" style={{ background: 'var(--accent)' }} />
            tap the blocks that work
          </div>
        </div>
      )}
    </div>
  )
}
