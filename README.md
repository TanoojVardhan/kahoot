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
