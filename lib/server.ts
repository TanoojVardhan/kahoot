import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

let _db: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_db) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    _db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _db;
}

export const sha = (s: string) => createHash('sha256').update(String(s)).digest('hex');

export function ip(req: Request): string {
  const h = req.headers;
  return (h.get('x-forwarded-for') || h.get('x-real-ip') || 'unknown').split(',')[0].trim();
}

// Fails open: a broken limiter must not take the game down.
export async function limit(key: string, max: number, windowSecs: number): Promise<boolean> {
  try {
    const { data, error } = await db().rpc('rate_hit', { p_key: key, p_max: max, p_window: windowSecs });
    if (error) { console.error('rate_hit', error.message); return true; }
    return data === true;
  } catch (e) { console.error('rate_hit', e); return true; }
}

// Tells connected clients "state changed, refetch". Clients also poll, so a failure here is not fatal.
export async function broadcast(room: string) {
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `r-${room}`, event: 'v', payload: { t: Date.now() }, private: false }] }),
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

export const isPin = (p: any) => typeof p === 'string' && /^\d{6}$/.test(p);

export async function hostGame(pin: any, hostToken: any) {
  if (!isPin(pin) || typeof hostToken !== 'string' || !hostToken) return null;
  const { data } = await db().from('games').select('pin,room,host_hash').eq('pin', pin).maybeSingle();
  if (!data || data.host_hash !== sha(hostToken)) return null;
  return data;
}

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
