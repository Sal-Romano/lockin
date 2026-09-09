# meetup

Find the time that works for everyone. Make a plan, text the link, friends paint the times they can do, and everyone watches the hotspot form live. No accounts, no submit buttons.

Live at [meetup.sals.site](https://meetup.sals.site) (working name, brand TBD).

## How it works

- **Creator** lands on a composer with no Create button: the event drafts itself server-side on the first date tap, updates live as they type, and the readable link (`/e/pizza-night-x7k2`) is minted the moment they share. They paint their own times first so the link never opens onto a cold grid.
- **Friends** tap the link, land straight in the live event view (first frame rendered from a server-inlined snapshot), paint before naming, then drop a name once (remembered per device).
- **Everyone** sees a live heatmap plus ranked "hotspot" windows (best time, headcount, who is in) and honest presence chips derived from open SSE connections. My-availability is a cool ink ring over the warm group heat, one surface, no You/Group tabs.
- **The creator locks a winner** with one tap (6 second undo, no dialog): the page becomes a decided hero with an `.ics` download and a "tell the group" re-share.
- **iMessage embeds** are server-rendered per event (satori + resvg): a dark poster card with three states (invitation, heat forming, locked trophy). iMessage bakes the preview at send time, so every re-share mints a fresh snapshot; `stateVersion` drives memoization and cache busting.

Light "paper lantern" theme by default, dark follows the system. Unbranded for now.

## Stack

- React 19 + Vite + Tailwind 4 (SPA)
- Hono on Node 22 (`server/`), SQLite via better-sqlite3 (`data/meetup.db`, gitignored)
- SSE for live updates; presence is derived from the open SSE connections themselves
- satori + @resvg/resvg-js for the per-event OG image (`/e/:id/og.png`)
- Shared logic (`shared/`) used by both client and server: slot keys, hotspot ranking, formatting

## Identity model

No auth. A device UUID lives in localStorage and rides an `x-device` header; the server mirrors it into a long-lived HttpOnly cookie so identity survives Safari clearing script-writable storage. Name is remembered per device.

## Develop

```bash
npm install
npm run dev      # vite on :5173 (HMR) + server on :9834
npm run watch    # server on :9834 + vite build --watch (what the tunnel serves)
npm run build    # build the SPA into dist/
npm run start    # serve dist/ + API on :9834
npm run typecheck
```

## Deploy

The box's cloudflared tunnel routes `meetup.sals.site` to `localhost:9834`. Run `npm run build && npm run start` (or `npm run watch` during active development). `PUBLIC_ORIGIN` overrides the origin used in OG tags (defaults to `https://meetup.sals.site`).

## Design

The UX spec lives in [UX-SPEC.md](UX-SPEC.md); platform research notes (iMessage embed mechanics, iOS Safari touch/storage quirks, competitor teardown) live in [RESEARCH.md](RESEARCH.md).
