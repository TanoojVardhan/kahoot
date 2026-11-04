import { randomBytes, randomUUID } from 'crypto';
import { db, sha, ip, limit, bad, body, isPin } from '@/lib/server';

export const dynamic = 'force-dynamic';
const MAX_PLAYERS = 50;

export async function POST(req: Request) {
  const b = await body(req);
  // Limit is generous on purpose: a whole classroom often shares one public IP.
  if (!(await limit(`join:${ip(req)}`, 200, 60))) return bad('Too many attempts. Wait a minute.', 429);
  if (!isPin(b.pin)) return bad('PIN must be 6 digits');
  const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) return bad('Enter a nickname');
  const id = randomUUID();
  const token = randomBytes(24).toString('hex');
  const { data, error } = await db().rpc('fn_join', { p_pin: b.pin, p_id: id, p_name: name, p_token_hash: sha(token), p_max: MAX_PLAYERS });
  if (error) { console.error('join', error); return bad('Could not join', 500); }
  if (data.status === 'no_game') return bad('No game with that PIN', 404);
  if (data.status === 'full') return bad(`Game is full (${MAX_PLAYERS} players)`, 409);
  if (data.status === 'taken') return bad('That nickname is taken, pick another', 409);
  return Response.json({ id, token, room: data.room, name });
}
