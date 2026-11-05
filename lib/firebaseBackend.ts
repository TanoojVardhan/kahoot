import { FieldValue } from 'firebase-admin/firestore';
import { fs } from './firebaseAdmin';
import type { Backend } from './backend';

// Data model (all access is server-side via the Admin SDK; Firestore rules deny every client):
//   games/{pin}                  game state, quiz (with answers), roster names, last result
//   games/{pin}/players/{id}     per-player score/streak and their answer for question q
//   games/{pin}/names/{hex}      uniqueness lock for case-insensitive nicknames
// A player's answer is valid only if player.q === game.qIndex, so no per-question reset pass is needed.

const G = (pin: string) => fs().collection('games').doc(pin);
const GRACE_MS = 600; // same answer grace window as the Supabase functions
const nameKey = (name: string) => Buffer.from(name.toLowerCase()).toString('hex');

type Row = { id: string; name: string; score: number; gained: number; choice: number | null };

function buildResult(ps: Row[], nOpts: number) {
  const counts: number[] = Array(nOpts).fill(0);
  ps.forEach((p) => { if (p.choice !== null && p.choice >= 0 && p.choice < nOpts) counts[p.choice]++; });
  const sorted = [...ps].sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const top = sorted.slice(0, 10).map((p) => ({ name: p.name, score: p.score }));
  const results: Record<string, any[]> = {};
  ps.forEach((p) => { results[p.id] = [p.gained, p.score, 1 + ps.filter((o) => o.score > p.score).length, p.choice]; });
  return { counts, top, results };
}

export const firebaseBackend: Backend = {
  name: 'firebase',

  async create(pin, _room, hostHash, quiz) {
    try {
      await G(pin).create({
        pin, hostHash, quiz, phase: 'lobby', qIndex: -1, qStart: null, qEnd: null, version: 0,
        playerCount: 0, names: [], result: null,
        createdAt: Date.now(),
        expireAt: new Date(Date.now() + 24 * 3600 * 1000), // optional Firestore TTL field, see README
      });
      return 'ok';
    } catch (e: any) {
      if (e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message))) return 'exists';
      throw e;
    }
  },

  async hostRoom(pin, hostHash) {
    const s = await G(pin).get();
    return s.exists && s.get('hostHash') === hostHash ? { room: null } : null;
  },

  async roomOf() { return null; }, // no realtime channel: clients poll

  async join(pin, id, name, tokenHash, max) {
    const gref = G(pin);
    const pref = gref.collection('players').doc(id);
    const nref = gref.collection('names').doc(nameKey(name));
    return fs().runTransaction(async (tx) => {
      const g = await tx.get(gref);
      if (!g.exists || g.get('phase') === 'ended') return { status: 'no_game' as const };
      if ((g.get('playerCount') || 0) >= max) return { status: 'full' as const };
      const n = await tx.get(nref);
      if (n.exists) return { status: 'taken' as const };
      tx.create(nref, { id });
      tx.create(pref, { name, tokenHash, score: 0, streak: 0, q: -1, choice: null, pending: 0, createdAt: Date.now() });
      tx.update(gref, { playerCount: FieldValue.increment(1), names: FieldValue.arrayUnion(name) });
      return { status: 'ok' as const, room: null };
    });
  },

  async view(pin, who) {
    const gs = await G(pin).get();
    if (!gs.exists) return null;
    const g: any = gs.data();
    const qs = g.quiz.questions;
    const out: any = {
      phase: g.phase, version: g.version, title: g.quiz.title, total: qs.length,
      qIndex: g.qIndex, now: Date.now(), count: g.playerCount || 0, answered: 0,
    };
    if (who.host) out.names = g.names || [];
    if (g.phase === 'question' || g.phase === 'reveal') {
      const q = qs[g.qIndex];
      out.question = { text: q.text, options: q.options, time: q.time };
      out.qEnd = g.qEnd; out.qStart = g.qStart;
    }
    const res = g.result;
    if (g.phase === 'question') {
      const c = await G(pin).collection('players').where('q', '==', g.qIndex).count().get();
      out.answered = c.data().count;
    }
    if (g.phase === 'reveal' || g.phase === 'ended') out.top = res?.top || [];
    if (g.phase === 'reveal') {
      out.correct = qs[g.qIndex].correct;
      out.counts = res?.counts || [];
      out.answered = (res?.counts || []).reduce((a: number, b: number) => a + b, 0);
    }
    if (who.playerId) {
      if (g.phase === 'question') {
        // The token is verified whenever we read the player's own doc.
        const ps = await G(pin).collection('players').doc(who.playerId).get();
        if (!ps.exists || ps.get('tokenHash') !== who.tokenHash) return 'forbidden';
        const answered = ps.get('q') === g.qIndex;
        out.me = { name: ps.get('name'), answered, choice: answered ? ps.get('choice') : null, score: ps.get('score'), gained: 0, rank: null, correct: null };
      } else {
        // Outside question phase the read is skipped to save quota; the id is an unguessable UUID and the
        // data returned is only that player's own row of the already-public result.
        const row = res?.results?.[who.playerId];
        if (row) {
          out.me = {
            answered: row[3] !== null, choice: row[3], score: row[1], gained: row[0], rank: row[2],
            correct: g.phase === 'reveal' ? row[3] === qs[g.qIndex].correct : null,
          };
        }
      }
    }
    return out;
  },

  async advance(pin) {
    const gref = G(pin);
    return fs().runTransaction(async (tx) => {
      const gs = await tx.get(gref);
      if (!gs.exists) return 'no_game';
      const d: any = gs.data();
      const total = d.quiz.questions.length;
      if (d.phase === 'lobby') { if (!(d.playerCount > 0)) return 'no_players'; }
      else if (d.phase !== 'reveal') return d.phase;
      if (d.qIndex + 1 >= total) {
        const ps = await tx.get(gref.collection('players'));
        const rows: Row[] = ps.docs.map((x) => ({ id: x.id, name: x.get('name'), score: x.get('score'), gained: 0, choice: null }));
        tx.update(gref, { phase: 'ended', version: FieldValue.increment(1), result: buildResult(rows, 0) });
        return 'ended';
      }
      const start = Date.now();
      const t = d.quiz.questions[d.qIndex + 1].time;
      tx.update(gref, { phase: 'question', qIndex: d.qIndex + 1, qStart: start, qEnd: start + t * 1000, version: FieldValue.increment(1) });
      return 'question';
    });
  },

  async answer(pin, id, tokenHash, choice) {
    const gref = G(pin);
    const pref = gref.collection('players').doc(id);
    const status = await fs().runTransaction(async (tx) => {
      const [gs, ps] = await Promise.all([tx.get(gref), tx.get(pref)]);
      if (!gs.exists) return 'no_game';
      const g: any = gs.data();
      if (g.phase !== 'question' || Date.now() > g.qEnd + GRACE_MS) return 'closed';
      if (!ps.exists || ps.get('tokenHash') !== tokenHash) return 'no_player';
      if (ps.get('q') === g.qIndex) return 'dup';
      const q = g.quiz.questions[g.qIndex];
      if (choice < 0 || choice >= q.options.length) return 'bad';
      let pts = 0;
      if (choice === q.correct) {
        const elapsed = Math.min(q.time, Math.max(0, (Date.now() - g.qStart) / 1000));
        pts = Math.round(1000 * (1 - (0.5 * elapsed) / q.time)) + Math.min(ps.get('streak') || 0, 5) * 50;
      }
      tx.update(pref, { q: g.qIndex, choice, pending: pts });
      return 'ok';
    });
    if (status !== 'ok') return status;
    // Everyone answered? (aggregate count, not a document scan)
    const gd: any = (await gref.get()).data();
    const c = await gref.collection('players').where('q', '==', gd.qIndex).count().get();
    return gd.phase === 'question' && c.data().count >= (gd.playerCount || 0) ? 'all' : 'ok';
  },

  async reveal(pin, force) {
    const gref = G(pin);
    // Cheap pre-check so a storm of "time is up" ticks doesn't open a transaction each.
    const pre: any = (await gref.get()).data();
    if (!pre || pre.phase !== 'question') return false;
    return fs().runTransaction(async (tx) => {
      const gs = await tx.get(gref);
      const g: any = gs.data();
      if (!g || g.phase !== 'question') return false;
      const pq = await tx.get(gref.collection('players'));
      const open = pq.docs.filter((d) => d.get('q') !== g.qIndex).length;
      const due = Date.now() >= g.qEnd + GRACE_MS;
      if (!(force || due || open === 0)) return false;
      const rows = pq.docs.map((d) => {
        const answered = d.get('q') === g.qIndex;
        const pts = answered ? d.get('pending') || 0 : 0;
        return { ref: d.ref, id: d.id, name: d.get('name') as string, score: (d.get('score') || 0) + pts, gained: pts, streak: pts > 0 ? (d.get('streak') || 0) + 1 : 0, choice: answered ? (d.get('choice') as number) : null };
      });
      rows.forEach((r) => tx.update(r.ref, { score: r.score, streak: r.streak }));
      tx.update(gref, { phase: 'reveal', version: FieldValue.increment(1), result: buildResult(rows, g.quiz.questions[g.qIndex].options.length) });
      return true;
    });
  },

  async end(pin) {
    const gref = G(pin);
    await fs().runTransaction(async (tx) => {
      const gs = await tx.get(gref);
      if (!gs.exists || gs.get('phase') === 'ended') return;
      const ps = await tx.get(gref.collection('players'));
      const rows: Row[] = ps.docs.map((x) => ({ id: x.id, name: x.get('name'), score: x.get('score'), gained: 0, choice: null }));
      tx.update(gref, { phase: 'ended', version: FieldValue.increment(1), result: buildResult(rows, 0) });
    });
  },
};
