import { randomBytes, randomInt } from 'crypto';
import { sha, ip, limit, bad, body, cleanQuiz, handle, withTimeout } from '@/lib/server';
import { supabaseBackend } from '@/lib/supabaseBackend';
import { firebaseBackend } from '@/lib/firebaseBackend';
import { firebaseConfigured } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req);
    if (!(await limit(`create:${ip(req)}`, 20, 3600))) return bad('Too many games created from this network. Try later.', 429);
    const quiz = cleanQuiz(b.quiz);
    if (typeof quiz === 'string') return bad(quiz);
    const hostToken = randomBytes(24).toString('hex');
    const hostHash = sha(hostToken);

    // Primary: Supabase, PINs 100000-899999.
    let primaryFailed = false;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        const pin = String(randomInt(100000, 900000));
        const room = randomBytes(12).toString('hex');
        const r = await withTimeout(supabaseBackend.create(pin, room, hostHash, quiz), 6000);
        if (r === 'ok') return Response.json({ pin, room, hostToken, backend: 'supabase' });
      }
      return bad('Could not allocate a PIN, try again', 503);
    } catch (e: any) {
      primaryFailed = true;
      console.error('Supabase unavailable, failing over to Firebase:', e?.message);
    }

    // Standby: Firebase, PINs 900000-999999. Only reached when Supabase threw or timed out.
    if (!primaryFailed) return bad('Could not create game', 500);
    if (!firebaseConfigured()) return bad('The main database is unavailable and the backup is not configured.', 503);
    for (let attempt = 0; attempt < 8; attempt++) {
      const pin = String(randomInt(900000, 1000000));
      const r = await firebaseBackend.create(pin, null, hostHash, quiz);
      if (r === 'ok') return Response.json({ pin, room: null, hostToken, backend: 'firebase' });
    }
    return bad('Could not allocate a PIN, try again', 503);
  });
}
