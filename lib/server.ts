import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

let _db: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_db) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    _db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // A dead Supabase must fail fast, not hang the request until the platform kills it.
      global: { fetch: (u: any, o: any) => fetch(u, { ...o, signal: AbortSignal.timeout(8000) }) },
    });
  }
  return _db;
}

export const sha = (s: string) => createHash('sha256').update(String(s)).digest('hex');

export function ip(req: Request): string {
  const h = req.headers;
  return (h.get('x-forwarded-for') || h.get('x-real-ip') || 'unknown').split(',')[0].trim();
}

export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// Per-instance limiter. Used for Firebase games and as the fallback when Supabase is unreachable.
// Serverless instances do not share memory, so this is best-effort, not a hard cap.
const mem = new Map<string, number[]>();
export function memLimit(key: string, max: number, windowSecs: number): boolean {
  const t = Date.now();
  const arr = (mem.get(key) || []).filter((x) => t - x < windowSecs * 1000);
  arr.push(t);
  mem.set(key, arr);
  if (mem.size > 5000) mem.clear();
  return arr.length <= max;
}

// Never lets a broken limiter take the game down: falls back to the in-memory limiter.
export async function limit(key: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const r: any = await withTimeout(db().rpc('rate_hit', { p_key: key, p_max: max, p_window: windowSecs }), 2000);
    if (r.error) throw new Error(r.error.message);
    return r.data === true;
  } catch (e: any) {
    console.error('rate_hit unavailable, using memory limiter:', e?.message);
    return memLimit(key, max, windowSecs);
  }
}

// Tells connected clients "state changed, refetch". Clients also poll, so a failure here is not fatal.
export async function broadcast(room: string) {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `r-${room}`, event: 'v', payload: { t: Date.now() }, private: false }] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) console.error('broadcast failed', res.status, await res.text());
  } catch (e) { console.error('broadcast', e); }
}

export function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

// Wraps a route so unexpected errors become a readable JSON message instead of a bare 500.
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); } catch (e: any) {
    console.error(e);
    const m = String(e?.message || '');
    if (/missing SUPABASE|not configured/i.test(m)) return bad(m, 503);
    return bad('Server error, please try again', 500);
  }
}

export const isPin = (p: any) => typeof p === 'string' && /^\d{6}$/.test(p);

export type Quiz = { title: string; questions: { text: string; options: string[]; correct: number; time: number }[] };

export function cleanQuiz(input: any): Quiz | string {
  if (!input || typeof input !== 'object' || !Array.isArray(input.questions)) return 'Quiz is malformed';
  const qs = input.questions;
  if (qs.length < 1 || qs.length > 60) return 'A quiz needs 1 to 60 questions';
  const out: Quiz = { title: String(input.title || 'Untitled quiz').trim().slice(0, 100), questions: [] };
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i] || {};
    const text = String(q.text || '').trim().slice(0, 300);
    const rawOpts: any[] = Array.isArray(q.options) ? q.options : [];
    // Keep original indexes so "correct" still points at the right option after dropping blanks.
    const kept: { s: string; i: number }[] = [];
    rawOpts.slice(0, 4).forEach((o, idx) => { const s = String(o ?? '').trim().slice(0, 120); if (s) kept.push({ s, i: idx }); });
    if (!text) return `Question ${i + 1} has no text`;
    if (kept.length < 2) return `Question ${i + 1} needs at least 2 options`;
    const at = kept.findIndex((k) => k.i === Number(q.correct));
    if (at < 0) return `Question ${i + 1} has no valid correct answer`;
    const time = Math.min(120, Math.max(5, Math.round(Number(q.time) || 20)));
    out.questions.push({ text, options: kept.map((k) => k.s), correct: at, time });
  }
  return out;
}
