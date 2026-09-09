import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMOJI_GROUPS, searchEmojis } from '../../lib/emojiData'

interface EmojiPickerProps {
  /** currently selected emoji, highlighted if it shows up in the grid */
  current?: string
  /** a custom image is currently set */
  hasImage?: boolean
  /** user tapped an emoji */
  onPick: (emoji: string) => void
  /** user chose a custom image */
  onPickImage: (file: File) => void
  /** user asked to drop the custom image */
  onRemoveImage?: () => void
  /** close the sheet */
  onClose: () => void
}

/**
 * Full-screen emoji picker. A bottom sheet on mobile (rounded top, safe-area
 * aware, its own scroll) and a centered card on desktop, painted on a dark
 * scrim that closes on backdrop tap. Type to search a single results grid;
 * an empty box browses every group. An "upload a photo" tile up top swaps in a
 * custom image instead. Escape and the X both close. No essential motion, so it
 * behaves the same under reduced-motion.
 */
export default function EmojiPicker({
  current,
  hasImage,
  onPick,
  onPickImage,
  onRemoveImage,
  onClose,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const q = query.trim()
  const results = useMemo(() => searchEmojis(query), [query])

  // escape closes; lock body scroll while the sheet is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  // focus the search on pointing devices only; a coarse pointer (touch) would
  // pop the on-screen keyboard and swallow the sheet, so we leave it be there
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (!coarse) searchRef.current?.focus()
  }, [])

  const pickEmoji = (e: string) => {
    onPick(e)
    onClose()
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onPickImage(file)
      onClose()
    }
  }

  const renderGrid = (emojis: string[]) => (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))' }}
    >
      {emojis.map((e) => {
        const selected = current === e
        return (
          <button
            key={e}
            type="button"
            onClick={() => pickEmoji(e)}
            aria-label={`pick ${e}`}
            aria-pressed={selected}
            className="flex items-center justify-center rounded-xl text-2xl leading-none transition-colors"
            style={{
              height: 40,
              background: selected ? 'var(--accent-soft)' : 'transparent',
              boxShadow: selected ? 'inset 0 0 0 2px var(--accent)' : undefined,
            }}
          >
            {e}
          </button>
        )
      })}
    </div>
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="pick an emoji"
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl"
        style={{
          background: 'var(--bg)',
          color: 'var(--ink)',
          maxHeight: '85dvh',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* header: title + close */}
        <div
          className="flex flex-none items-center justify-between px-4 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            pick an emoji
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-colors"
            style={{ background: 'var(--bg-sunken)', color: 'var(--ink-soft)' }}
          >
            ×
          </button>
        </div>

        {/* search */}
        <div className="flex-none px-4 pt-3">
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search emoji"
            className="w-full rounded-xl px-3 py-2.5 outline-none"
            style={{
              fontSize: 16, // 16px keeps ios from zooming the field on focus
              background: 'var(--bg-sunken)',
              color: 'var(--ink)',
              border: '1px solid var(--line)',
            }}
          />
        </div>

        {/* custom image tile */}
        <div className="flex-none px-4 pt-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--line)' }}
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-lg"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              +
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                upload a photo
              </span>
              <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                use your own image instead
              </span>
            </span>
          </button>
          {hasImage && onRemoveImage && (
            <button
              type="button"
              onClick={onRemoveImage}
              className="mt-2 px-1 text-xs font-medium underline-offset-2 hover:underline"
              style={{ color: 'var(--ink-soft)' }}
            >
              remove photo
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            className="hidden"
          />
        </div>

        {/* scrollable body: search results or the browse view */}
        <div
          className="mt-3 flex-1 overflow-y-auto px-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        >
          {q ? (
            results.length > 0 ? (
              renderGrid(results)
            ) : (
              <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-faint)' }}>
                no matches
              </p>
            )
          ) : (
            EMOJI_GROUPS.map((group) => (
              <section key={group.name} className="mb-4">
                <h3
                  className="mb-2 text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  {group.name}
                </h3>
                {renderGrid(group.items.map((it) => it.e))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
