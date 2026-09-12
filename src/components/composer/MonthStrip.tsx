import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { pad } from '../../../shared/slots'

const DOW_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** weeks rendered from the current week (about six months of runway) */
const WEEKS = 26
/** direction lock: a pointer must travel this far before we decide paint vs scroll */
const LOCK_PX = 8
/** label row + five and a half week rows: the cut row plus fades say "scroll me" */
const VIEW_H = 312

const FADE =
  'linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)'

interface DayCell {
  key: string
  day: number
  monthName: string
  past: boolean
  today: boolean
  first: boolean
}

interface WeekRow {
  /** month label row rendered above this week, when it opens a month */
  label: string | null
  /** month this week mostly belongs to, for the pinned header */
  month: string
  days: DayCell[]
}

interface MonthStripProps {
  selected: Set<string>
  /** fires live, once per day the finger crosses */
  onChange: (next: Set<string>) => void
  /** the gesture ended: parent syncs to the server */
  onCommit: () => void
  onCapHit: () => void
  max: number
}

/**
 * ~26 weeks from the current week in a vertical scroller about 5.5 rows tall.
 * Day cells are touch-action: pan-y, so native vertical scroll stays alive; the
 * stroke machine arms only after the pointer shows horizontal intent (moved
 * >= 8px with |dx| > |dy|). Once armed it paints exactly like before:
 * first-cell-decides, elementFromPoint hit testing, pointer captured on the
 * scroller, per-pointer identity, a second finger never hijacks. pointercancel
 * means the browser took the gesture for scrolling: revert the preview, commit
 * nothing. A plain tap (up with no lock, < 8px travel) toggles the day. Month
 * label rows and past days carry no data-day, so they stay scroll rails.
 */
export default function MonthStrip({ selected, onChange, onCommit, onCapHit, max }: MonthStripProps) {
  const stroke = useRef<{
    mode: 'add' | 'erase'
    work: Set<string>
    /** snapshot from arm time, restored on pointercancel */
    base: Set<string>
    touched: Set<string>
    pointerId: number
  } | null>(null)
  /** a pointer that went down on a day but has not picked paint vs scroll yet */
  const pending = useRef<{ id: number; x: number; y: number; day: string } | null>(null)

  const weeks = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const start = new Date(today)
    start.setDate(start.getDate() - start.getDay())
    const out: WeekRow[] = []
    for (let w = 0; w < WEEKS; w++) {
      let label: string | null = null
      const days: DayCell[] = []
      let mid = today
      for (let i = 0; i < 7; i++) {
        const d = new Date(start)
        d.setDate(start.getDate() + w * 7 + i)
        if (i === 3) mid = d // midweek decides the month the header shows
        if (d.getDate() === 1) {
          label = d.getFullYear() === today.getFullYear() ? MON_FULL[d.getMonth()] : `${MON_FULL[d.getMonth()]} ${d.getFullYear()}`
        }
        days.push({
          key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          day: d.getDate(),
          monthName: MON[d.getMonth()],
          past: d.getTime() < today.getTime(),
          today: d.getTime() === today.getTime(),
          first: d.getDate() === 1,
        })
      }
      // the top of the scroller always announces the month you are looking at;
      // if a new month sneaks into week 0, its day-1 cell still wears the tiny name
      if (w === 0) label = MON_FULL[today.getMonth()]
      const month =
        mid.getFullYear() === today.getFullYear()
          ? MON_FULL[mid.getMonth()]
          : `${MON_FULL[mid.getMonth()]} ${mid.getFullYear()}`
      out.push({ label, month, days })
    }
    return out
  }, [])

  // pinned month header: which month is at the top of the scroller right now.
  // Each week's first cell carries [data-m], so this is a short walk, and it is
  // rAF-throttled because it runs on every scroll frame.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [visMonth, setVisMonth] = useState(() => weeks[0]?.month ?? '')
  const rafId = useRef(0)
  const syncMonth = () => {
    const el = scrollerRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    let cur = ''
    for (const n of el.querySelectorAll<HTMLElement>('[data-m]')) {
      if (n.getBoundingClientRect().top - top <= 12) cur = n.dataset.m ?? ''
      else break
    }
    if (cur) setVisMonth(cur)
  }
  const onScroll = () => {
    if (rafId.current) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      syncMonth()
    })
  }
  useEffect(() => {
    syncMonth()
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dayAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]')?.dataset.day

  const apply = (d: string | undefined) => {
    const s = stroke.current
    if (!s || !d || s.touched.has(d)) return
    s.touched.add(d)
    if (s.mode === 'add') {
      if (s.work.has(d)) return
      if (s.work.size >= max) {
        onCapHit()
        return
      }
      s.work.add(d)
    } else if (!s.work.delete(d)) {
      return
    }
    onChange(new Set(s.work))
  }

  const end = (pointerId: number) => {
    if (!stroke.current || stroke.current.pointerId !== pointerId) return
    stroke.current = null
    onCommit()
  }

  /** single-day toggle: plain taps and keyboard activation (click detail 0) */
  const toggleDay = (d: string) => {
    const next = new Set(selected)
    if (next.has(d)) {
      next.delete(d)
    } else {
      if (next.size >= max) {
        onCapHit()
        return
      }
      next.add(d)
    }
    onChange(next)
    onCommit()
  }

  return (
    <div className="select-none" style={{ WebkitTouchCallout: 'none' }}>
      {/* pinned month: the scroller runs ~6 months deep, so this is the anchor
          that says which one you are actually looking at */}
      <div className="mb-1 flex h-5 items-center">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
          {visMonth}
        </span>
      </div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {DOW_LETTERS.map((l, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--ink-faint)' }}
          >
            {l}
          </div>
        ))}
      </div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        aria-label="pick days"
        className="overflow-y-auto overscroll-y-contain"
        // starts at scrollTop 0, which IS the current week; no programmatic
        // scrolling ever runs, so reduced motion has nothing to opt out of
        style={{ maxHeight: VIEW_H, scrollbarWidth: 'none', maskImage: FADE, WebkitMaskImage: FADE }}
        onPointerDown={(e) => {
          if (stroke.current || pending.current) return // a second finger never hijacks
          const d = dayAt(e.clientX, e.clientY)
          if (!d) return
          pending.current = { id: e.pointerId, x: e.clientX, y: e.clientY, day: d }
        }}
        onPointerMove={(e) => {
          const p = pending.current
          if (p && p.id === e.pointerId && !stroke.current) {
            const dx = e.clientX - p.x
            const dy = e.clientY - p.y
            if (Math.hypot(dx, dy) < LOCK_PX) return
            pending.current = null
            if (Math.abs(dx) > Math.abs(dy)) {
              // horizontal intent: arm the stroke, first cell decides the mode
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                /* capture is best-effort */
              }
              stroke.current = {
                mode: selected.has(p.day) ? 'erase' : 'add',
                work: new Set(selected),
                base: new Set(selected),
                touched: new Set(),
                pointerId: e.pointerId,
              }
              apply(p.day)
              apply(dayAt(e.clientX, e.clientY))
            }
            // vertical intent: the scroll owns this pointer, nothing to do
            return
          }
          if (stroke.current && e.pointerId === stroke.current.pointerId) apply(dayAt(e.clientX, e.clientY))
        }}
        onPointerUp={(e) => {
          const p = pending.current
          if (p && p.id === e.pointerId) {
            // never locked and travelled < 8px: a plain tap
            pending.current = null
            toggleDay(p.day)
            return
          }
          end(e.pointerId)
        }}
        onPointerCancel={(e) => {
          if (pending.current?.id === e.pointerId) pending.current = null
          const s = stroke.current
          if (s && s.pointerId === e.pointerId) {
            // the browser claimed the gesture for scrolling: no stroke happened
            stroke.current = null
            onChange(new Set(s.base))
          }
        }}
      >
        <div className="grid grid-cols-7 gap-1.5 pb-3 pt-2">
          {weeks.map((wk, w) => (
            <Fragment key={w}>
              {wk.label && (
                <div className="col-span-7 flex h-6 items-center gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {wk.label}
                  </span>
                  <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
                </div>
              )}
              {wk.days.map((c, ci) => {
                if (c.past) {
                  return (
                    <div
                      key={c.key}
                      data-m={ci === 0 ? wk.month : undefined}
                      className="flex h-11 flex-col items-center justify-center rounded-full text-sm font-medium"
                      style={{ color: 'var(--ink-faint)', opacity: 0.55 }}
                    >
                      {c.first && (
                        <span className="text-[8px] font-bold uppercase leading-none opacity-75">{c.monthName}</span>
                      )}
                      <span className="leading-tight">{c.day}</span>
                    </div>
                  )
                }
                const sel = selected.has(c.key)
                return (
                  <button
                    key={c.key}
                    data-m={ci === 0 ? wk.month : undefined}
                    type="button"
                    data-day={c.key}
                    aria-pressed={sel}
                    onClick={(e) => {
                      if (e.detail === 0) toggleDay(c.key)
                    }}
                    className={`cmp-day touch-pan-y flex h-11 flex-col items-center justify-center rounded-full text-sm font-semibold ${
                      sel ? 'cmp-day-pop' : ''
                    }`}
                    style={
                      // one selected recipe (accent-soft + ring), matching every
                      // other option; today is a neutral ink-faint ring so accent
                      // only ever means selected
                      sel
                        ? { background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1.5px var(--accent)', color: 'var(--ink)' }
                        : c.today
                          ? { boxShadow: 'inset 0 0 0 1.5px var(--ink-faint)', color: 'var(--ink)' }
                          : { color: 'var(--ink)' }
                    }
                  >
                    {c.first && (
                      <span className="text-[8px] font-bold uppercase leading-none opacity-75">{c.monthName}</span>
                    )}
                    <span className="leading-tight">{c.day}</span>
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
