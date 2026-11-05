import { bad, body, isPin, handle } from '@/lib/server';
import { backendFor, notify, rate } from '@/lib/backend';

export const dynamic = 'force-dynamic';

// Any client may call this when the timer has run out. The backend only acts if the question is really due.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (!isPin(b.pin)) return bad('Bad PIN');
    if (!(await rate(b.pin, `tick:${b.pin}`, 300, 60))) return Response.json({ revealed: false, limited: true });
    const be = backendFor(b.pin);
    const revealed = await be.reveal(b.pin, false);
    if (revealed) await notify(be, b.pin);
    return Response.json({ revealed });
  });
}
