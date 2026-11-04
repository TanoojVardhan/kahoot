import { db, bad, body, isPin, limit, broadcast } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Any client may call this when the timer has run out. fn_reveal only acts if the question is really due.
export async function POST(req: Request) {
  const b = await body(req);
  if (!isPin(b.pin)) return bad('Bad PIN');
  if (!(await limit(`tick:${b.pin}`, 300, 60))) return Response.json({ revealed: false, limited: true });
  const { data, error } = await db().rpc('fn_reveal', { p_pin: b.pin, p_force: false });
  if (error) { console.error('tick', error); return bad('tick failed', 500); }
  if (data) {
    const { data: g } = await db().from('games').select('room').eq('pin', b.pin).maybeSingle();
    if (g) await broadcast(g.room);
  }
  return Response.json({ revealed: !!data });
}
