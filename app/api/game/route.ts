import { NextRequest, NextResponse } from 'next/server';
import {
  db, sha, rand, ipOf, clean, cleanQuiz, loadGame, hostOk, buildView, publish,
} from '@/lib/server';

export const dynamic = 'force-dynamic';

const MAX_PLAYERS = 200; // matches the Supabase free-tier realtime connection cap
const bad = (code: string, error: string, status = 400) => NextResponse.json({ code, error }, { status });

// ---------- GET: current state (page load, reconnect, host polling) ----------
export async function GET(req: NextRequest) {
  const pin = req.nextUrl.searchParams.get('pin') || '';
  const role = req.nextUrl.searchParams.get('role');
  const token = req.headers.get('x-token') || '';
  const g = await loadGame(pin);
  if (!g) return bad('no_game', 'That game no longer exists.', 404);

  if (role === 'host') {
    if (!(await hostOk(pin, token))) return bad('no_game', 'That game no longer exists.', 404);
    const view: any = await buildView(g);
    const { data: ps } = await db.from('players').select('id,name,choice').eq('pin', pin).order('created_at');
    view.players = (ps || []).map((p: any) => ({ id: p.id, name: p.name }));
    if (g.phase === 'question') view.answered = (ps || []).filter((p: any) => p.choice !== null).length;
    return NextResponse.json(view);
  }

  const { data: me } = await db.from('players').select('id,name,score,choice,gained,streak').eq('pin', pin).eq('token_hash', sha(token)).maybeSingle();
  if (!me) return bad('no_game', 'That game no longer exists.', 404);
  const view: any = await buildView(g);
  view.me = me;
  return NextResponse.json(view);
}

// ---------- POST: actions ----------
export async function POST(req: NextRequest) {
  let b: any;
  try { b = await req.json(); } catch { return bad('bad_json', 'Bad request.'); }
  if (!b || typeof b !== 'object') return bad('bad_json', 'Bad request.');
  const ip = ipOf(req);
  const pin = typeof b.pin === 'string' ? b.pin : '';

  switch (b.action) {
    case 'create': {
      const { data: ok } = await db.rpc('rate_hit', { p_key: 'create:' + ip, p_max: 10, p_window: 3600 });
      if (!ok) return bad('rate', 'Too many games created. Try again later.', 429);
      const quiz = cleanQuiz(b.quiz);
      if (!quiz) return bad('bad_quiz', 'Quiz is invalid: 1-50 questions, each with text, 2-4 answers and one correct answer.');
      // opportunistic cleanup of old games (cascades to players)
      await db.from('games').delete().lt('created_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString());
      const hostToken = rand(16);
      const room = rand(16);
      for (let i = 0; i < 6; i++) {
        const newPin = String(100000 + Math.floor(Math.random() * 900000));
        const { error } = await db.from('games').insert({ pin: newPin, room, host_hash: sha(hostToken), quiz });
        if (!error) return NextResponse.json({ pin: newPin, room, hostToken });
        if (error.code !== '23505') { console.error(error); return bad('server', 'Could not create the game.', 500); }
      }
      return bad('server', 'Could not allocate a PIN. Try again.', 500);
    }

    case 'join': {
      const { data: failures } = await db.rpc('rate_peek', { p_key: 'bad:' + ip, p_window: 60 });
      if (failures >= 20) return bad('rate', 'Too many wrong attempts. Wait a minute and try again.', 429);
      const name = clean(b.name, 20);
      if (!/^\d{6}$/.test(pin)) {
        await db.rpc('rate_hit', { p_key: 'bad:' + ip, p_max: 1000, p_window: 60 });
        return bad('no_game', 'No open game with that PIN.', 404);
      }
      if (!name) return bad('bad_name', 'Enter a nickname.');
      const id = rand(4);
      const token = rand(16);
      const { data, error } = await db.rpc('fn_join', { p_pin: pin, p_id: id, p_name: name, p_token_hash: sha(token), p_max: MAX_PLAYERS });
      if (error) { console.error(error); return bad('server', 'Could not join. Try again.', 500); }
      if (data.status === 'no_game') {
        await db.rpc('rate_hit', { p_key: 'bad:' + ip, p_max: 1000, p_window: 60 });
        return bad('no_game', 'No open game with that PIN.', 404);
      }
      if (data.status === 'taken') return bad('name_taken', 'That nickname is taken. Pick another.', 409);
      if (data.status === 'full') return bad('full', 'This game is full.', 409);
      return NextResponse.json({ pin, room: data.room, id, token, name });
    }

    case 'answer': {
      const choice = b.choice;
      if (!Number.isInteger(choice)) return bad('bad', 'Bad answer.');
      const { data: status, error } = await db.rpc('fn_answer', { p_pin: pin, p_token_hash: sha(String(b.token || '')), p_choice: choice });
      if (error) { console.error(error); return bad('server', 'Could not record the answer.', 500); }
      if (status === 'all') {
        const { data: r } = await db.rpc('fn_reveal', { p_pin: pin, p_force: false });
        if (r) await publish(pin);
      }
      return NextResponse.json({ status });
    }

    case 'due': {
      // Anyone in the game may nudge a timed-out question; fn_reveal only acts if it is really due.
      const { data: r } = await db.rpc('fn_reveal', { p_pin: pin, p_force: false });
      if (r) await publish(pin);
      return NextResponse.json({ ok: true });
    }
  }

  // ---------- host-only actions ----------
  if (!(await hostOk(pin, String(b.hostToken || '')))) return bad('forbidden', 'Not allowed.', 403);

  switch (b.action) {
    case 'start':
    case 'next': {
      const { data: res, error } = await db.rpc('fn_advance', { p_pin: pin });
      if (error) { console.error(error); return bad('server', 'Could not advance the game.', 500); }
      if (res === 'no_players') return bad('no_players', 'Wait for at least one player to join.');
      break;
    }
    case 'skip':
      await db.rpc('fn_reveal', { p_pin: pin, p_force: true });
      break;
    case 'end':
      await db.rpc('fn_end', { p_pin: pin });
      break;
    case 'kick':
      if (typeof b.id === 'string') await db.from('players').delete().eq('pin', pin).eq('id', b.id);
      return NextResponse.json({ ok: true });
    default:
      return bad('bad_action', 'Unknown action.');
  }
  const view = await publish(pin);
  return NextResponse.json({ view });
}
