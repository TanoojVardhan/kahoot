import { db, sha, bad, body, isPin, broadcast } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await body(req);
  const choice = Number(b.choice);
  if (!isPin(b.pin) || !b.id || !b.token || !Number.isInteger(choice)) return bad('Bad request');
  const { data: p } = await db().from('players').select('token_hash').eq('pin', b.pin).eq('id', String(b.id)).maybeSingle();
  if (!p || p.token_hash !== sha(String(b.token))) return bad('Not authorised', 403);
  // fn_answer re-checks the token hash itself and the answer window.
  const { data: res, error } = await db().rpc('fn_answer', { p_pin: b.pin, p_token_hash: sha(String(b.token)), p_choice: choice });
  if (error) { console.error('answer', error); return bad('Could not record answer', 500); }
  if (res === 'all') {
    const { data: r } = await db().rpc('fn_reveal', { p_pin: b.pin, p_force: false });
    if (r) {
      const { data: g } = await db().from('games').select('room').eq('pin', b.pin).maybeSingle();
      if (g) await broadcast(g.room);
    }
  }
  return Response.json({ status: res });
}
