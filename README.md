# Quizroom

Live multiplayer quiz (Kahoot-style) on Next.js + Supabase. Up to 50 players per game.

## Setup
1. Supabase: run `schema.sql` in the SQL editor (already applied to the `kahoot` project).
2. `cp .env.example .env.local` and fill in all four values. `SUPABASE_SERVICE_ROLE_KEY` is server-only: never prefix it with `NEXT_PUBLIC_`, never commit it.
3. `npm install && npm run dev`, then open `/host` on a laptop and `/` on phones.

## Deploy (Vercel)
Import the GitHub repo and add the same four env vars in Project Settings, then deploy.

## How it works
All game logic lives in Postgres functions that only the server can call. Clients never read tables directly,
so correct answers are never sent before the reveal. Realtime broadcasts only say "refetch"; clients also poll.

## Backup database (Firebase)
New games normally live in Supabase (PINs 100000-899999). If Supabase is unreachable when the host creates a game,
the app creates it in Firestore instead (PINs 900000-999999). The PIN alone tells every request which database to use.

Limits you should know about:
- A game that is already running on Supabase when it goes down is NOT moved. Only new games fail over.
- Firebase games have no realtime channel; phones poll every 3 seconds, so screen changes can lag by a few seconds.
- The free Firestore quota (50k reads and 20k writes per day, check current limits) is roughly one full 50-player class per day.

Setup:
1. Firebase console: create a Firestore database (production mode, NOT test mode).
2. Firestore > Rules: paste `firestore.rules` (denies every client) and publish. Only the server can read or write.
3. Project settings > Service accounts > Generate new private key. Convert the JSON to base64 and put it in
   `FIREBASE_SERVICE_ACCOUNT_B64` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`).
   Add it to Vercel as a server-only variable. Never commit the key file. Delete the downloaded JSON afterwards.
4. Optional: Firestore > TTL, add a policy on collection group `games`, field `expireAt`, to auto-delete old games.

## Keeping Supabase from pausing
`vercel.json` runs `/api/keepalive` daily, which makes a trivial query so the project is not idle. Set `CRON_SECRET`
in Vercel (any long random string) so only Vercel can call it. Confirm the current pausing rules in Supabase's docs.
