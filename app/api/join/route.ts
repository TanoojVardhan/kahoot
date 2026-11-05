import { randomBytes, randomUUID } from 'crypto';
import { sha, ip, bad, body, isPin, handle } from '@/lib/server';
import { backendFor, rate } from '@/lib/backend';

export const dynamic = 'force-dynamic';
const MAX_PLAYERS = 50;

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (!isPin(b.pin)) return bad('PIN must be 6 digits');
    // Limit is generous on purpose: a whole classroom often shares one public IP.
    if (!(await rate(b.pin, `join:${ip(req)}`, 200, 60))) return bad('Too many attempts. Wait a minute.', 429);
    const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) return bad('Enter a nickname');
    const be = backendFor(b.pin);
    const id = randomUUID();
    const token = randomBytes(24).toString('hex');
    const r = await be.join(b.pin, id, name, sha(token), MAX_PLAYERS);
    if (r.status === 'no_game') return bad('No game with that PIN', 404);
    if (r.status === 'full') return bad(`Game is full (${MAX_PLAYERS} players)`, 409);
    if (r.status === 'taken') return bad('That nickname is taken, pick another', 409);
    return Response.json({ id, token, room: r.room ?? null, name, backend: be.name });
  });
}
