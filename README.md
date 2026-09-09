# lockin

Find the time that works for everyone, then lock it in. Make a plan, text the link, friends mark the times they can do, and everyone watches consensus form live. No accounts, no submit buttons.

Live at [lockin.sals.site](https://lockin.sals.site) (`thelockin.app` coming soon).

## How it works

- **Creator** lands on a composer with no Create button: name it, pick a plan type, tap some days, dial the window on a two-thumb slider, and share. The readable link (`/e/pizza-night-x7k2`) is minted the moment they share, and they can mark themselves in for the times they offer so the link never opens onto a cold grid.
- **Friends** tap the link, land straight in the live event view (first frame rendered from a server-inlined snapshot), mark their times before naming, then drop a name once (remembered per device).
- **Everyone** sees a live view of who is in. Offered blocks render as "glasses" that fill with a warm liquid to the share of the group who can make them, the voters' initials are piped into each block, and a whole-group time tops off and glows gold. Presence chips are honest, derived from open SSE connections.
- **The creator locks a winner** with one tap. Once a whole-group time exists the lock button graduates from a quiet pill to a loud, pulsing CTA that names the winning date; locking turns the page into a decided hero with an `.ics` download and a "tell the group" re-share.
- **iMessage embeds** are server-rendered per event (satori + resvg): a dark poster card with three states (invitation, forming, locked). iMessage bakes the preview at send time, so every re-share mints a fresh snapshot; `stateVersion` drives memoization and cache busting.

Light "paper lantern" theme by default, dark follows the system.

## Stack

- React 19 + Vite + Tailwind 4 (SPA)
- Hono on Node 22 (`server/`), SQLite via better-sqlite3 (`data/`, gitignored)
- SSE for live updates; presence is derived from the open SSE connections themselves
- satori + @resvg/resvg-js for the per-event OG image (`/e/:id/og.png`)
- Shared logic (`shared/`) used by both client and server: slot keys, hotspot ranking, formatting

## Identity model

No auth. A device UUID lives in localStorage and rides an `x-device` header; the server mirrors it into a long-lived HttpOnly cookie so identity survives Safari clearing script-writable storage. Name is remembered per device.

## Develop

```bash
npm install
npm run dev      # vite on :5173 (HMR) + server on :9834
npm run build    # build the SPA into dist/
npm run start    # serve dist/ + API on :9834
npm run typecheck
```

## Deploy

The box's cloudflared tunnel routes `lockin.sals.site` to `localhost:9834`. Run `npm run build && npm run start`. `PUBLIC_ORIGIN` overrides the origin used in OG tags and calendar links (defaults to `https://lockin.sals.site`).

## Design

The UX spec lives in [UX-SPEC.md](UX-SPEC.md); platform research notes (iMessage embed mechanics, iOS Safari touch/storage quirks, competitor teardown) live in [RESEARCH.md](RESEARCH.md).
