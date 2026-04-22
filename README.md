# 🃏 Home Pot

A pro-feel poker tournament & cash-game manager, designed for your home games.
Mobile-first PWA, multi-device, fully self-hosted.

- 🏆 Tournament wizard with chip-aware stack suggestions (knows your physical chip set)
- ⏱  Live blind timer + monitor view (works as a TV/extra-phone scoreboard)
- 💵 Cash games with live ledger and minimum-transactions settle-up
- 💀 Bounty tracking, color-up alerts, payout calculator
- 📈 All-time leaderboard across nights
- 🔁 Multiplayer realtime sync — host runs the show, players watch from their phones
- 📦 Self-hosted Supabase in Docker, owns its data
- 📲 PWA (installable, offline-capable, wake-lock on monitor view)
- 🎵 Synthesized sound effects (no external assets)

---

## Quick start

### 1. Configure
```bash
cp .env.example .env
```

Open `.env` and replace the placeholder JWT keys. The two values you need to
generate yourself are `ANON_KEY` and `SERVICE_ROLE_KEY` — they are JWTs signed
with `JWT_SECRET`. Easiest path:

```bash
# install once
npm install -g jsonwebtoken-cli

# anon
echo '{"iss":"supabase","role":"anon","iat":1700000000,"exp":2000000000}' \
  | jwt sign --secret "$(grep JWT_SECRET .env | cut -d= -f2)"

# service_role
echo '{"iss":"supabase","role":"service_role","iat":1700000000,"exp":2000000000}' \
  | jwt sign --secret "$(grep JWT_SECRET .env | cut -d= -f2)"
```

Paste those into `.env` for both `VITE_SUPABASE_ANON_KEY` / `ANON_KEY` and
`SERVICE_ROLE_KEY`.

### 2. Run the whole stack
```bash
docker compose up -d --build
```

That's it.

| Service | URL |
|---|---|
| Web app (PWA) | http://localhost:5173 |
| Supabase API + Studio | http://localhost:8000 |
| Postgres (host port) | `localhost:54322` |

The schema in `supabase/migrations/00-init.sql` is loaded automatically on first
boot. To reset: `docker compose down -v && docker compose up -d`.

### 3. Sign up
First user signs up in the web app and becomes the host. From the dashboard,
create a tournament or a cash game — they sync to every other phone in
realtime.

---

## Local development

```bash
npm install
npm run dev      # vite on http://localhost:5173
```

You still need Supabase running for auth/data. The simplest path is to keep
the `db` / `auth` / `rest` / `realtime` / `kong` services from `docker-compose.yml`
running and just stop the `pwa` service:

```bash
docker compose up -d db rest auth realtime meta studio kong
npm run dev
```

---

## How it works

- **Tournament wizard** ([src/features/tournament/TournamentWizard.tsx](src/features/tournament/TournamentWizard.tsx)) — 4 steps: setup → players → structure → review.
- **Blind structures** ([src/features/tournament/BlindStructures.ts](src/features/tournament/BlindStructures.ts)) — three presets tuned for the user's chip set.
- **Live screen** ([src/features/tournament/TournamentLive.tsx](src/features/tournament/TournamentLive.tsx)) — host runs blinds, busts, rebuys; everyone else sees a live read-only view.
- **Monitor view** ([src/features/tournament/TournamentMonitor.tsx](src/features/tournament/TournamentMonitor.tsx)) — full-screen scoreboard. Wake lock on. Prop a phone or open on a TV.
- **Cash game** ([src/features/cash/CashGameLive.tsx](src/features/cash/CashGameLive.tsx)) — live ledger + greedy [settle-up calculator](src/features/cash/settle.ts).
- **Chip set** ([src/lib/chipSet.ts](src/lib/chipSet.ts)) — your physical inventory. Editable in Settings.
  Used for stack suggestions, color-up alerts, and per-player chip distribution.
- **Realtime sync** — every screen subscribes to Postgres changes via
  Supabase Realtime. The host updates state; every other phone updates within
  ~200ms.

---

## Roles

This is a friend-group app — **everyone signed in can do everything mid-game**.

| | Anyone signed in |
|---|---|
| Sign in | ✅ |
| Create session / tournament / cash game | ✅ (you become its "host" for record-keeping) |
| Add players, including for guests | ✅ |
| Run timer / mark eliminations / rebuys (your own or anyone else's) | ✅ |
| Top-up / cash-out cash-game players | ✅ |
| View monitor screen | ✅ |

Enforced (loosely) by Postgres RLS — see [supabase/migrations/01-init.sql](supabase/migrations/01-init.sql) and [supabase/migrations/02-collab.sql](supabase/migrations/02-collab.sql). Auth is required, but trust within the group is total.

---

## Tech stack

- React 18 + TypeScript + Vite
- TailwindCSS (custom poker-felt theme + Bebas Neue display font)
- Framer Motion for animations
- Zustand for client state, Web Storage for settings persistence
- `@supabase/supabase-js` for auth + realtime + REST
- `vite-plugin-pwa` for PWA shell
- Wake Lock API + Web Audio API
- Self-hosted Supabase (Postgres + GoTrue + PostgREST + Realtime + Studio + Kong) via Docker Compose
- Frontend served by nginx in a multi-stage Docker build

---

## Roadmap (what's not here yet)

- Push notifications when blinds advance
- "Self-bust" affordance for non-host players
- Photo / share-card auto-generated at end of tournament
- iOS Add-to-Home-Screen install prompt UI
- Persist a "tonight's session" wrapper around tournaments + cash games
