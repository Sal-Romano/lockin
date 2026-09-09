import { useEffect, useMemo, useRef, useState } from 'react'
import type { CreateEventInput, EventMode, TimeOption } from '../../shared/types'
import { fmtRange, optionKey, parseDate } from '../../shared/slots'
import { api } from '../lib/api'
import { savedName } from '../lib/device'
import { suggestEmojis } from '../lib/emojiSuggest'
import { seasonalPlaceholders } from '../lib/planIdeas'
import { navigate } from '../App'
import MonthStrip from '../components/composer/MonthStrip'
import TimeRangeSlider from '../components/composer/TimeRangeSlider'
import EmojiPicker from '../components/composer/EmojiPicker'
import Grid from '../components/Grid'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// optional group-size stepper: greyed at the default until you touch it, then
// +/- adjust; dialing below the min switches it back off (optional)
const GROUP_DEFAULT = 3
const GROUP_MIN = 2
const GROUP_MAX = 20
const MAX_DAYS = 14
const SLOT_MIN = 30

const PRESETS = [
  { label: 'evenings', sub: '5 to 11pm', emoji: '🌆', start: 17 * 60, end: 23 * 60 },
  { label: 'mornings', sub: '8am to 12pm', emoji: '🌅', start: 8 * 60, end: 12 * 60 },
  { label: 'afternoons', sub: '12 to 5pm', emoji: '☀️', start: 12 * 60, end: 17 * 60 },
  { label: 'all hours', sub: '8am to 11pm', emoji: '🕛', start: 8 * 60, end: 23 * 60 },
]
// chronological display order (data stays evenings-first; presetIdx indexes data)
const PRESET_ORDER = [1, 2, 0, 3]

// the editable chip label per chosen mode; the two timed flavors live under
// "specific times" so they read as the flavor, not the umbrella
const MODE_CHIP: Record<EventMode, string> = {
  datetime: '🖌️ everyone paints',
  slots: '🗳️ pick from times i set',
  date: '📅 all day',
}

const TZ_SHORT: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Detroit': 'ET',
  'America/Indiana/Indianapolis': 'ET',
  'America/Kentucky/Louisville': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Boise': 'MT',
  'America/Phoenix': 'MT',
  'America/Los_Angeles': 'PT',
}


/**
 * Roll a set of painted slotKeys into offered TimeOptions: group by day, then
 * merge maximal runs of consecutive slot-times (step = slotMin) into one block,
 * so a dragged-out span becomes a single {date, startMin, endMin} option and a
 * gap splits into two.
 */
function optionsFromPainted(painted: Set<string>, slotMin: number): TimeOption[] {
  const byDate = new Map<string, number[]>()
  for (const k of painted) {
    const date = k.slice(0, 10)
    const min = Number(k.slice(11))
    if (!Number.isFinite(min)) continue
    const arr = byDate.get(date)
    if (arr) arr.push(min)
    else byDate.set(date, [min])
  }
  const out: TimeOption[] = []
  for (const [date, mins] of byDate) {
    mins.sort((a, b) => a - b)
    let runStart = mins[0]
    let prev = mins[0]
    for (let i = 1; i <= mins.length; i++) {
      if (i < mins.length && mins[i] === prev + slotMin) {
        prev = mins[i]
        continue
      }
      out.push({ date, startMin: runStart, endMin: prev + slotMin })
      if (i < mins.length) {
        runStart = mins[i]
        prev = mins[i]
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
}

/**
 * The composer is mostly setup, a few taps: title, "specific times or all day?",
 * which days, and (for timed events) when-ish. The one place it paints is the
 * 'slots' flavor, where the organizer paints the blocks they're OFFERING on the
 * same grid guests will see (guests then tap the offered blocks). For datetime
 * and date the creator paints/picks their own availability on the event page
 * afterward. "get the link" creates the event and drops them straight into it.
 */
export default function Create() {
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('')
  const [mode, setMode] = useState<EventMode | null>(null)
  // "specific times" fans out into a datetime/slots sub-choice before a mode is set
  const [timesOpen, setTimesOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingDays, setEditingDays] = useState(true)
  const [startMin, setStartMin] = useState(PRESETS[0].start)
  const [endMin, setEndMin] = useState(PRESETS[0].end)
  const [whyOpen, setWhyOpen] = useState(false)
  const [groupSize, setGroupSize] = useState<number | null>(null)
  // slots mode: the organizer PAINTS the blocks they're offering on a grid.
  // `painted` holds slotKey cells; on create they roll up into TimeOptions.
  const [painted, setPainted] = useState<Set<string>>(new Set())
  // reveals the paint grid once the offered-times window is confirmed
  const [slotsPainting, setSlotsPainting] = useState(false)
  // slots: the organizer is usually free for the blocks they're offering, so we
  // offer to mark them in for all of them (skipping a re-select on the next page)
  const [iAmInAll, setIAmInAll] = useState(true)
  const [whyMineOpen, setWhyMineOpen] = useState(false)
  // floating info popover for the group-size control; any tap elsewhere closes it
  const [sizeInfoOpen, setSizeInfoOpen] = useState(false)
  const [capNote, setCapNote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [titleError, setTitleError] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const pendingPhoto = useRef<File | null>(null)
  const photoInput = useRef<HTMLInputElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const userPickedEmoji = useRef(false)
  const lastAutoEmoji = useRef('')

  const reduceMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const coarse = useMemo(() => window.matchMedia('(pointer: coarse)').matches, [])
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const tzLabel = TZ_SHORT[tz] ?? tz

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

  // emoji auto-suggest as they type (best match, prefixes included so it pops
  // early); a manual pick via the picker pins it. no match -> the "+" chip.
  const autoEmoji = useMemo(() => suggestEmojis(title)[0] ?? null, [title])
  useEffect(() => {
    if (userPickedEmoji.current) return
    if (!autoEmoji) {
      if (lastAutoEmoji.current) {
        setEmoji((prev) => (prev === lastAutoEmoji.current ? '' : prev))
        lastAutoEmoji.current = ''
      }
      return
    }
    if (autoEmoji === lastAutoEmoji.current) return
    lastAutoEmoji.current = autoEmoji
    setEmoji(autoEmoji)
  }, [autoEmoji])

  // seasonal placeholder that rotates through the idea bank while the field is
  // empty: this month's ideas first, so it feels timely on load
  const ideas = useMemo(() => seasonalPlaceholders(new Date()), [])
  const [ideaIdx, setIdeaIdx] = useState(0)
  useEffect(() => {
    if (title !== '' || ideas.length < 2 || reduceMotion) return
    const t = window.setInterval(() => setIdeaIdx((i) => (i + 1) % ideas.length), 3400)
    return () => window.clearInterval(t)
  }, [title, ideas.length, reduceMotion])
  const placeholderIdea = ideas.length ? ideas[ideaIdx % ideas.length] : 'pizza night?'

  const dates = useMemo(() => [...selected].sort(), [selected])
  const daysChosen = dates.length > 0 && !editingDays
  const hasTitle = title.trim().length > 0
  // slots is gated on having painted >=1 offered block; datetime/date stay gated
  // on >=1 picked day
  const canCreate =
    hasTitle && (mode === 'slots' ? painted.size > 0 : mode != null && dates.length > 0)

  // the synthetic event the slots PAINT step feeds to <Grid/>: mode 'datetime'
  // so it routes to the paint surface (TimeGrid), the picked days and chosen
  // window as its axes, no options (the organizer is defining them by painting)
  const paintGridEvent = useMemo(
    () => ({
      mode: 'datetime' as const,
      dates,
      startMin,
      endMin,
      slotMin: SLOT_MIN,
      options: [] as TimeOption[],
    }),
    [dates, startMin, endMin],
  )

  // if the window or days shrink under already-painted cells, drop the ones that
  // now fall outside so the derived options never spill past the offered window
  useEffect(() => {
    if (mode !== 'slots') return
    setPainted((prev) => {
      if (prev.size === 0) return prev
      const dateSet = new Set(dates)
      const next = new Set<string>()
      for (const k of prev) {
        const d = k.slice(0, 10)
        const m = Number(k.slice(11))
        if (dateSet.has(d) && m >= startMin && m < endMin) next.add(k)
      }
      return next.size === prev.size ? prev : next
    })
  }, [mode, dates, startMin, endMin])

  // gate the flow on a name: bounce to the title field, flash it red
  const requireTitle = (): boolean => {
    if (hasTitle) return true
    setTitleError(true)
    titleRef.current?.focus()
    return false
  }

  useEffect(() => {
    if (!capNote) return
    const t = window.setTimeout(() => setCapNote(false), 2000)
    return () => window.clearTimeout(t)
  }, [capNote])

  // the info popover floats above everything and dismisses on ANY interaction
  // elsewhere. the trigger + popover stopPropagation, so this only sees "outside"
  // pointerdowns; attached a tick after open so the opening tap never closes it.
  useEffect(() => {
    if (!sizeInfoOpen) return
    const close = () => setSizeInfoOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [sizeInfoOpen])

  const presetIdx = PRESETS.findIndex((p) => p.start === startMin && p.end === endMin)

  const pickPhoto = (file: File) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(URL.createObjectURL(file))
    pendingPhoto.current = file // uploaded right after the event is created
  }
  const removePhoto = () => {
    pendingPhoto.current = null
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(null)
  }

  // emoji picker modal: emoji and custom photo are alternatives for the visual
  const pickEmoji = (e: string) => {
    userPickedEmoji.current = true
    if (photoPreview) removePhoto()
    setEmoji(e)
    setPickerOpen(false)
  }
  const pickImage = (file: File) => {
    userPickedEmoji.current = true
    setEmoji('')
    pickPhoto(file)
    setPickerOpen(false)
  }

  // tapping "specific times" reveals the datetime/slots sub-choice (still gated on a title)
  const openTimes = () => {
    if (!requireTitle()) return
    setTimesOpen(true)
  }

  const chooseMode = (m: EventMode) => {
    if (!requireTitle()) return
    setMode(m)
    // slots starts each attempt fresh: back to defining the window + blocks
    setSlotsPainting(false)
    setPainted(new Set())
    if (dates.length === 0) setEditingDays(true)
  }

  // group-size stepper. off shows the default as a dim preview; +/- always MOVE
  // the number (off -> default±1) so a tap visibly does something, and tapping
  // the number/label adopts the default as-is. dialing below the min turns the
  // counter back off. the whole pill lights up when on, so on/off is unmistakable.
  const groupUp = () => setGroupSize((n) => (n == null ? GROUP_DEFAULT + 1 : Math.min(n + 1, GROUP_MAX)))
  const groupDown = () =>
    setGroupSize((n) => (n == null ? GROUP_DEFAULT - 1 : n <= GROUP_MIN ? null : n - 1))
  const groupActivate = () => setGroupSize((n) => n ?? GROUP_DEFAULT)

  // the calendar stays open until you tap "these days ✓": pick as many as you
  // like. (nothing to sync per gesture in the create-on-submit model.)
  const handleDaysCommit = () => {}

  const createAndGo = async () => {
    if (!canCreate || busy) return
    setBusy(true)
    try {
      const input: CreateEventInput = {
        title: title.trim(),
        emoji,
        mode: mode!,
        tz,
        dates,
        slotMin: SLOT_MIN,
        groupSize,
      }
      let offered: TimeOption[] = []
      if (mode === 'slots') {
        // roll the painted cells up into offered blocks; the window rides along
        // (the server derives the canonical dates from the options themselves)
        offered = optionsFromPainted(painted, SLOT_MIN)
        input.options = offered
        input.startMin = startMin
        input.endMin = endMin
      } else {
        input.startMin = startMin
        input.endMin = endMin
      }
      const ev = await api.createEvent(input)
      if (pendingPhoto.current) {
        await api.uploadPhoto(ev.id, pendingPhoto.current).catch(() => {})
      }
      // slots + "these all work for me": mark the organizer in for every offered
      // block so they skip re-selecting. if we already know their name, persist
      // it now; otherwise hand the picks to the event page, which seeds them and
      // asks for a name (the dormant lockin:paint stash).
      if (mode === 'slots' && iAmInAll && offered.length > 0) {
        const mineKeys = offered.map(optionKey)
        const nm = savedName()
        if (nm) await api.saveMe(ev.id, nm, mineKeys).catch(() => {})
        else {
          try {
            sessionStorage.setItem(`lockin:paint:${ev.id}`, JSON.stringify(mineKeys))
          } catch {
            /* stash is best-effort */
          }
        }
      }
      const minted = await api.mint(ev.id).catch(() => ev)
      navigate(`/e/${minted.slug ?? ev.id}`)
    } catch (e) {
      console.error(e)
      setBusy(false)
    }
  }

  // the footer button is the single always-visible driver of the flow: it both
  // names and performs the next step, so the flow never dead-ends on a buried
  // control. slots steps through days -> window -> paint -> get the link here.
  let footerLabel: string
  let footerDisabled = false
  let footerTap: () => void = () => {}
  if (busy) {
    footerLabel = 'making it…'
    footerDisabled = true
  } else if (!hasTitle) {
    footerLabel = 'name your plan to start'
    footerDisabled = true
  } else if (mode == null) {
    footerLabel = 'pick a plan type'
    footerDisabled = true
  } else if (mode === 'slots') {
    if (!daysChosen) {
      if (dates.length === 0) {
        footerLabel = 'pick some days'
        footerDisabled = true
      } else {
        footerLabel = 'these days work →'
        footerTap = () => setEditingDays(false)
      }
    } else if (!slotsPainting) {
      footerLabel = 'next: paint the times →'
      footerTap = () => setSlotsPainting(true)
    } else if (painted.size === 0) {
      footerLabel = "paint the times you're offering"
      footerDisabled = true
    } else {
      footerLabel = 'get the link →'
      footerTap = createAndGo
    }
  } else if (canCreate) {
    footerLabel = 'get the link →'
    footerTap = createAndGo
  } else {
    footerLabel = 'pick some days'
    footerDisabled = true
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col overflow-hidden px-5" style={{ height: shellH }}>
      <style>{`
        .cmp-in::placeholder { color: var(--ink-faint); }
        .cmp-in:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        @keyframes cmp-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .cmp-rise { animation: cmp-rise 240ms cubic-bezier(0.22,1,0.36,1) both; }
        @keyframes cmp-pop { 0% { transform: scale(0.6); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
        .cmp-pop { animation: cmp-pop 220ms cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes cmp-phfade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
        .cmp-ph { animation: cmp-phfade 420ms ease-out; }
        @keyframes cmp-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
        .cmp-shake { animation: cmp-shake 380ms ease-in-out; }
        @keyframes cmp-emoji { 0% { opacity: 0; transform: scale(0.4) rotate(-12deg); } 60% { transform: scale(1.15) rotate(4deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
        .cmp-emoji { animation: cmp-emoji 300ms cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes cmp-chip-in { from { opacity: 0; transform: translateX(-8px) scale(0.9); } to { opacity: 1; transform: translateX(0) scale(1); } }
        .cmp-chip-in { animation: cmp-chip-in 260ms cubic-bezier(0.34,1.56,0.64,1) both; }
        @keyframes cmp-collapse { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .cmp-collapse { animation: cmp-collapse 220ms ease-out both; }
        @media (prefers-reduced-motion: reduce) { .cmp-rise, .cmp-pop, .cmp-ph, .cmp-shake, .cmp-emoji, .cmp-chip-in, .cmp-collapse { animation: none; } }
      `}</style>

      {mode === 'slots' && slotsPainting ? (
        /* condensed paint canvas: the answered setup collapses to one slim bar so
           the grid fills the screen (no cramped, scrolly box) */
        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-4">
          <button
            onClick={() => setSlotsPainting(false)}
            aria-label="edit setup"
            className="opt flex flex-none items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left"
          >
            <span className="text-lg leading-none">{emoji || '🗳️'}</span>
            <span className="min-w-0 truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {title.trim() || 'your plan'}
            </span>
            <span className="shrink-0 text-xs" style={{ color: 'var(--ink-soft)' }}>
              {dates.length} day{dates.length === 1 ? '' : 's'} ·{' '}
              {presetIdx >= 0 ? PRESETS[presetIdx].label : fmtRange(startMin, endMin)}
            </span>
            <span className="ml-auto shrink-0 text-[13px] font-semibold" style={{ color: 'var(--ink-faint)' }}>
              edit
            </span>
          </button>
          <div className="flex-none text-[15px] font-semibold">paint the times you're offering</div>
          <div className="flex min-h-0 flex-1 flex-col">
            <Grid event={paintGridEvent} others={[]} mySlots={painted} onStroke={(next) => setPainted(next)} denom={1} animateIn />
          </div>
          {/* the organizer is usually free for what they offer: one tap marks them
              in for all of it, so they don't re-select on the next page */}
          <div className="flex flex-none flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIAmInAll((v) => !v)}
                role="checkbox"
                aria-checked={iAmInAll}
                className="flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-left active:scale-[0.99]"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', transition: 'transform 120ms ease' }}
              >
                <span
                  className="flex h-5 w-5 flex-none items-center justify-center rounded-md text-[11px] font-bold"
                  style={
                    iAmInAll
                      ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                      : { background: 'var(--bg-sunken)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'transparent' }
                  }
                >
                  ✓
                </span>
                <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                  these times all work for me
                </span>
              </button>
              <button
                onClick={() => setWhyMineOpen((v) => !v)}
                aria-label="why is this a choice?"
                aria-expanded={whyMineOpen}
                className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink-soft)' }}
              >
                ?
              </button>
            </div>
            {whyMineOpen && (
              <p
                className="cmp-collapse rounded-xl px-3 py-2 text-[12px] leading-snug"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink-soft)' }}
              >
                You're setting these as the options for everyone. Leave it on if you can make them all and we'll count you in. Turn it off to pick your own on the next screen.
              </p>
            )}
          </div>
          <p className="flex-none text-center text-xs" style={{ color: 'var(--ink-faint)' }}>
            drag to offer a block, drag it again to remove. guests tap the ones that work.
          </p>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-2 pt-6">
        {/* 1. name it (required) */}
        <section className="flex flex-none flex-col gap-3">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">what's the plan?</h1>
          <div className={`flex items-stretch gap-2 ${titleError ? 'cmp-shake' : ''}`}>
            {/* the emoji chip pops out to the left once you start typing; tap it
                for the full picker (search + custom photo). auto-suggest fills it */}
            {hasTitle && (
              <button
                onClick={() => setPickerOpen(true)}
                aria-label="choose an emoji or photo"
                className="cmp-chip-in flex w-[52px] flex-none items-center justify-center overflow-hidden rounded-2xl border text-2xl active:scale-95"
                style={{ background: 'var(--bg-raised)', borderColor: 'var(--line)', transition: 'transform 120ms ease' }}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                ) : emoji ? (
                  // key on emoji so each new suggestion pops in
                  <span key={emoji} className="cmp-emoji">
                    {emoji}
                  </span>
                ) : (
                  // clearly an "add" affordance, not a suggested emoji
                  <span className="text-xl font-light" style={{ color: 'var(--ink-faint)' }}>
                    +
                  </span>
                )}
              </button>
            )}
            <div className="relative flex-1">
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (e.target.value.trim()) setTitleError(false)
                }}
                aria-label="name your plan"
                aria-invalid={titleError}
                maxLength={80}
                autoFocus={!coarse}
                className="cmp-in w-full rounded-2xl border px-4 py-3.5 outline-none"
                style={{
                  fontSize: 17,
                  background: 'var(--bg-raised)',
                  borderColor: titleError ? 'var(--accent)' : 'var(--line)',
                  boxShadow: titleError ? '0 0 0 3px var(--accent-soft)' : undefined,
                  color: 'var(--ink)',
                }}
              />
              {/* cycling seasonal placeholder, only while empty; keyed so each idea fades in */}
              {title === '' && (
                <span
                  key={placeholderIdea}
                  className="cmp-ph pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 truncate pr-4"
                  style={{ fontSize: 17, color: 'var(--ink-faint)', maxWidth: 'calc(100% - 2rem)' }}
                  aria-hidden
                >
                  {placeholderIdea}
                </span>
              )}
            </div>
          </div>
          {titleError && (
            <span className="cmp-rise text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
              give your plan a name first ↑
            </span>
          )}
        </section>

        {/* 2. specific times or all day? "specific times" fans out into a sub-choice */}
        {mode == null ? (
          <section className="flex flex-none flex-col gap-2">
            <div className="text-[15px] font-semibold">
              {timesOpen ? 'how should times work?' : 'what kind of plan?'}
            </div>
            {timesOpen ? (
              <div className="cmp-rise flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <ModeCard emoji="🖌️" title="everyone paints" sub="each marks their own free times" onClick={() => chooseMode('datetime')} />
                  <ModeCard emoji="🗳️" title="pick from times i set" sub="you propose, they choose" onClick={() => chooseMode('slots')} />
                </div>
                <button
                  onClick={() => setTimesOpen(false)}
                  className="self-start text-[13px] font-medium"
                  style={{ color: 'var(--ink-faint)' }}
                >
                  ‹ back
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <ModeCard emoji="⏰" title="specific times" sub="pick time windows (pizza at 7?)" onClick={openTimes} />
                <ModeCard emoji="📅" title="all day" sub="just which days work" onClick={() => chooseMode('date')} />
              </div>
            )}
          </section>
        ) : (
          <button
            onClick={() => {
              setMode(null)
              setTimesOpen(false)
              setSlotsPainting(false)
              setPainted(new Set())
            }}
            className="flex flex-none items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left text-sm font-semibold"
            style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink)' }}
          >
            <span>{MODE_CHIP[mode]}</span>
            <span className="ml-auto text-[13px] font-semibold" style={{ color: 'var(--ink-faint)' }}>
              change
            </span>
          </button>
        )}

        {/* 3. which days */}
        {mode != null &&
          (daysChosen ? (
            <button
              onClick={() => setEditingDays(true)}
              className="cmp-rise flex flex-none flex-wrap items-center gap-1.5 rounded-2xl px-3.5 py-2.5 text-left"
              style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
            >
              {dates.slice(0, 5).map((d) => {
                const dt = parseDate(d)
                return (
                  <span key={d} className="rounded-xl px-2.5 py-1 text-xs font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--ink)' }}>
                    {DOW[dt.getDay()]} {dt.getDate()}
                  </span>
                )
              })}
              {dates.length > 5 && (
                <span className="text-xs font-semibold" style={{ color: 'var(--ink-soft)' }}>
                  +{dates.length - 5} more
                </span>
              )}
              <span className="ml-auto text-[13px] font-semibold" style={{ color: 'var(--ink-faint)' }}>
                edit days
              </span>
            </button>
          ) : (
            <section className="cmp-rise flex flex-none flex-col gap-2">
              <div className="text-[15px] font-semibold">which days are in play?</div>
              <MonthStrip
                selected={selected}
                onChange={setSelected}
                onCommit={handleDaysCommit}
                onCapHit={() => setCapNote(true)}
                max={MAX_DAYS}
              />
              {capNote && (
                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  14 days max
                </span>
              )}
              {/* slots drives day-confirm from the always-visible footer instead,
                  so this buried button never strands the flow below a tall calendar */}
              {selected.size > 0 && mode !== 'slots' && (
                <button
                  onClick={() => setEditingDays(false)}
                  className="cmp-rise self-end rounded-full px-4 py-1.5 text-[13px] font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                >
                  these days ✓
                </button>
              )}
            </section>
          ))}

        {/* 4. when-ish: the offered-times window. datetime uses it as the paint
            range; slots uses it as the range the organizer paints blocks within.
            stays open (compact) so the slider is always there to fine-tune */}
        {(mode === 'datetime' || mode === 'slots') && daysChosen && (
          <section className="cmp-rise flex flex-none flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">when-ish?</span>
              {/* why this exists: tap to reveal, since hover tooltips don't work on touch */}
              <button
                onClick={() => setWhyOpen((v) => !v)}
                aria-label="why set a window?"
                aria-expanded={whyOpen}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink-soft)' }}
              >
                ?
              </button>
            </div>
            {whyOpen && (
              <p
                className="cmp-collapse rounded-xl px-3 py-2 text-[12px] leading-snug"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink-soft)' }}
              >
                Trims the grid to just these hours, so friends aren't scrolling past a whole empty day. Faster to fill in, easier to read.
              </p>
            )}
            {/* one row of quick-picks; each pre-positions the slider below */}
            <div className="grid grid-cols-4 gap-2">
              {PRESET_ORDER.map((pi) => {
                const p = PRESETS[pi]
                const on = startMin === p.start && endMin === p.end
                return (
                  <button
                    key={p.label}
                    onClick={() => {
                      setStartMin(p.start)
                      setEndMin(p.end)
                    }}
                    aria-pressed={on}
                    className="opt flex flex-col items-center gap-1 rounded-xl px-1 py-2"
                  >
                    <span className="text-lg leading-none">{p.emoji}</span>
                    <span
                      className="whitespace-nowrap text-[11px] font-semibold leading-none"
                      style={{ color: 'var(--ink)' }}
                    >
                      {p.label}
                    </span>
                  </button>
                )
              })}
            </div>
            {/* drag either end to fine-tune into a custom window */}
            <TimeRangeSlider
              startMin={startMin}
              endMin={endMin}
              onChange={(s, e) => {
                setStartMin(s)
                setEndMin(e)
              }}
            />
          </section>
        )}

        {/* 5. optional group size. the whole pill lights up (accent-soft) when
            on, so in-use vs not is unmistakable. +/- always move the number;
            tapping the label/number just adopts the default. floating "?" popover
            explains more and dismisses on any interaction elsewhere. */}
        {daysChosen && (
          <section
            className="cmp-rise relative flex flex-none items-center gap-3 rounded-2xl px-3.5 py-2.5"
            style={
              groupSize
                ? { background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1.5px var(--accent)', transition: 'background 160ms ease, box-shadow 160ms ease' }
                : { background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', transition: 'background 160ms ease, box-shadow 160ms ease' }
            }
          >
            {/* tap the label to switch it on at the default; +/- fine-tune */}
            <button onClick={groupActivate} className="flex min-w-0 flex-1 flex-col text-left">
              <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: groupSize ? 'var(--ink)' : 'var(--ink-soft)' }}>
                how many of you?
                <span
                  role="button"
                  aria-label="what is this?"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSizeInfoOpen((v) => !v)
                  }}
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink-soft)' }}
                >
                  ?
                </span>
              </span>
              <span className="text-[12px]" style={{ color: groupSize ? 'var(--accent)' : 'var(--ink-faint)' }}>
                {groupSize ? `${groupSize} of you · shows a live tally` : 'optional · sharpens the invite'}
              </span>
            </button>
            <div className="ml-auto flex flex-none items-center gap-1.5">
              <button
                onClick={groupDown}
                aria-label="fewer people"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none active:scale-90"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink)', transition: 'transform 120ms ease' }}
              >
                −
              </button>
              <span
                key={groupSize ?? 'off'}
                aria-live="polite"
                className={`w-7 text-center text-lg font-bold tabular-nums ${groupSize ? 'cmp-pop' : ''}`}
                style={{ color: groupSize ? 'var(--ink)' : 'var(--ink-faint)' }}
              >
                {groupSize ?? GROUP_DEFAULT}
              </span>
              <button
                onClick={groupUp}
                aria-label="more people"
                className="flex h-9 w-9 items-center justify-center rounded-full text-xl leading-none active:scale-90"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line)', color: 'var(--ink)', transition: 'transform 120ms ease' }}
              >
                +
              </button>
            </div>

            {sizeInfoOpen && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="cmp-collapse absolute left-0 right-0 top-full z-50 mt-2 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug"
                style={{ background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--line), var(--shadow-card)', color: 'var(--ink-soft)' }}
              >
                Set your headcount and everyone sees a running tally like "4 of 6 in", so it's obvious at a glance when enough people can make it. Leave it off if the guest list is open.
              </div>
            )}
          </section>
        )}

        {daysChosen && (mode === 'datetime' || mode === 'slots') && (
          <p className="flex-none text-xs" style={{ color: 'var(--ink-faint)' }}>
            times in {tzLabel}
          </p>
        )}
      </div>
      )}

      {/* footer: the single primary action, solid accent (nothing else is) */}
      <div className="flex-none pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button
          onClick={() => {
            if (footerDisabled || busy) return
            footerTap()
          }}
          disabled={footerDisabled || busy}
          className="w-full rounded-2xl py-3.5 text-center text-base font-bold transition active:scale-[0.99]"
          style={
            footerDisabled || busy
              ? { background: 'var(--bg-sunken)', color: 'var(--ink-faint)' }
              : { background: 'var(--accent)', color: 'var(--on-accent)', boxShadow: 'var(--shadow-card)' }
          }
        >
          {footerLabel}
        </button>
        {/* always reserve this line so the button never jumps when the hint
            appears (e.g. the moment the first offered block is painted) */}
        <p className="mt-1.5 min-h-[16px] text-center text-xs" style={{ color: 'var(--ink-faint)' }}>
          {canCreate &&
            (mode === 'slots'
              ? iAmInAll
                ? "we'll mark you in for all of these, then share"
                : "you'll mark which of these work for you next, then share"
              : mode === 'date'
                ? "you'll mark your days next, then share"
                : "you'll paint your own times next, then share")}
        </p>
      </div>

      {pickerOpen && (
        <EmojiPicker
          current={emoji}
          hasImage={!!photoPreview}
          onPick={pickEmoji}
          onPickImage={pickImage}
          onRemoveImage={removePhoto}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

function ModeCard({ emoji, title, sub, onClick }: { emoji: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="opt cmp-pop flex flex-col items-start gap-1 rounded-2xl p-3.5 text-left">
      <span className="text-2xl">{emoji}</span>
      <span className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
        {title}
      </span>
      <span className="text-xs leading-snug" style={{ color: 'var(--ink-soft)' }}>
        {sub}
      </span>
    </button>
  )
}
