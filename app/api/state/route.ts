import { sha, bad, body, isPin, handle } from '@/lib/server';
import { backendFor } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (!isPin(b.pin)) return bad('Bad PIN');
    const be = backendFor(b.pin);
    let who: { host?: boolean; playerId?: string; tokenHash?: string };
    if (b.hostToken) {
      if (!(await be.hostRoom(b.pin, sha(String(b.hostToken))))) return bad('Not authorised', 403);
      who = { host: true };
    } else if (b.id && b.token) {
      who = { playerId: String(b.id), tokenHash: sha(String(b.token)) };
    } else return bad('Not authorised', 403);
    const s = await be.view(b.pin, who);
    if (s === 'forbidden') return bad('Not authorised', 403);
    if (!s) return bad('Game not found', 404);
    return Response.json(s, { headers: { 'Cache-Control': 'no-store' } });
  });
}
