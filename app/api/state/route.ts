import { db, sha, bad, body, isPin, hostGame } from '@/lib/server';
import { viewState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await body(req);
  if (!isPin(b.pin)) return bad('Bad PIN');
  let host = false;
  let playerId: string | undefined;
  if (b.hostToken) {
    if (!(await hostGame(b.pin, b.hostToken))) return bad('Not authorised', 403);
    host = true;
  } else if (b.id && b.token) {
    const { data } = await db().from('players').select('id,token_hash').eq('pin', b.pin).eq('id', String(b.id)).maybeSingle();
    if (!data || data.token_hash !== sha(String(b.token))) return bad('Not authorised', 403);
    playerId = data.id;
  } else return bad('Not authorised', 403);
  const s = await viewState(b.pin, { host, playerId });
  if (!s) return bad('Game not found', 404);
  return Response.json(s, { headers: { 'Cache-Control': 'no-store' } });
}
