# UX-SPEC.md: Hotspot v1

**Status:** Authoritative. Merges the friction, touch-grid, delight, and share-loop design docs into one implementable spec. Where the four docs conflicted, the conflict is stated in one line and resolved with rationale (marked **Conflict:**). Where two docs gave different incidental numbers for the same element, the touch-grid doc is the geometry authority and the delight doc is the color and motion authority; only substantive conflicts get Conflict lines.

**Stack (fixed):** React + Vite + Tailwind SPA, Hono server, SQLite, SSE, satori + resvg for OG images, single box behind a named Cloudflare tunnel. Served at meetup.sals.site.

**Style rule for all product copy and this document:** never use em dashes. Commas, colons, parentheses.

---

## 1. Product principles

1. **The link is the product.** The texted link, its preview card, and the page it opens are one continuous experience. Every share is a snapshot mint, not a live embed: iMessage bakes the preview at send time and never updates it, so the app engineers re-share moments and makes each one bake a fresh card.
2. **Every tap earns its place.** No submit buttons, no confirm dialogs, no edit modes. Everything autosaves. The tap budgets in section 2 are hard budgets: any future feature that adds a tap to those paths must remove one first.
3. **One live surface.** Your own paint overlays the group heatmap in the same cells at the same time. No You/Group tabs, no modes (the category's shared flaw, and the thing our SSE view exists to beat).
4. **Paint before naming.** The grid is touchable the instant the page loads. Identity costs one tap and one typed word, once per device, ever.
5. **Liveness must be honest.** Real connection state, real presence, never faked. Crab Fit's false "live" claim is a visible trust failure; we show a green dot only when the stream is actually open.
6. **Warm is heat, cool is people.** The heat ramp owns purple through orange through gold. Identity (presence chips, your paint ring) owns cyan through green through pink. The two never compete.
7. **Celebrate maximums, not motion.** Sparks fire only when the best possible outcome improves. No confetti, ever. Celebration stays scarce to stay meaningful.
8. **Motion is garnish; color, text, and counts are load-bearing.** Every meaning survives prefers-reduced-motion, and every "haptic" is visual (navigator.vibrate does not exist on iOS Safari through 26.x).
9. **Design for the platform's sharp edges.** Server-injected OG tags in the first KB of head, 200s with no redirects, no query strings on shared links, no UA gating, explicit Cache-Control on og.png, cookie-first identity, snapshot-first SSE, keyboard handled via visualViewport. These are not implementation details; they are the product working at all.

---

## 2. Flows with tap budgets

**Accounting rules.** A "tap" is one finger-down-finger-up on our UI. System taps (share sheet, Messages) are counted separately. A "stroke" is one continuous paint drag: strokes are cheap and fun. A "keystroke" is one keyboard character; the only sanctioned keyboard uses in the product are the event title (creator) and the display name (everyone, once per device).

### 2.1 Creator flow: landing to link-in-iMessage

**Budget: 5-6 taps in-app + ~12 title keystrokes + 2 strokes + 3 system taps. Wall-clock target: 20-28 seconds.**

Landing on meetup.sals.site shows a single composer. No marketing page (the marketing was the link card their friends saw). Layout, top to bottom:

1. **Title input.** Prompt "What's the plan?", placeholder "pizza night?". 17px font (16px minimum avoids iOS focus auto-zoom). Autofocused on desktop only; on mobile the first tap belongs to the user, and popping the keyboard on load would hide the calendar.
2. **Calendar multi-select.** A 5-week month strip starting today, today outlined. Tap toggles a day (filled pill, springy scale-in). Tap-drag paints a run of days with the same first-cell-decides gesture as the availability grid, teaching the core gesture in the first five seconds. Weeks advance by vertical scroll, no month arrows. Selected days float into an ordered chip row above the calendar ("Fri 12 · Sat 13 · Fri 19").
3. **Mode + window row.** Segmented control: **"Times"** (default) / **"All day"**. Next to it, the time window preset chip: default **"Evenings 5-11p"**; tap cycles presets (Morning 8a-12p, Afternoon 12-5p, Evenings 5-11p, All day 8a-11p); drag the two handles on the mini range bar for custom. In All day mode this row collapses to just the segmented control.
4. **"How many of you?" stepper (optional).** A quiet row of number chips 3 through 12, horizontally scrollable. One tap sets the expected group size; tapping the selected chip clears it. Default unset. This is the sole source of the "n of m in" denominator on OG cards, titles, and nudges; when unset, all copy degrades to count-only phrasing.
   - **Conflict:** the friction doc's composer has no group-size control, the share-loop doc requires one for denominators. **Resolution:** include it as one skippable row: skipping costs zero taps, and "4 of 7 in" is measurably better share copy than "4 in".
5. **Timezone caption.** Auto-set to the device zone, shown as a quiet caption ("times in ET"). Tappable to change; nobody taps it. This becomes the event's home timezone.

**No Create button.** The event record is created server-side on the first date tap with a temporary random slug. The readable slug is minted from the title at first share or first paint, whichever comes first (safe: nobody has the link yet). Slug format: lowercased hyphenated title trimmed to 24 characters + 4 characters of base32 without lookalikes (no 0/O/1/l), e.g. `meetup.sals.site/e/pizza-night-x7k2`. If the title is empty at mint time, words = "hang". Pure path, no query strings ever (iMessage has been reported to drop query strings, and the slug must read as an invitation in plain-text SMS).
   - **Conflict:** friction has no Create button (event assembles live), delight's copy inventory has a "get the link" create action, share-loop has a post-create launch strip. **Resolution:** no Create button; the composer and the event view are the same screen and the event assembles under the creator's fingers. The launch strip's content (visible slug, share, copy) merges into the "Send it" bar below.

**The grid materializes** the moment one date is selected, with a soft build-in animation, already interactive.

**The creator paints first (participant #1 by design).** 1-3 strokes, no name prompt on a known device. Why it is worth the strokes: the link never opens onto an empty grid, the OG snapshot minted seconds later shows real heat ("1 in" beats an empty card), and hotspot framing exists immediately. We nudge, never gate: above the grid pre-paint, a ghost-stroke animation runs with the line "**Paint yours first.** Your times ride along in the invite card." Share works immediately regardless.

**The share moment.** Two affordances, one behavior:
- A quiet share pill top-right of the header from the moment the event exists.
- After the creator's first stroke ends, the bottom bar morphs into a glowing **"Send it"** bar: subtle pulse, the short link printed on it in mono type. Not a submit button (everything is already saved); it is the payoff button. After first stroke autosave, it pulses once with "invite card updated" microcopy beneath for 4s.

Tapping either calls `navigator.share({ title: eventTitle, url })`, **title and url only, never a text field** (verified: passing text makes the iOS share sheet's Copy action copy the text instead of the URL). Feature-detect; fall back to copy-to-clipboard with toast "copied. go paste it somewhere fun." A third option in the share sheet's overflow, "Copy invite text", copies:

```
{title}
Paint the times you can make (20 sec, no signup):
https://meetup.sals.site/e/{slug}
```

The URL is always last with nothing after it (green-bubble SMS shows Tap to Load Preview only when the URL ends the message). After first share or dismissal, the bar reverts to the standard bottom bar (section 3).

**Creator tap ledger**

| Step | Cost |
|---|---|
| Tap title, type "pizza night?" | 1 tap + 12 keys |
| Tap 3 candidate dates | 3 taps |
| Mode, window, group size (defaults) | 0 |
| Paint own availability | 2 strokes |
| Tap "Send it" | 1 tap |
| Share sheet: Messages, thread, send | 3 system taps |
| **Total in-app** | **5 taps, 2 strokes, ~12 keys** |

### 2.2 First-time respondent: iMessage tap to availability saved

**Budget: 1 system tap + 1-3 strokes + 1 tap + name keystrokes. Zero taps before seeing the live event.**

The link opens directly into the live event view. No splash, no interstitial, no form, no join screen. The server-rendered shell paints title and grid skeleton instantly; the SSE connection's first event is a full state snapshot. Within one second the respondent sees the title, the group heatmap with real paint, hotspot chips, and live presence.

**Painting before naming.** The grid is immediately paintable. Strokes autosave on pointerup keyed to the device UUID; nothing is ever lost even if they never type a name. Until a name exists, the participant counts in the heatmap immediately and appears in presence as a dashed ghost chip ("someone's peeking" in the popover). The group chat supplies the naming pressure ("who just picked Tuesday??").
   - **Conflict:** friction counts anonymous strokes in the group heat immediately, touch-grid queues saves until a name exists. **Resolution:** save and count immediately. Queuing risks data loss on tab close and contradicts autosave-everything; an anonymous blob painting live is charming and self-correcting.

**The name chip.** A pill in the bottom bar reads "add your name" and begins a soft pulse only after the first stroke ends (the only correct moment to ask: after they have something on the board worth signing). Tapping expands an inline input (17px font). While focused, the rest of the bottom bar hides and the input pins above the keyboard via the visualViewport API (no CSS viewport unit reacts to the iOS keyboard). Return or blur commits: chip becomes "you: Maya", presence hatches their ghost chip into their color, attribution is live for everyone. No confirm button.
   - **Conflict:** friction puts the name prompt in the bottom bar, touch-grid and delight put it above the grid. **Resolution:** bottom bar. An above-grid field shifts the grid down mid-session and competes with the hotspot row; the bottom bar slot is reserved, stable, and adjacent to the thumb.

**Respondent tap ledger**

| Step | Cost |
|---|---|
| Tap link in iMessage | 1 system tap |
| See live event | 0 |
| Paint availability | 2 strokes |
| Tap name chip, type "Maya", return | 1 tap + ~5 keys |
| **Total in-app** | **1 tap, 2 strokes, one name** |

### 2.3 Returning respondent

**Budget: 1 system tap + strokes. Zero keystrokes, zero identity taps.**

The device cookie identifies them. The bottom chip already reads "you: Maya". Their own overlay renders immediately if they painted before; any stroke edits it directly (paint over own cells erases, first-cell-decides). No edit mode: availability is live, editable state, always. On a new event, they paint and are attributed instantly. Renaming: tap the "you: Maya" chip; the edit propagates live to all viewers and to all past events on this device (one server-side name record, not per-event copies).

On return to an active event, if state changed since last visit: one auto-dismissing toast, "2 new since you were here: Maya, Jules", with changed cells shimmering once, staggered over 600ms. If the top hotspot changed, a second line: "Fri 7 to 9pm took the lead." No badges, no unread counters.

### 2.4 Identity model

- **Device ID:** UUID issued and re-issued as a first-party HTTP cookie, Max-Age ~400 days, on every response from meetup.sals.site itself, never from an api subdomain (Safari ITP wipes localStorage after 7 days without interaction; first-party server-set cookies from the exact host are exempt). localStorage holds a copy purely as a fast-path cache; the cookie is the truth.
- **Person record (server):** device_id -> { display_name }. Global, one per device.
- **Participant record (server):** (event_id, participant_id) -> { name, cells }, with a link table participant_id <-> device_id supporting many devices per participant. A device with no name gets an anonymous participant, upgraded in place when the name arrives. No passwords anywhere: device identity covers edit rights at friend-group stakes.
- **Name collision, "is that you?" soft claim.** When a typed name matches an existing participant in this event (case-insensitive, trimmed), inline under the input, not a modal: "Sam already marked 4 times here. That you?" with chips "Yep, that's me" and "Different Sam". Yep links this device to the existing participant (this is also the second-device flow and the lost-cookie recovery flow, one mechanism). Different Sam prompts "add a last initial so the group can tell you apart" (pre-filled "Sam R"). The claim is deliberately soft (the attacker is your friend Dave, self-policing in the thread), and the claim broadcasts on SSE ("Sam joined from a new device") so impersonation is at least visible.

### 2.5 Budget summary (hard budgets)

| Flow | Taps | Strokes | Keystrokes |
|---|---|---|---|
| Creator (create to link in thread) | 5 in-app + 3 system | 2 | title (~12) |
| First-time respondent | 1 system + 1 | 2 | name (~5) |
| Returning respondent, new event | 1 system | 1-2 | 0 |
| Returning respondent, editing | 1 system | 1 | 0 |
| Second-device claim | 1 system + 2 | 0 | name (~5) |

---

## 3. Event screen anatomy (iPhone 15 portrait, 393 x 852, ~660px usable)

Above-the-fold order, top to bottom. Nothing else is above the fold: not instructions (the visible paint is the instruction), not branding beyond the flame mark (the brand's job was done by the link card).

1. **Header row (56px).** Left: event title in Bricolage Grotesque display type, with the small flame meter beside it (fills with response ratio) and the response count caption ("4 in", or "4 of 7 in" when expected size is set). A 6px save-state dot next to the title: accent while dirty or in flight, ink-300 when synced; never a success toast. Right: the presence rail (section 6) and the connection dot.
   - **Conflict:** friction specifies a dedicated 28px presence strip below the hotspot row, delight puts presence chips in the header. **Resolution:** header rail. It saves 28px of fold for the grid, presence is still visible before the user decides to engage, and the status line below covers the textual signals.
2. **Hotspot chip row (48px, horizontally scrollable, scroll-safe).** Ranked merged windows, "Fri 7-9pm · 5 of 6", gold treatment for everyone-can-make-it, creator nudge chip at the end when triggered (section 9.5). Answers outrank data; this row sits above the grid.
3. **Status line (24px, one slot).** Default content: the timezone note when the viewer's zone differs from the event's home zone: "shown in your time (Central). made in Eastern. [show in Eastern]" with one-tap toggle (Crab Fit's proven quiet pattern; no modal). Transient messages temporarily replace it, most recent wins, then it returns: "Maya is painting...", "reconnecting...", "back live. caught you up.", "first overlap. Fri 7-9pm works for both of you.", "couldn't save that stroke. it'll retry."
4. **The grid panel (fold-filler, max-height: calc(100dvh - 216px - env(safe-area-inset-bottom))).** Full spec in section 4. Sticky day headers, sticky time gutter, group heat as fill, own selection as ring overlay.
5. **Below the fold, normal page flow:** legend (section 5.6), roster (name chips for person isolate), first-visit hint line.
6. **Bottom bar (64px + safe-area inset, fixed).** Left: name chip ("you: Maya" or pulsing "add your name"). Right: share ("Send it" glow bar state for the creator pre-first-share, then icon + "Share" for everyone; respondent sheet is Share + Copy link). The bar and html/body carry the explicit bg color (Safari 26 samples fixed-edge element backgrounds for chrome tinting; overlays are hidden with display:none, never opacity). The bar hides while the name input is focused.

---

## 4. Grid interaction spec

### 4.1 Axes and geometry (datetime mode)

Days as columns, times as rows (time has the most values; vertical hotspot capsules are the natural merged-window shape; matches category muscle memory).

| Element | Size (CSS px) | Notes |
|---|---|---|
| Page side margins | 16 | Scroll-safe (default touch-action) |
| Time gutter (sticky left) | 44 wide | Primary vertical scroll rail, `touch-action: pan-y` |
| Day header row (sticky top) | 48 tall | Scroll-safe, drags horizontally |
| Day column width, <= 4 days | `clamp(64, floor(available / days), 96)` | All columns fit, no horizontal scroll |
| Day column width, 5+ days | 76 fixed | Horizontal scroll with a 13px peeking partial column |
| Slot row height | 44 default; 36 if > 20 rows; 32 floor if > 28 rows | Never below 32 (When2Meet's 9px rows are the anti-pattern) |
| Cell visual chip | full tract minus 2px inset each side, radius 6 | Hit area is the full tract, zero gaps; gaps are purely visual |
| Hour hairline | 1px, ink at 10%, hour boundaries only | Half hours implied by two chips per hour |
| Hour labels | 11px, ink-500, right-aligned 6px from gutter edge | Hours only ("7 PM"), never half hours |

Worked example, iPhone 15: 393 minus 32 margins minus 44 gutter = 317 for columns; 4 days at 79px all visible; 5+ days at 76px show 4 full plus a 13px peek. Default granularity 30 minutes; if the daily window is 14+ hours, the event defaults to 60-minute slots.

### 4.2 Scroll architecture: one frozen-panes scroller

```
<section class="grid-panel">   overflow:auto both axes,
                               max-height: calc(100dvh - 216px - env(safe-area-inset-bottom)),
                               overscroll-behavior: contain,
                               scroll-snap-type: x proximity
  <div class="corner">         sticky top:0 left:0, z 3, solid bg
  <div class="day-header">     sticky top:0, z 2, solid bg
  <div class="time-gutter">    sticky left:0, z 2, solid bg, touch-action: pan-y
  <div class="cells">          touch-action: none
```

Sticky header and gutter get fully opaque backgrounds matching the html background (Safari 26 chrome tinting). Columns get `scroll-snap-align: start` with `scroll-margin-left: 44px`; proximity, not mandatory, so mid-stroke autoscroll is never fought by snap. Roster, legend, and share content sit below the panel in normal flow. Fallback if nested scrolling tests badly on device: drop internal vertical scroll, page-scroll vertically, fake the sticky day header with a rAF translateY. Build frozen-panes first.

**Scroll-safe zones (non-negotiable map):** time gutter (vertical rail), day header (horizontal rail), page margins and everything above and below the panel, and two-finger pan anywhere (4.6). The grid is never the only touchable surface; gestures starting off-grid always scroll normally.

### 4.3 Day overflow: peek, snap, scrubber

With 5-14 candidate days: 13px column peek plus a 24px edge fade gradient. Directly under the day header, the **day scrubber**: a 6px strip, one segment per day, each filled with that day's peak heat color (a mini-map of the whole event). It lives in the sticky header block; dragging scrubs scrollLeft proportionally, tapping a segment animates to that day. Day header cells: weekday 11px 600 caps tracked 0.08em ink-500, date number 17px 700 ink-900, and a 4px accent dot underneath when I have painted that day. Timezone day shift: when conversion crosses the viewer's local midnight, the header adds a 9px microline "Fri 12 into Sat 13"; the gutter always shows the viewer's local times.

### 4.4 Hit testing and stroke machine

All input runs through pointer events on `.cells`, never per-cell listeners (iOS implicit pointer capture pins pointermove to the pointerdown element; per-cell pointerenter is dead). Geometry math per pointermove:

```js
const col = clamp(Math.floor((e.clientX - rect.left + panel.scrollLeft - GUTTER_W) / colW), 0, days - 1);
const row = clamp(Math.floor((e.clientY - rect.top  + panel.scrollTop  - HEADER_H) / rowH), 0, rows - 1);
```

`rect` cached at pointerdown, invalidated on resize. Clamping forgives edge drift (a finger past the last column keeps painting the edge cell). Track a single pointerId; ignore pointerdown while a stroke is active; ignore non-primary mouse buttons.

**States: idle -> stroking -> idle, with commit or revert on exit.**

1. **pointerdown on cells:** record anchor cell; mode = ERASE if the anchor cell is in my selection, else PAINT (first-cell-decides, the exact muscle memory of When2Meet, Crab Fit, and Timeful). setPointerCapture (explicit covers mouse and pen).
2. **pointermove:** recompute current cell; marquee = rectangle rows [min..max] x cols [min..max] between anchor and current; live preview, one rAF-coalesced update per frame. Cells that fall out of the marquee as the finger backtracks revert instantly (shrinking the box is the overshoot eraser). A 1.5px accent outline traces the marquee's union rect.
3. **pointerup:** commit the marquee with the stroke's single operation (a stroke never toggles per cell). Autosave fires (4.8).
4. **pointercancel:** Safari stole the gesture for a scroll. **Revert the preview, commit nothing.** Any pointercancel in QA is a defect to chase.
   - **Conflict:** touch-grid reverts on pointercancel, delight commits the partial stroke. **Resolution:** revert. A pointercancel means the user's gesture was claimed as a scroll; committing a smear the user meant as a scroll is worse than losing a stroke they can redo in one second.

A stroke whose pointer never leaves the anchor cell is a tap: single-cell toggle, no dead-zone threshold needed.

### 4.5 Scroll coexistence: the layered defense

```css
.cells, .cells * {
  touch-action: none;
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
```

```js
panel.addEventListener('touchmove', (e) => {
  if (strokeActive && e.touches.length === 1) e.preventDefault();
}, { passive: false });
```

touch-action must be in stylesheet CSS before any touch starts. The non-passive preventDefault while a stroke is active also suppresses pull-to-refresh and rubber-band for grid-origin gestures.

### 4.6 Multi-finger: never capture, actively help

Second touchstart while stroking: revert the in-flight marquee (do not commit), end the stroke, enter manual-pan mode: follow the two-touch midpoint delta into scrollLeft/scrollTop each frame until fewer than two touches remain. No momentum required. One finger always paints, two fingers always scroll, from anywhere. This avoids both the When2Meet/Crab Fit scroll trap and Timeful's edit-mode toggle.

### 4.7 Edge autoscroll and forgiveness

- Pointer within 48px of the panel's top/bottom inner edge: scroll scrollTop up to 12px/frame proportional to proximity; within 40px of left/right edges: scrollLeft up to 8px/frame. Hit testing already incorporates scroll offsets.
- **Undo chip:** after each committed stroke, a 32px pill ("Undo", counterclockwise glyph) fades in bottom-center above the safe area for 4s. Tap reverts the last stroke; stack depth 10 per session. Desktop: Cmd/Ctrl+Z. No confirm dialogs anywhere.

### 4.8 Autosave (no submit anywhere)

Commit applies optimistically to local state and the local heatmap instantly. A debounced flush (250ms, coalescing rapid strokes) POSTs the participant's full slot bitmap (idempotent, tiny, no delta bookkeeping to corrupt). Failure: keep local state, status line shows "couldn't save that stroke. it'll retry.", retry with backoff; rollback only on outright server rejection. Save-state dot per section 3.

### 4.9 Paint feedback (all visual; no haptics)

Painted cell: chip scales 0.85 to 1.0 over 120ms ease-out while the fill sweeps in; marquee cells stagger 12ms in stroke direction (a rhythm-game sweep). Erased: fill fades 90ms, ring collapses inward 90ms. A soft radial finger glow trails the pointer at ~80ms lag inside the grid. The iOS checkbox-switch haptic trick is wired behind a capability probe as a silent no-op enhancement only (patched in iOS 26.5); it never carries meaning visuals do not. Reduced motion: instant state swaps, zero transforms, zero stagger, no glow trail.

### 4.10 Per-cell inspection

Cells cannot host tap-to-inspect (taps paint). Name lists live in the hotspot chip popover (second tap on a chip, section 5.5), the 20+ bottom sheet (section 10.4), and desktop hover tooltips (4.12).
   - **Conflict:** delight specifies long-press on a cell for a "4 of 6: Maya, Sal, Dee, Jo" bubble, touch-grid says cells cannot host inspection. **Resolution:** no cell long-press. It races the tap-toggle timer, fights callout suppression, and duplicates the chip popover; one inspection surface is enough on touch.

### 4.11 Date-only mode

Same engine, calendar clothes. Weekday-aligned 7-column grid, Monday through Sunday headers (11px caps, sticky top). Tile size `(containerW - 24) / 7`, minimum 44px square; with 5 or fewer candidate days rows collapse and tiles grow to 64px, centered. Month label rows (24px, scroll-safe) separate months. Candidate tiles are live paint surfaces with touch-action none; non-candidate days render at 25% opacity, inert, default touch-action, so every dead tile is a scroll rail (the calendar is naturally scroll-safe without a gutter). Identical stroke machine; marquee over 7-column geometry skips inert tiles; same undo, same autosave. Per tile: date number 17px 700 centered, heat fill and my ring identical to datetime mode, count numeral "4/6" at 10px bottom-center when count > 0. Chips: "Sat Jun 13 · 5 of 6", ranked by count desc then earliest (no duration factor).

### 4.12 Desktop, keyboard, VoiceOver, reduced motion, extremes

- **Desktop:** grid max width 960px centered; rows 36px; columns min 88px growing to fill; 10+ days scroll horizontally with sticky gutter, shift-wheel, header drag, hover edge arrows. Same marquee on mouse drag; Escape reverts mid-stroke. Hover (350ms delay): "Fri Jun 12, 7:00 to 7:30 PM. 4 of 6: Alex, Sam, Rio, you. Missing: Kay, Jo." Hovering a hotspot chip highlights its window.
- **Keyboard:** roving tabindex, one tab stop for the grid. Arrows move focus (2px focus ring, never suppressed), Space toggles, Shift+Arrows grows a box from the anchor, Enter applies (add if anchor was empty, erase if filled), Escape clears, Cmd/Ctrl+Z undoes.
- **VoiceOver:** container role="grid" with aria-rowcount/colcount; day headers and gutter labels as row/column headers. Each cell role="checkbox" gridcell, aria-checked for my state, label "7:00 to 7:30 PM, Friday June 12. 4 of 6 available. You are available." Every cell individually toggleable, so drag is never required. Stroke commits announce politely: "Added Friday 7:00 to 9:00 PM. Saved." Remote changes do not announce; chip ranking changes announce at most once per 30s: "New best time: Friday 7 to 9 PM, 5 of 6."
- **Reduced motion:** every animation in this spec has a named reduced variant; none carries unique information.
- **Landscape phone:** same orientation, rows compress to 36px, 6-7 columns fit. No special mode.
- **Extremes:** 1 day: single column capped at 320px wide, centered, chips still rank windows within the day. 14 days (v1 cap): scrubber becomes the primary navigator. N=1: heat renders my cells at the t=1 fill so the map never looks dead; legend reads "just you so far"; unanimous glow and crown suppressed until N >= 2 (never crown a party of one).

### 4.13 Implementation and performance

Cells are plain absolutely-positioned divs (max 14 x 34 = 476 cells; no canvas needed below the 20+ participant adaptation). Stroke-time updates are class and CSS-custom-property swaps batched in one rAF; no layout reads during pointermove except the cached rect. SSE deltas batch-apply once per frame and are deferred entirely while strokeActive (the grid never reflows under a finger). Budgets: pointermove handler under 1ms, stroke frame under 4ms on an iPhone 12.

**On-device QA checklist (day one, through the real named tunnel):** (1) one-finger drag on cells paints, never scrolls, zero pointercancels; (2) one-finger drag on gutter/header/margins/dead tiles scrolls, never paints; (3) two-finger drag on cells pans and reverts the stroke; (4) no pull-to-refresh from a stroke at scrollTop 0; (5) long-press produces no callout, loupe, or gray flash; (6) marquee autoscrolls at edges with correct hit testing; (7) name focus does not zoom (16px+) or break layout; (8) rotate mid-stroke reverts cleanly and invalidates geometry; (9) VoiceOver toggles any cell and hears count plus own state; (10) prefers-reduced-motion renders zero animation.

---

## 5. Heatmap and hotspot spec

### 5.1 The two layers

Group count is the cell's background fill; my membership is a **2px inset ring in you-cyan (#22D3EE) with a 1px bg-color separation gap**, drawn at the chip's 6px radius, plus a small corner tick. Mine is encoded in shape, count in color: the channels never compete and both survive color-vision deficiency. My cells contribute to the fill optimistically, so painting visibly heats the map in real time (the dopamine loop). Rejected alternatives: You/Group tabs (forfeits the differentiator), split cells (mud at 36px), fully blended (cannot confidently erase).
   - **Conflict:** touch-grid draws the ring in ink-900 with white separation, delight draws it in you-cyan. **Resolution:** you-cyan. On the After Dark theme an ink ring disappears against dark cells, and cyan honors the warm-heat/cool-people color law; keep touch-grid's double-contrast construction (ring plus separation gap).

Supporting interactions:
- **Me-peek:** press and hold the "You" legend chip (below the grid, scroll-safe) to dim group heat to 20% and show only my ringed cells at full strength; release snaps back.
- **Person isolate:** tap a name chip in the roster to isolate that person (their cells filled in their name color at 80%, everything else dimmed to 25%); tap again or elsewhere to clear.
   - **Conflict:** delight designs multi-select subset intersection heat ("when can just us 4 meet"), touch-grid ships single-person isolate only in v1. **Resolution:** single isolate in v1 (same renderer as me-peek, nearly free); multi-person subsets go to the cutlist to protect scope for liveness and OG.

### 5.2 Heat ramp: absolute 0..N, inferno-inspired

R = number of participants who have painted (named or not). Never min-max normalized (When2Meet's white-does-not-mean-zero trap). Perceptually ordered by lightness so lightness carries the signal under CVD.

| t = count/R | Fill | Reads as |
|---|---|---|
| 0 | transparent, 1px stroke #2A2440 | empty, unmistakably zero |
| 0.17 | #3B1668 | first ember |
| 0.33 | #6E1E79 | warming |
| 0.50 | #A62E60 | half the group |
| 0.67 | #D9533B | hot |
| 0.83 | #F08A1D | very hot |
| < 1.0 max | #F6C445 | near-consensus |
| exactly 1.0 | #FFE9A8 gold + breathing glow | everyone |

Interpolate along the stops at position t^0.85 (in OKLCH), lifting low counts so 1-of-12 stays visible at large R while the top end stays saturated. Small groups land on cleanly separated quantized steps. Any numeral drawn on a cell switches to white at t >= 0.55, ink-900 below.
   - **Conflict:** touch-grid computes fill as a two-color OKLCH mix with a 0.85 exponent, delight specifies a multi-stop inferno ramp. **Resolution:** delight's ramp (it is the brand hero and reads richer), with touch-grid's 0.85 exponent folded in as the interpolation position. Exact numbers live in chips and captions, not in color decoding.

### 5.3 Unanimous treatment

Cells at count == R (R >= 2) get the gold fill plus a 1px inner white glow and a slow 3s breathing loop that persists while consensus holds. Consecutive unanimous slots in a column merge render-only into one continuous capsule (internal gaps removed): "everyone can do Friday 7 to 9" reads as one solid shape. Hit areas unchanged.

### 5.4 The crown

Exactly one crowned window at a time: the #1 ranked hotspot gets a slow 2s shimmer sweep across its capsule and a 10px flame glyph at its top-right corner. Reduced motion: static 1px gold outer ring instead. Merely-good cells get nothing beyond their heat.

### 5.5 Hotspot chips

Ranked chips in the 48px row above the grid (scroll-safe). Chip anatomy: rounded pill on surface-raised; left, a small flame mark filled to that window's count/R; center, the window in display type ("Fri 7-9pm"; date mode "Sat Oct 12"); right, the count "5 of 6" in tabular numerals.

**Algorithm.** Recompute debounced 600ms after each committed stroke or applied SSE delta: per-slot counts; M = max count; ranked chips require M >= 2; collect contiguous same-day runs at count M; in datetime mode discard windows shorter than 60 minutes unless nothing longer exists; rank by count desc, then run length desc, then earliest start; show top 3. Ties at the same M show multiple chips with a "two-way tie" sub-label.
   - **Conflict:** friction shows a hotspot chip at one participant ("Fri 7-9p · you so far"), delight requires M >= 2. **Resolution:** both: at R = 1 the row shows a single unranked chip "Fri 7-9p · just you so far" (no crown, no celebration) to frame the mechanic; ranked hotspots proper begin at M >= 2.

**Behavior.** First tap scrolls the panel to the window (smooth 350ms; instant under reduced motion) and pulses its outline twice. Second tap opens a small popover: who is in, who is missing. This popover is where per-cell name lists live on touch.

### 5.6 Legend

Below the grid: a segmented bar 0 to R with tick labels "0" and "all N", plus the "You" chip (me-peek trigger). R <= 6: discrete segments; above 6: continuous gradient with endpoint labels. Gradient pill labeled "nobody" to "everyone".

### 5.7 Celebrations (exactly three triggers, nothing else)

**a) First overlap (M reaches 2).** The chip row animates in for the first time with a spring settle. Status line: "first overlap. Fri 7-9pm works for both of you."

**b) M increases.** 1.3s sequence: winning window blooms (radial glow expanding from center, 700ms, once); 3-5 ember sparks (3px glowing dots) rise 40px toward the chip row with slight wander, fading (600ms); the chip's count rolls like an odometer (digits translate vertically, 300ms) with a 500ms shine sweep; a "new best" micro-tag holds 4s. If the top window merely shifts at the same M, only the quiet crossfade plus odometer roll: no bloom, no sparks. Rate limit: one spark sequence per 30s max; repeats within a minute render at 60% intensity.

**c) Full consensus (M == R, R >= 2).** Winning cells switch to the persistent gold breathing treatment; a single golden pulse sweeps the chip row once (800ms); the chip's flame fills completely with sub-line "everyone"; status line "that's everyone. Fri 7-9pm works for all 6." Fires once per window identity per session. No confetti, no modal, no sound.

### 5.8 Live-change garnish

When SSE applies someone else's stroke: affected cells play an attribution shimmer, a glint sweep in the painter's name color crossing each cell diagonally (450ms), staggered 12ms per cell capped at 400ms total, over a 200ms linear heat crossfade; the painter's presence chip pulses once in sync. Strokes arriving within 2s of each other coalesce into one batched sweep. Reduced motion: heat crossfade only. Presence hues color glints, dots, and chips only, never resting cell fills.

---

## 6. Presence and liveness spec

### 6.1 SSE lifecycle (the substrate)

- Presence is derived entirely from open SSE connections; each carries device ID plus display name if known.
- The server's first event on every connection is a **full state snapshot** (cells, counts, roster, stateVersion). No delta replay dependency: iOS Safari drops EventSource on background/lock without firing onerror and readyState can stay OPEN, so built-in reconnect never triggers.
- Client: reconnect unconditionally on visibilitychange-to-visible, plus a 45s heartbeat watchdog.
- Server: heartbeat comment every 20s (inside Cloudflare's ~100-125s idle window), Content-Type text/event-stream with no charset and no compression, flush per event, first bytes immediately on connect. Smoke-test streaming through the real named tunnel on day one (Quick Tunnels have a live SSE-buffering bug).
- Presence expiry on failed heartbeat writes (30-60s lag is the accepted floor, masked with a gentle fade); sendBeacon "leaving" on visibilitychange-hidden for snappier exits.
- Leaves are always quiet and unlabeled (a delayed "Maya left" would read as wrong).

### 6.2 Presence rail (header, right)

- **Chip anatomy:** 28px circle; background is the person's name color at 20% over surface; 1.5px solid ring in the name color; 1-2 character initials, 11px, 600, in full-strength name color. No profile pictures anywhere, ever.
- **Your chip:** always first, 30px, solid name-color fill with initials in bg color.
- **Overflow:** max 5 chips, then "+3" in secondary text. Tapping the rail opens the "here now" popover: full names with state labels (painting / looking / idle), ghosts listed as "someone's peeking".
- **Ghost chips:** connected viewers with no name render as dashed-ring gray chips, gently pulsing (opacity 0.5 to 0.8, 2.4s loop).
- Past 8 concurrent viewers, the rail collapses to "12 here now" with active painters still called out individually (watching specific people paint is the show).

### 6.3 Name colors

Eight cool-to-neutral colors (warm range is reserved for heat), ordered so adjacent indices differ in hue and lightness; initials carry identity, color reinforces: 1 Green #4ADE80, 2 Sky #60A5FA, 3 Pink #F472B6, 4 Silver #E2E8F0, 5 Lavender #C084FC, 6 Periwinkle #818CF8, 7 Rose #FB7185, 8 Teal #2DD4BF. Assignment: FNV-1a hash of device ID mod 8; linear-probe on collision within the event roster; stored server-side at first paint so a color never shifts mid-event. Beyond 8, colors repeat; the popover disambiguates. You-cyan #22D3EE is permanently excluded.

### 6.4 Presence states and moments

- **Join:** chip enters with a spring pop (scale 0 to 1.06 to 1, 280ms) with its full name label expanded ("Maya" pill), holds 1.8s, collapses to initials (240ms width transition). The chip is the announcement; no toast layer.
- **Ghost hatch:** when an unnamed viewer names themselves, the ghost morphs in place: dashed ring sweeps solid, color floods, initials fade up (350ms). One of the best small moments in the app.
- **Painting:** on stroke start the client sends one throttled POST (max 1 per 2s); cleared on stroke end + 1.5s quiet. The painter's ring becomes a dashed ring rotating slowly (1.2s linear) and the status line reads "Maya is painting..." (one line, most recent painter wins, fades 3s after strokes stop).
- **Idle:** 90s without activity desaturates the chip to 40% and drops its ring; recovers instantly.
- **Leave:** fade + scale to 0.8, 200ms.

### 6.5 Connection honesty

A small dot beside the rail: solid green with a 2s breathing pulse when live; amber blink while reconnecting (status line "reconnecting..." then "back live. caught you up." on snapshot); offline beyond a few seconds shows the quiet banner "you're offline. your paints are queued."

### 6.6 stateVersion (one integer drives all freshness)

Every state mutation bumps a per-event stateVersion. It simultaneously: invalidates the memoized og.png, changes the ?v= cache-buster on og:image (refreshing Discord/Slack unfurls), and feeds the per-device return-visit diff ("2 new since you were here"). lastSeenStateVersion is stored server-side per (eventId, deviceId).

---

## 7. Visual system: "After Dark"

Dark-first; v1 ships dark only (light "paper lantern" mode is in the cutlist). The look: plans being made at night. Near-black indigo, glowing ember heat, cool neon people-colors, chunky warm type. Game lobby, not calendar software.

### 7.1 Tokens

| Token | Value | Notes |
|---|---|---|
| bg | #0E0B16 | set explicitly on html and body (Safari 26 samples edge-element backgrounds, falls back to root) |
| surface | #171225 | cards, bottom bar |
| surface-raised | #201A33 | sheets, popovers, chips |
| text / text-secondary | #F2EFFA / #9B93B3 | |
| ink-500 / ink-900 | mid and strong neutrals on bg | gutter labels / date numbers |
| you-cyan | #22D3EE | your ring, your caret; never a name color |
| heat ramp | section 5.2 stops | absolute 0..N |
| gold (consensus) | #FFE9A8 | white-hot fill at count == N |
| motion-pop | cubic-bezier(0.34, 1.56, 0.64, 1) | springy overshoot |
| motion-glide | cubic-bezier(0.22, 1, 0.36, 1) | fades, slides, crossfades |

Ship theme-color meta for pre-26 Safari and Android; rely on explicit backgrounds and opaque fixed bars for Safari 26; hide overlays with display:none, never opacity (fixed elements tint chrome even at opacity 0).

### 7.2 Typography

- **Display:** Bricolage Grotesque (variable, latin subset, ~30KB woff2, preloaded, self-hosted; weights 500-800): event title, hotspot chip windows, big counts, OG card.
- **UI/body:** system stack (-apple-system, ui-rounded where available).
- font-variant-numeric: tabular-nums on every count (odometer rolls must not jitter).
- Sentence case everywhere; 11px caps with letterspacing only on tiny labels.

### 7.3 Signature element: the flame meter

A rounded flame glyph that fills bottom-up with the ember ramp in proportion to responses. Three sizes: small beside the event title, medium on each hotspot chip (filled to that window's count/R), large on the OG card. The static full-lit flame on bg is the favicon and the 180x180 apple-touch-icon, so even degraded link cards look branded (TN3156 fallback card). The OG card reuses the exact app tokens so tapping the card into the live app feels like the card waking up.

### 7.4 Grid construction

Cells radius 6, 2px visual inset (hit areas gapless), minimum 44px touch height. The grid never spans full-bleed: visible margins, gutter, and headers are permanent scroll-safe zones. Empty out-of-window slots render as faint placeholder cells so the day shape reads at a glance.

### 7.5 Motion inventory

Global rules: micro-feedback 120-180ms, standard transitions 200-280ms, celebrations 500-800ms and rate-limited. Springs use motion-pop, everything else motion-glide. Under prefers-reduced-motion: loops stop, springs become 150ms fades, sparks and blooms are removed, odometers become text swaps, auto-scroll is instant. No meaning is ever motion-only.

| # | Animation | Trigger | Spec | Reduced |
|---|---|---|---|---|
| 1 | Ignite sweep | first data render | heat animates 0 to current, 8ms/cell stagger L-to-R, cap 500ms | instant heat |
| 2 | Paint stamp | cell painted | fill instant, scale 0.94 to 1, 140ms pop | fill only |
| 3 | Erase | cell erased | fade 120ms, slight shrink | fade |
| 4 | Finger glow trail | active stroke | radial glow at ~80ms lag | none |
| 5 | Remote shimmer | SSE stroke lands | painter-color glint 450ms/cell, 12ms stagger, cap 400ms, 2s batching | heat crossfade only |
| 6 | Heat crossfade | any count change | 200ms linear | same (color is meaning) |
| 7 | White-hot breathing | count == N | 3s glow loop, persistent | static gold glow |
| 8 | Chip join | presence join | pop 280ms, label held 1.8s, collapse 240ms | fade, label shows |
| 9 | Chip leave | presence expiry | fade + scale 0.8, 200ms | fade |
| 10 | Ghost pulse | unnamed viewer | opacity 0.5 to 0.8, 2.4s loop | static |
| 11 | Ghost hatch | name saved | ring sweeps solid, color floods, 350ms pop | crossfade |
| 12 | Painting ring | painter active | dashed ring 1.2s rotation; ellipsis loop 900ms | static ring, static "..." |
| 13 | Odometer roll | chip count change | digits translate 300ms | text swap |
| 14 | Chip shine | new best | sheen 500ms once | none |
| 15 | Heat bloom | M increases | radial glow 700ms once | none |
| 16 | Ember sparks | M increases | 3-5 particles, 40px rise, 600ms; max 1 per 30s | none |
| 17 | Gold pulse | consensus | single 800ms chip-row sweep | color + status line |
| 18 | Chip tap spotlight | tap hotspot chip | scroll 350ms + outline pulses twice | instant scroll, static outline 2s |
| 19 | Timezone toggle | note tap | label crossfade 200ms | swap |
| 20 | Bottom bar keyboard hide | name focus | translate down 180ms via visualViewport | display change |
| 21 | Connection dot | state | green breathe 2s / amber blink 1s | static colors |
| 22 | Idle shimmer | zero-paint event | faint sweep on candidate columns, 1.4s | static |
| 23 | Status line | any status | rise+fade in 200ms, out 250ms after 3s | fade |

### 7.6 The first five seconds

- **0ms:** Hono serves per-event HTML: full OG block in the first few KB of head, then critical inline CSS (bg, type, grid skeleton), then an inline JSON snapshot of event state (title, mode, slots, counts, participant count, roster).
- **First paint (< 400ms):** dark bg, real title in Bricolage, date strip, correctly-dimensioned grid skeleton from the snapshot. Zero layout shift, zero splash.
- **Hydration (~300-800ms):** the ignite sweep plays (animation 1). The grid warms up like a lantern being lit: the signature entrance, honestly communicating "this is live state, not a form".
- **+100ms:** presence chips pop in (60ms stagger) from the snapshot roster; any in-flight "Maya is painting..." is already in the status line.
- **Then:** hotspot chips slide down with counts already correct (no odometer on entrance); SSE opens in parallel and its snapshot reconciles; connection dot goes green. Known device shows "you: Maya"; unknown shows nothing (name ask waits for the first stroke).
- **If idle after settle:** one-time hint under the grid, "drag across times you can do", gone forever on first pointerdown.

**Performance budget:** critical HTML under 15KB, JS under 150KB gzipped, font preloaded, page well under the 1MB messenger cap, skeleton visible no longer than 1s on 4G, interactive under 1.5s.

---

## 8. Micro-copy inventory

**Voice rules.** Sentence case, contractions, second person, short. Warm, not wacky. Banned words: attendees, respondents, participants, submit, poll, RSVP (say people, friends, everyone, names). Max one exclamation point per screen. No emoji in system copy. Never use em dashes. Numbers over words: "5 of 6", never "five of six". Absolute dates in anything that can be screenshotted or shared.

**Composer**
- Title prompt: "What's the plan?" / placeholder: "pizza night?"
- Helper: "give it a name people will tap"
- Mode toggle: "Times" / "All day"
- Window presets: "Evenings 5-11p" (default), "Morning 8a-12p", "Afternoon 12-5p", "All day 8a-11p"
- Group size row: "How many of you?"
- Timezone caption: "times in ET"
- Fallback event title (never typed): "untitled hang"

**Share**
- Pre-paint nudge: "Paint yours first. Your times ride along in the invite card."
- Send bar: "Send it" (with slug in mono)
- Post-paint microcopy: "invite card updated"
- Copy fallback toast: "copied. go paste it somewhere fun."
- SMS tip (share sheet overflow): "tip: keep the link at the end of your text so it previews"

**Name and identity**
- Chip idle: "add your name" / committed: "you: Maya"
- Collision: "Sam already marked 4 times here. That you?" / "Yep, that's me" / "Different Sam"
- Disambiguation: "add a last initial so the group can tell you apart"
- SSE broadcast: "Sam joined from a new device"

**Empty states**
- Creator alone: "just you so far. you get first pick of times."
- Visitor, nobody painted: "no one's painted yet. be the first."
- Hotspot row empty: "no hotspots yet. paint your times to start the heat." / "hotspots show up when the next person paints."
- Solo chip (R=1): "Fri 7-9p · just you so far"
- Legend solo: "just you so far"
- First-visit hint: "drag across times you can do"

**Presence**
- "Maya is painting..." / "2 others are looking" / "12 here now"
- Popover header: "here now" / ghost: "someone's peeking"

**Timezone**
- "shown in your time (Central). made in Eastern. [show in Eastern]"

**Hotspots**
- Chip: "Fri 7-9pm" + "5 of 6" / tag: "new best" / tie: "two-way tie"
- First overlap: "first overlap. Fri 7-9pm works for both of you."
- Consensus: "that's everyone. Fri 7-9pm works for all 6."

**Return visit**
- "2 new since you were here: Maya, Jules" / "Fri 7 to 9pm took the lead."

**Nudges (creator only)**
- Chip: "3 still out · give a nudge"
- Sheet primary: "Share the card again" / caption: "Sends a fresh card with today's heatmap."
- Sheet secondary: "Copy a nudge text", rotating (URL always last):
  - "Still need your times for {title}: {url}"
  - "{n} in so far. You're the missing piece: {url}"
  - "{top window} is winning. Speak now: {url}" (only when a hotspot exists)

**Lock and calendar**
- Undo snackbar: "Locked Fri 7pm · Undo"
- Decided hero conversion: "7:00 pm ET · 6:00 pm for you"
- Attendance: "works for all 6" / "5 of 6 can make it"
- Post-lock chip: "Tell the group"
- Calendar button: "Add to calendar"
- Grid divider after lock: "how we got here"

**Errors and connection**
- "reconnecting..." / "back live. caught you up."
- "couldn't save that stroke. it'll retry."
- "you're offline. your paints are queued."
- Dead link page: "this link fizzled. ask for a fresh one." / CTA: "start a new one"

**Past event**
- Trophy banner: "Fri 7-9p won, 5 of 6 made it" / CTA: "Run it back"

---

## 9. OG image and share spec

### 9.1 Governing model

Every share is a snapshot, not a surface: the preview is baked on the sender's device at compose time and never updates in the bubble. So the loop is: state changes, someone re-shares, the thread gets a fresh card. The zero-response card is the most common card (the creator shares seconds after creating) and gets the most design investment. Cards must age gracefully: no countdowns, no relative dates, counts as garnish under the title. The URL doubles as the preview for green-bubble SMS and Signal recipients, which is why slugs read as invitations.
   - **Conflict:** friction argues creator-paints-first makes the zero-state card rare, share-loop invests most in the zero state. **Resolution:** both, no tension: nudge paint-before-share so the common snapshot shows "1 in", and still ship the fully designed zero-state card because sharing is never gated behind painting.

### 9.2 Shared frame (all states)

- **Canvas:** 1200x630 PNG (satori + resvg), Bricolage Grotesque SemiBold and Medium embedded locally, no external assets.
- **Square-safe core:** all load-bearing content inside the central 1000px horizontally (iOS 17 can crop squarish); decoration may bleed.
- **Background:** bg #0E0B16 with a faint radial ember glow bottom-right and 2% noise (prevents banding, compresses well). Dark pops in both iMessage themes and the heat ramp only reads on dark.
- **Downscale math:** bubbles render at roughly 280-320pt wide (~4x downscale). Minimum informational text size: 44px on canvas. Nothing informational below 44px.
- **Fixed regions:** brand strip (y 56-112, flame glyph + "hotspot" wordmark, 40px, 55% opacity); title zone (y 140-330, 2 lines max); sub line (46px, muted); state module (y 400-574, the only region that changes).
- **Title sizing:** 104px SemiBold up to 18 characters, 84px up to 32, 64px beyond, ellipsis at 2 lines. Keep trailing "?" (brand voice).
- **Sub line:** absolute and stable. Datetime: "Oct 3 to Oct 6 · evenings" (band word derived from window bounds, omitted if mixed). Date mode: "picking a day, Oct 3 to Oct 10". Never "this weekend".

### 9.3 Three states

**State A, fresh (0 responses): invitation energy.** No heatmap (an empty heatmap is a sad heatmap). Left 60%: up to five day chips (150x120, 16px gap): weekday abbreviation 40px muted over day number 64px white, faint dashed inner borders with subtle pulse-gradient fills reading as "slots waiting to be lit"; more than five days shows four plus "+3". Right 40%: CTA in ember-orange 52px SemiBold, "paint the times" / "you can make", with 44px muted "20 seconds, no signup" below. Nothing on this card can become false with age.

**State B, in progress (1+ responses, unlocked).** Left half: the mini heatmap, built to survive 4x downscale: columns are days (max 6, then a "+N" tail column at 40%), rows are exactly three coarse bands (morning, afternoon, evening) computed by max-pooling the real slot grid; date mode renders one row of tall day cells. Cells 76x46, gap 8, radius 10. Color is absolute 0..N **quantized to four steps** (0: #221B38 barely lighter than bg; low: #6E1E79; mid: #D9533B; high: #F6C445) plus the fifth "everyone" treatment: white-hot #FFE9A8 core with a 6px outer glow, the only glow on the card (continuous ramps turn to mud at 300px). Weekday initials 36px at 45% above columns (decoration, not load-bearing). Right half: fraction typography, "4" at 128px white over "of 7 in" at 52px muted (or "4 in" at 96px when expected size is unset), and below in 44px ember: "best so far: Fri 7 to 9pm" (only when a hotspot with count >= 2 exists; "best so far" is hedged phrasing so an old bubble never lies).

**State C, decided: the trophy card.** Single centered lockup, no heatmap: check-in-circle glyph (56px) beside "LOCKED IN" (44px, letterspaced, ember); the window at 96px SemiBold white, "Fri, Oct 3 · 7:00 pm" (date mode "Friday, Oct 3"), always home timezone with the short zone label at 44px muted ("ET"); then 48px muted "works for all 6" or "5 of 6 can make it". Title zone shrinks one size step. This is the card people scroll back to find.

### 9.4 Meta tags and delivery

Full OG block at the very top of head, within the first few KB, before any inline CSS or JS (WhatsApp reads the first 300KB, Slack ~32KB; iMessage runs no JS, so tags must be server-injected by Hono). Constant tags:

```html
<meta property="og:site_name" content="Hotspot">
<meta property="og:url" content="https://meetup.sals.site/e/{slug}">
<meta property="og:image" content="https://meetup.sals.site/e/{slug}/og.png?v={stateVersion}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
```

Per-state copy (title budget ~55 visible characters in iMessage):
- Fresh: og:title `{title} · pick your times`; og:description `Tap, paint when you're free, done. No signup, takes 20 seconds.`
- In progress: og:title `{title} · {n} of {m} in` (or `{title} · {n} in`); og:description `The heatmap is forming. Add your times and watch the best window light up live.`
- Decided: og:title `{title} · locked: Fri Oct 3, 7pm`; og:description `It's official. Tap for details and add it to your calendar.`

**og.png delivery:** endpoint `GET /e/{slug}/og.png`; meta references it with the absolute URL plus `?v={stateVersion}` (query params are safe here: this URL lives in meta tags, never hand-shared; versioning is the only reliable Discord/Slack unfurl refresh). Origin sends `Cache-Control: public, max-age=60` explicitly (otherwise Cloudflare edge-caches .png for 120 minutes and re-shares show stale heat). Render once per stateVersion, memoize bytes in memory plus disk keyed (eventId, stateVersion); target under 300ms warm, optionally pre-render on every mutation. Size target under 300KB, hard ceiling 600KB (WhatsApp limit, cellular courtesy). No UA gating on /e/* or the og route; allowlist both in any Cloudflare bot protection (the iMessage fetcher's facebookexternalhit+Twitterbot UA from a residential IP trips Bot Fight Mode). Ship the 180x180 apple-touch-icon (flame on bg).

**URL rules:** event URLs 200 directly with the full OG head, no shortener, no redirects (meta redirects are ignored by the iMessage fetcher; even server redirects add compose-time latency). Pure path, no query strings on shared links. Unknown or deleted slugs serve a branded 200 page with generic OG tags, never an error card in someone's thread.

### 9.5 Re-share nudges (the creator is the transport)

No server-side SMS in v1; every nudge ends in the creator's own share sheet or clipboard, and each one bakes a fresh card (nudges are also embed refreshes). Trigger, creator only (matched by device ID), when all hold: not locked; responses < expected (or < 3 when expected unset); event age > 4 hours; more than 20 hours since the creator last tapped any share affordance (tracked server-side per device). Cooldown 20 hours after tapping. The chip renders at the end of the hotspot row: "3 still out · give a nudge", opening a compact sheet (strings in section 8). Never modals, never badges, never pushes. Non-creators just get the standard share affordance.

### 9.6 The decided endgame: lock and calendar

   - **Conflict:** share-loop fully designs a lock flow, friction and delight defer finalize to the roadmap. **Resolution:** include lock in v1 in its minimal form. Without it the "so are we doing Friday?" loop never resolves, the trophy card is the share loop's strongest artifact, and the cost is small (one button, one snackbar, one OG state, one ICS route). Post-lock wobble warnings are cut (section 11).

- **The app proposes, the creator disposes.** When any window reaches 100% of current respondents (with at least 3), the top chip gains a glow and an inline **Lock it** button, creator-only. Below full attendance the button still exists on any hotspot chip for the creator (sometimes 5 of 6 is the answer).
- One tap locks. No confirm; a 6-second undo snackbar ("Locked Fri 7pm · Undo"). Locking bumps stateVersion, refreshing the OG pipeline instantly.
- **Page changes:** the header becomes the decided hero: big window text in the viewer's local timezone with the quiet conversion note ("7:00 pm ET · 6:00 pm for you"), attendance line, Add to calendar button. Hotspot chips collapse; the grid demotes below a divider "how we got here", still visible and still paintable (repainting is how someone signals a conflict). A one-time creator chip "Tell the group" opens the share sheet and bakes the trophy card into the thread: the loop's final planned re-share.
- **Add to calendar:** `GET /e/{slug}/event.ics`, `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment`. VEVENT: SUMMARY {title}; DTSTART;TZID={homeTz} and DTEND from the locked window (date mode: DTSTART;VALUE=DATE all-day); DESCRIPTION and URL contain the event URL; UID `{slug}@meetup.sals.site`; no attendees. Re-locking regenerates with the same UID and bumped SEQUENCE so re-adding corrects the entry. No Google auth, per the v1 boundary.

### 9.7 Share-loop launch checklist

1. OG block at top of head, first few KB, before inline CSS/JS.
2. `Cache-Control: public, max-age=60` on og.png.
3. No UA gating; Cloudflare bot protections allowlisted for /e/* and og.png.
4. og:image absolute, PNG under 600KB, 1200x630, plus 180x180 apple-touch-icon.
5. Event URLs 200 directly, no redirects, no query strings.
6. navigator.share with title and url only, never text.
7. All share text templates end with the URL, nothing after it.
8. Smoke-test the real named tunnel day one for preview latency and SSE streaming.
9. Test re-shares from a personal device with cache-buster params (sender devices cache previews per URL).

---

## 10. Edge cases and error states

### 10.1 Solo viewer (empty game lobby, not empty spreadsheet)

Presence is the heartbeat: "just you here" flips to "Maya is here" with a pop the moment a friend arrives, and creators demonstrably sit and watch the room fill. The hotspot row reframes emptiness: "no hotspots yet. paint your times to start the heat." Candidate columns carry the faint idle shimmer (animation 22). When the first non-creator stroke lands, the affected cells bloom and the count ticker rolls 0 to 1: the creator's reward for sharing arrives on the screen they are already on.

### 10.2 Event in the past

All candidate dates behind today: the event freezes. Read-only heatmap, painting disabled, name chip hidden. A banner celebrates the outcome: the winning hotspot as a trophy card ("Fri 7-9p won, 5 of 6 made it") with one subtle shine, no party cannon. One CTA: **"Run it back"**, opening the composer pre-filled with the same title, mode, window, and participant-favored weekday pattern shifted forward a week (the cheapest seed for the category's known recurring-group retention gap, without building groups).

### 10.3 Dead link

Branded 404-content page served as a 200 with generic valid OG tags and the brand card (a mistyped link in a thread still unfurls as Hotspot, never an error card). Copy: "this link fizzled. ask for a fresh one." One CTA: "start a new one".

### 10.4 20+ participants

Mechanics unchanged; display adapts. The ramp is continuous anyway; numeric captions carry precision ("17 of 23"). Hotspot chips become the primary reading surface. Tapping a hotspot chip's popover upgrades to a bottom sheet: slot label, "17 of 23 can make it", the in list, the out list, and single-person isolate chips. Presence collapses past 8 viewers to "12 here now" with active painters still named. Performance: past ~500 cells or 20 participants, render the heat layer as a single canvas or one absolutely-positioned layer, not thousands of DOM cells; SSE fanout on one box is trivial at this scale.

### 10.5 Offline, save failure, reconnect

Optimistic local state always survives. Failed saves retry with backoff ("couldn't save that stroke. it'll retry."); offline shows "you're offline. your paints are queued." and flushes on reconnect. SSE reconnect per section 6.1; the snapshot event reconciles everything; never fake the green dot.

### 10.6 Keyboard and viewport

Name input 16px+ (no iOS auto-zoom; never disable zoom via maximum-scale). While focused, the bottom bar hides and the input pins via visualViewport. Shell is min-height:100dvh with env(safe-area-inset-bottom) on the fixed bar.

### 10.7 Identity edges

Name collision and second device: the soft claim (2.4). Home-screen install gets fresh storage by design: the same one-tap claim path recovers identity; worst case is one tap plus one typed name. Cleared cookies: same path.

### 10.8 Data hygiene

Events with no shares, no paints, and no visits 24 hours after creation are deleted (composer abandonment). Anonymous participants with zero cells are garbage-collected with their connection.

### 10.9 Gesture edges

Rotate mid-stroke: revert cleanly, invalidate geometry cache. pointercancel: revert, log as defect. Timezone day-shift columns: header microline "Fri 12 into Sat 13". Events where a hotspot tie exists: multiple chips, "two-way tie" sub-label, only chip #1 crowned.

---

## 11. v1 cutlist

Deliberately deferred past v1 (owner-mandated exclusions restated first):

1. Google sign-in and calendar sync (future separate opt-in flow), SMS sending via Telnyx, profile pictures, accounts, recurring events (owner-mandated).
2. "If needed" second availability paint state (proven in category but adds interaction cost to every stroke decision).
3. Multi-person subset filtering ("when can just us 4 meet"): v1 ships me-peek and single-person isolate only.
4. "Copy my times from last event" ghost suggestion (cheap delight, but the weekday-window mapping rules are underspecified; revisit with real usage data).
5. Persistent friend groups and rosters (the retention gap is real; device identity sets it up; not v1).
6. Light mode ("paper lantern"): v1 is dark only; the brand, the ramp, and OG cards are designed dark-first.
7. Optional sound pack (requires an overflow menu that otherwise does not exist).
8. Web push notifications (iOS requires 16.4+ plus home-screen install; post-install future).
9. Post-lock wobble warnings ("Sam can no longer make Fri 7pm") and attendance-change alerts.
10. Comments and notes on events.
11. Momentum in the two-finger manual pan.
12. Event editing after creation (changing dates or window once the link is out; see open questions).
13. More than 14 candidate days per event.

---

## 12. Open questions for Sal

1. **Lock in v1:** this spec includes the minimal lock flow (one tap, undo snackbar, trophy OG card, ICS). Two of four designers deferred it. Confirm the scope appetite, or it moves cleanly to v1.1 (State C of the OG system and the ICS route are the only casualties).
2. **Event editing after the link is out:** v1 ships with no creator edit of dates or windows post-creation. Acceptable? If not, we need rules for painted cells that fall outside a changed window.
3. **"How many of you?" stepper:** keep it (one optional tap, powers "4 of 7 in" denominators everywhere) or cut it for a purer composer?
4. **Brand name:** does "Hotspot" ship as the visible wordmark on OG cards and the header at meetup.sals.site, or is it still a codename pending a real name and domain?
5. **Data retention:** how long do events, cells, and device-name records live in SQLite before purge? (Affects "Run it back", return visits, and privacy posture.)
6. **Hard caps:** 14 candidate days and a soft ceiling around 100 participants per event acceptable for v1?
7. **Creator delete:** does v1 need a delete-event control (regret or abuse path), and is creator-device-only sufficient authority for it?
8. **Dark-only v1:** confirmed acceptable that there is no light mode at launch?
