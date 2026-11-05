import { sha, bad, body, isPin, handle } from '@/lib/server';
import { backendFor, notify } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    const choice = Number(b.choice);
    if (!isPin(b.pin) || !b.id || !b.token || !Number.isInteger(choice)) return bad('Bad request');
    const be = backendFor(b.pin);
    // The backend re-checks the token and the answer window itself.
    const res = await be.answer(b.pin, String(b.id), sha(String(b.token)), choice);
    if (res === 'no_player') return bad('Not authorised', 403);
    if (res === 'all') {
      if (await be.reveal(b.pin, false)) await notify(be, b.pin);
    }
    return Response.json({ status: res });
  });
}
