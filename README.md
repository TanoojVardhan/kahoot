# Quizroom (Next.js + Supabase, deploys on Vercel)

## Setup
1. Create a Supabase project. In the SQL editor, run `supabase/schema.sql`.
2. In Supabase: Project Settings > API. Copy the URL, the anon key and the service_role key.
3. Locally: `cp .env.example .env.local`, fill it in, then `npm install && npm run dev`.
4. Vercel: import the repo and add the same four env vars. `SUPABASE_SERVICE_ROLE_KEY` must NOT start with `NEXT_PUBLIC_`.

## How it works
- Game state and all transitions live in Postgres functions (atomic, so concurrent answers cannot corrupt scores).
- Next.js route handlers (`app/api/game/route.ts`) are the only thing that touches the database (service-role key).
- Players receive phase changes through Supabase Realtime Broadcast, sent by the server over REST.
- Serverless has no timers: the host's browser asks the server to close a question when time is up
  (players also do, ~4s later, as a fallback). The server checks the deadline itself.

## Limits
- Supabase free plan: ~200 concurrent realtime connections (so ~199 players across ALL live games at once),
  2M realtime messages/month, and projects pause after a week of inactivity. Check current numbers on their pricing page.
- Vercel Hobby plan is for non-commercial use.
