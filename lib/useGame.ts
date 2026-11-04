'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { post } from './client';

// Keeps a client in sync with the server: realtime nudge + polling fallback + visibility refresh.
// The server state is the only source of truth; broadcasts just say "refetch now".
export function useGame(pin: string, auth: any, room: string | undefined, pollMs: number, jitterTick: boolean) {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [, setFrame] = useState(0);
  const offset = useRef(0);
  const inflight = useRef(false);
  const again = useRef(false);
  const authKey = JSON.stringify(auth);
  const stateRef = useRef<any>(null);
  const lastTick = useRef(0);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      const t0 = Date.now();
      const s = await post('/api/state', { pin, ...JSON.parse(authKey) });
      offset.current = s.now - (t0 + Date.now()) / 2;
      stateRef.current = s;
      setState(s);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Connection problem');
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; refresh(); }
    }
  }, [pin, authKey]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, pollMs);
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', refresh);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', refresh); };
  }, [refresh, pollMs]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!room || !url || !key) return;
    const client = createClient(url, key, { auth: { persistSession: false } });
    const ch = client.channel(`r-${room}`).on('broadcast', { event: 'v' }, () => refresh()).subscribe();
    return () => { client.removeChannel(ch); };
  }, [room, refresh]);

  // Redraw ~4x/second so countdowns move; also fire the "time is up" tick.
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => f + 1);
      const s = stateRef.current;
      if (s && s.phase === 'question') {
        const now = Date.now() + offset.current;
        if (now >= s.qEnd + 700 && Date.now() - lastTick.current > 2500) {
          lastTick.current = Date.now();
          const fire = () => post('/api/tick', { pin }).then(() => refresh()).catch(() => {});
          if (jitterTick) setTimeout(fire, Math.random() * 1500); else fire();
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [pin, refresh, jitterTick]);

  const nowMs = () => Date.now() + offset.current;
  return { state, error, refresh, nowMs };
}
