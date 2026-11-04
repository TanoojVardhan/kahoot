import { db, bad, body, hostGame, broadcast } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await body(req);
  const g = await hostGame(b.pin, b.hostToken);
  if (!g) return bad('Not authorised', 403);
  let result: any = null;
  if (b.action === 'next') {
    const { data, error } = await db().rpc('fn_advance', { p_pin: g.pin });
    if (error) { console.error('advance', error); return bad('Could not advance', 500); }
    result = data;
  } else if (b.action === 'reveal') {
    const { error } = await db().rpc('fn_reveal', { p_pin: g.pin, p_force: true });
    if (error) { console.error('reveal', error); return bad('Could not reveal', 500); }
    result = 'ok';
  } else if (b.action === 'end') {
    const { error } = await db().rpc('fn_end', { p_pin: g.pin });
    if (error) { console.error('end', error); return bad('Could not end', 500); }
    result = 'ended';
  } else return bad('Unknown action');
  await broadcast(g.room);
  return Response.json({ result });
}
