import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/** breathing room between the card and the viewport edges */
const GUTTER = 12
/** gap between the trigger and the card */
const GAP = 8
/** caret half-width, also its minimum inset from the card's corners */
const CARET = 7

interface Pos {
  left: number
  top: number
  /** caret x, relative to the card's left edge */
  caret: number
  /** card sits above the trigger (not enough room below) */
  flipped: boolean
}

interface InfoTipProps {
  /** accessible name, e.g. "why set a window?" */
  label: string
  children: ReactNode
}

/**
 * The one "?" explainer used everywhere. A small non-blocking popover.
 *
 * It MUST portal to document.body: `.cmp-rise` is declared with
 * `animation ... both`, so those sections keep `transform: translateY(0)`
 * forever, and a non-none transform becomes the containing block for any
 * fixed-position descendant. An in-place fixed card would be positioned
 * against the section instead of the viewport, and would still be clipped by
 * the composer's overflow-hidden shell / overflow-y-auto scroller. (Grid.tsx's
 * narrator pill portals for the same reason.) That trap vanishes under Reduce
 * Motion, which removes the transform, so it would only break for other people.
 *
 * Dismissal is a capture-phase document pointerdown that bails only when the tap
 * landed inside THIS instance (its card or its own trigger). No scrim:
 * a tap elsewhere should dismiss this AND still hit the control you aimed at,
 * because this explains something, it does not block anything. Exempting our own
 * trigger is also what keeps a second tap on "?" from closing and instantly
 * reopening. pointerdown (not click) because iOS does not reliably fire click
 * on non-interactive elements and drops it entirely when the tap becomes a
 * scroll. A fixed card cannot track a scrolling anchor, so scrolling closes it.
 */
export default function InfoTip({ label, children }: InfoTipProps) {
  // the trigger rect captured at open time; null means closed
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const open = anchor !== null

  const close = () => {
    setAnchor(null)
    setPos(null)
  }
  // re-measure on every open: the trigger moves as the composer scrolls
  const toggle = () => {
    if (open) return close()
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    setPos(null)
    setAnchor(r)
  }

  // place it once the real card is in the DOM, so width/height are measured and
  // not guessed. width is pinned in CSS so this first read is already correct.
  useLayoutEffect(() => {
    if (!anchor || !boxRef.current) return
    const vv = window.visualViewport
    const vLeft = vv?.offsetLeft ?? 0
    const vTop = vv?.offsetTop ?? 0
    const vW = vv?.width ?? window.innerWidth
    const vH = vv?.height ?? window.innerHeight
    // offsetWidth/Height, NOT getBoundingClientRect: the entry animation is
    // play-pending at this point and its 0% keyframe holds transform: scale(0.96),
    // so a rect read here is the scaled box and every clamp below inherits the error
    const bw = boxRef.current.offsetWidth
    const bh = boxRef.current.offsetHeight

    const minL = vLeft + GUTTER
    const maxL = Math.max(minL, vLeft + vW - GUTTER - bw)
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - bw / 2, minL), maxL)

    const belowTop = anchor.bottom + GAP
    const fitsBelow = belowTop + bh <= vTop + vH - GUTTER
    const top = fitsBelow ? belowTop : Math.max(vTop + GUTTER, anchor.top - GAP - bh)

    // keep the caret nailed to the trigger even after the card was clamped
    const caret = Math.min(Math.max(anchor.left + anchor.width / 2 - left, CARET + 3), bw - CARET - 3)
    setPos({ left, top, caret, flipped: !fitsBelow })
  }, [anchor])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node | null
      // only THIS instance's own nodes are exempt. exempting every trigger would
      // leave this card open when a sibling "?" is tapped, floating two at once.
      // Our own trigger still bails, so its click toggles us shut without a reopen.
      if (n && (triggerRef.current?.contains(n) || boxRef.current?.contains(n))) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        triggerRef.current?.focus()
      }
    }
    const vv = window.visualViewport
    // scroll does not bubble, so the nested composer scroller needs capture
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    vv?.addEventListener('resize', close)
    vv?.addEventListener('scroll', close)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      vv?.removeEventListener('resize', close)
      vv?.removeEventListener('scroll', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-infotip-trigger
        aria-label={label}
        aria-expanded={open}
        onClick={toggle}
        className="relative flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold active:scale-90"
        style={{
          background: 'var(--bg-raised)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
          color: 'var(--ink-soft)',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
          transition: 'transform 120ms ease',
        }}
      >
        ?{/* invisible 36px touch target around the 20px dot */}
        <span className="absolute -inset-2" aria-hidden />
      </button>

      {open &&
        createPortal(
          <div
            ref={boxRef}
            data-infotip
            role="dialog"
            aria-label={label}
            className="tip-in fixed z-[900] rounded-xl py-2.5 pl-3.5 pr-2"
            style={{
              left: pos ? pos.left : 0,
              top: pos ? pos.top : 0,
              width: 280,
              maxWidth: 'calc(100vw - 24px)',
              // hidden until measured, so it never flashes at 0,0
              visibility: pos ? 'visible' : 'hidden',
              background: 'var(--bg-raised)',
              boxShadow: 'inset 0 0 0 1px var(--line), var(--shadow-card)',
            }}
          >
            {/* caret, pointing back at the trigger */}
            <span
              aria-hidden
              className="absolute h-2.5 w-2.5 rotate-45"
              style={{
                left: (pos?.caret ?? 0) - 5,
                ...(pos?.flipped ? { bottom: -6 } : { top: -6 }),
                background: 'var(--bg-raised)',
                ...(pos?.flipped
                  ? { borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }
                  : { borderLeft: '1px solid var(--line)', borderTop: '1px solid var(--line)' }),
              }}
            />
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1 text-[12px] leading-snug" style={{ color: 'var(--ink-soft)' }}>
                {children}
              </div>
              <button
                type="button"
                data-infotip-close
                onClick={close}
                aria-label="close"
                className="-mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-base leading-none active:scale-90"
                style={{
                  color: 'var(--ink-faint)',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'transform 120ms ease',
                }}
              >
                ×
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
