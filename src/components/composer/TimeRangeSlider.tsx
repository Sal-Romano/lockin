import { useRef } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { DAY_MIN, fmtRange, MAX_END_MIN } from '../../../shared/slots'

interface TimeRangeSliderProps {
  startMin: number
  endMin: number
  /** fires live as either thumb moves; already clamped + snapped */
  onChange: (startMin: number, endMin: number) => void
  min?: number
  max?: number
  /** snap granularity, minutes */
  step?: number
  /** the window can never be tighter than this, minutes */
  minGap?: number
}

/**
 * Faint orientation marks under the rail. Six evenly spaced labels land exactly
 * on 6-hour marks because the track runs 0 to MAX_END_MIN (30 hours), so the
 * last one is 6am the following morning.
 */
const TICKS = ['12a', '6a', '12p', '6p', '12a', '6a']

/**
 * A two-thumb time-of-day range. Presets pre-position the thumbs; dragging either
 * one nudges the window into a custom range, so there is no separate "custom" UI.
 *
 * All pointer handling lives on the rail: a press grabs whichever thumb is
 * nearer (so tapping the rail also works), drag moves it, snapped to `step` and
 * clamped so the two never cross closer than `minGap`. touch-action: none keeps a
 * horizontal drag from turning into a page scroll. Thumbs are keyboard-focusable
 * (arrow keys nudge by one step); they are pointer-transparent so the rail owns
 * every gesture and there is no "which element got the event" ambiguity.
 */
export default function TimeRangeSlider({
  startMin,
  endMin,
  onChange,
  min = 0,
  max = MAX_END_MIN,
  step = 30,
  minGap = 60,
}: TimeRangeSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<'start' | 'end' | null>(null)

  const pct = (v: number) => ((v - min) / (max - min)) * 100

  const valueAt = (clientX: number): number => {
    const el = railRef.current
    if (!el) return startMin
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round((min + ratio * (max - min)) / step) * step
  }

  const move = (which: 'start' | 'end', clientX: number) => {
    const v = valueAt(clientX)
    if (which === 'start') onChange(Math.min(v, endMin - minGap, DAY_MIN), endMin)
    else onChange(startMin, Math.max(v, startMin + minGap))
  }

  const nudge = (which: 'start' | 'end', delta: number) => {
    if (which === 'start') onChange(Math.min(Math.max(min, startMin + delta), endMin - minGap, DAY_MIN), endMin)
    else onChange(startMin, Math.max(Math.min(max, endMin + delta), startMin + minGap))
  }

  const onKey = (which: 'start' | 'end') => (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(which, -step)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      nudge(which, step)
    }
  }

  const thumbStyle = (v: number): CSSProperties => ({
    position: 'absolute',
    left: `${pct(v)}%`,
    top: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'var(--bg-raised)',
    boxShadow: 'inset 0 0 0 2px var(--accent), var(--shadow-card)',
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-center text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {fmtRange(startMin, endMin)}
      </div>
      <div className="px-3">
        <div
          ref={railRef}
          className="relative h-10 touch-none select-none"
          onPointerDown={(e) => {
            const v = valueAt(e.clientX)
            const which = Math.abs(v - startMin) <= Math.abs(v - endMin) ? 'start' : 'end'
            drag.current = which
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* capture is best-effort */
            }
            move(which, e.clientX)
          }}
          onPointerMove={(e) => {
            if (drag.current) move(drag.current, e.clientX)
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          {/* rail */}
          <div
            className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full"
            style={{ background: 'var(--bg-sunken)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
          />
          {/* selected span */}
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
            style={{
              left: `${pct(startMin)}%`,
              width: `${pct(endMin) - pct(startMin)}%`,
              background: 'var(--accent-soft)',
              boxShadow: 'inset 0 0 0 1px var(--accent)',
            }}
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label="start time"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={startMin}
            onKeyDown={onKey('start')}
            className="pointer-events-none h-6 w-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={thumbStyle(startMin)}
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label="end time"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={endMin}
            onKeyDown={onKey('end')}
            className="pointer-events-none h-6 w-6 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={thumbStyle(endMin)}
          />
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] font-medium" style={{ color: 'var(--ink-faint)' }}>
          {TICKS.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
