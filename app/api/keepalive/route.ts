import { db, bad } from '@/lib/server';
import { firebaseConfigured, fs } from '@/lib/firebaseAdmin';

export const dynamic = 'force-dynamic';

// Called daily by Vercel Cron (see vercel.json) so the free Supabase project does not go idle and pause.
// If CRON_SECRET is set, Vercel sends it automatically and anything else is rejected.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return bad('Unauthorized', 401);
  const out: any = {};
  try {
    const { error } = await db().from('games').select('pin').limit(1);
    out.supabase = error ? `error: ${error.message}` : 'ok';
  } catch (e: any) { out.supabase = `error: ${e.message}`; }
  if (firebaseConfigured()) {
    try { await fs().collection('games').limit(1).get(); out.firebase = 'ok'; }
    catch (e: any) { out.firebase = `error: ${e.message}`; }
  }
  return Response.json(out);
}
