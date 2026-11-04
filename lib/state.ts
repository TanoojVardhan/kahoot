import { db } from './server';

// Builds the view a client is allowed to see. Correct answers appear only in the reveal/ended phases.
export async function viewState(pin: string, opts: { host?: boolean; playerId?: string }) {
  const { data: g } = await db().from('games').select('*').eq('pin', pin).maybeSingle();
  if (!g) return null;
  const qs = g.quiz.questions;
  const out: any = {
    phase: g.phase, version: g.version, title: g.quiz.title,
    total: qs.length, qIndex: g.q_index, now: Date.now(),
  };
  const { data: players } = await db().from('players').select('id,name,choice,gained,score,streak').eq('pin', pin);
  const ps = players || [];
  out.count = ps.length;
  out.answered = ps.filter((p) => p.choice !== null).length;
  if (opts.host) out.names = ps.map((p) => p.name);

  if (g.phase === 'question' || g.phase === 'reveal') {
    const q = qs[g.q_index];
    out.question = { text: q.text, options: q.options, time: q.time };
    out.qEnd = new Date(g.q_end).getTime();
    out.qStart = new Date(g.q_start).getTime();
  }
  let results: any = null;
  if (g.phase === 'reveal' || g.phase === 'ended') {
    const { data: r } = await db().rpc('fn_result', { p_pin: pin });
    results = r;
    out.top = r?.top || [];
    if (g.phase === 'reveal') {
      out.correct = qs[g.q_index].correct;
      out.counts = r?.counts || [];
    }
  }
  if (opts.playerId) {
    const me = ps.find((p) => p.id === opts.playerId);
    if (me) {
      const row = results?.results?.[me.id]; // [gained, score, rank]
      out.me = {
        name: me.name, answered: me.choice !== null, choice: me.choice,
        score: row ? row[1] : me.score, gained: row ? row[0] : 0, rank: row ? row[2] : null,
        correct: g.phase === 'reveal' ? me.choice === qs[g.q_index].correct : null,
      };
    }
  }
  return out;
}
