import { sha, bad, body, isPin, handle } from '@/lib/server';
import { backendFor, notify } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (!isPin(b.pin) || !b.hostToken) return bad('Not authorised', 403);
    const be = backendFor(b.pin);
    if (!(await be.hostRoom(b.pin, sha(String(b.hostToken))))) return bad('Not authorised', 403);
    let result: any;
    if (b.action === 'next') result = await be.advance(b.pin);
    else if (b.action === 'reveal') { await be.reveal(b.pin, true); result = 'ok'; }
    else if (b.action === 'end') { await be.end(b.pin); result = 'ended'; }
    else return bad('Unknown action');
    await notify(be, b.pin);
    return Response.json({ result });
  });
}
