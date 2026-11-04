import { randomBytes, randomInt } from 'crypto';
import { db, sha, ip, limit, bad, body, cleanQuiz } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await body(req);
  if (!(await limit(`create:${ip(req)}`, 20, 3600))) return bad('Too many games created from this network. Try later.', 429);
  const quiz = cleanQuiz(b.quiz);
  if (typeof quiz === 'string') return bad(quiz);
  const hostToken = randomBytes(24).toString('hex');
  const room = randomBytes(12).toString('hex');
  for (let attempt = 0; attempt < 8; attempt++) {
    const pin = String(randomInt(100000, 1000000));
    const { error } = await db().from('games').insert({ pin, room, host_hash: sha(hostToken), quiz });
    if (!error) return Response.json({ pin, room, hostToken });
    if (error.code !== '23505') { console.error('create', error); return bad('Could not create game', 500); }
  }
  return bad('Could not allocate a PIN, try again', 503);
}
