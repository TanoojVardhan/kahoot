'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, load, SHAPES } from '@/lib/client';
import { useGame } from '@/lib/useGame';
import { optionOrder, paceComment } from '@/lib/pace';
import HomeButton from '@/lib/HomeButton';

function Player({ pin, creds }: { pin: string; creds: any }) {
  const router = useRouter();
  const auth = useMemo(() => ({ id: creds.id, token: creds.token }), [creds.id, creds.token]);
  const { state: s, error, refresh, nowMs } = useGame(pin, auth, creds.room || undefined, creds.backend === 'firebase' ? 3000 : 5000, true);
  const [sending, setSending] = useState(false);
  const [localChoice, setLocalChoice] = useState<number | null>(null);
  const [aerr, setAerr] = useState('');
  // How long this player took, measured on their phone against the server's clock. Display only: never used for scoring.
  const [pace, setPace] = useState<{ secs: number; frac: number } | null>(null);

  useEffect(() => { setLocalChoice(null); setAerr(''); setPace(null); }, [s?.qIndex]);

  async function answer(i: number) {
    if (sending || localChoice !== null) return;
    setSending(true); setLocalChoice(i); setAerr('');
    if (s?.question) {
      const ms = Math.max(0, nowMs() - s.qStart);
      setPace({ secs: Math.round(ms / 100) / 10, frac: Math.min(1, ms / (s.question.time * 1000)) });
    }
    try { await post('/api/answer', { pin, id: creds.id, token: creds.token, choice: i }); await refresh(); }
    catch (e: any) { setAerr(e.message); setLocalChoice(null); setPace(null); }
    finally { setSending(false); }
  }

  if (!s) {
    return (
      <div className="center">
        {error ? <><div className="err">{error}</div><button onClick={() => router.push('/')}>Back</button></> : <p className="muted">Connecting…</p>}
      </div>
    );
  }
  const me = s.me;
  const home = (
    <HomeButton confirmText={s.phase === 'ended' ? undefined : "Leave the game? You won't be able to rejoin with your nickname."} />
  );

  if (s.phase === 'lobby') return (
    <div className="center">
      {home}
      <h1>You&apos;re in{(me?.name || creds.name) ? `, ${me?.name || creds.name}` : ''}!</h1>
      <p className="muted">{s.count} player{s.count === 1 ? '' : 's'} joined. Waiting for the host to start…</p>
    </div>
  );

  if (s.phase === 'question') {
    const total = s.question.time * 1000;
    const left = Math.max(0, s.qEnd - nowMs());
    const locked = localChoice !== null || me?.answered;
    return (
      <div className="wrap">
        {home}
        <div className="bar"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
          <span className="muted">Question {s.qIndex + 1} / {s.total}</span><span className="muted">{Math.ceil(left / 1000)}s</span>
        </div>
        <div className="q">{s.question.text}</div>
        {locked ? (
          <div className="center" style={{ minHeight: '40vh' }}>
            <h2>Answer locked in</h2>
            {pace && <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{paceComment(pace.frac)}</div>}
            {pace && <p className="muted">Answered in {pace.secs}s</p>}
            <p>Your score: <b>{me?.score ?? 0}</b></p>
            <p className="muted">Waiting for the others…</p>
          </div>
        ) : (
          <div className="opts">
            {/* Each player sees the options in their own order; colours and shapes follow the position. */}
            {optionOrder(s.question.options.length, creds.id, s.qIndex, pin).map((orig: number, pos: number) => (
              <button key={orig} className={`opt c${pos}`} disabled={sending || left <= 0} onClick={() => answer(orig)}>
                <span className="sh">{SHAPES[pos]}</span><span>{s.question.options[orig]}</span>
              </button>
            ))}
          </div>
        )}
        {aerr && <div className="err" style={{ marginTop: 10 }}>{aerr}</div>}
      </div>
    );
  }

  if (s.phase === 'reveal') {
    const correctText = s.question.options[s.correct];
    return (
      <div className="center">
        {home}
        {me?.answered ? (
          <h1 style={{ color: me.correct ? '#7ee27e' : '#ff8a99' }}>{me.correct ? 'Correct!' : 'Not quite'}</h1>
        ) : <h1 className="muted">Time ran out</h1>}
        {me?.answered && me.correct && pace && <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{paceComment(pace.frac)}</div>}
        {!me?.answered && <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>You were too slow!</div>}
        {!(me?.answered && me.correct) && <p>Correct answer: <b>{correctText}</b></p>}
        <div className="big">+{me?.gained ?? 0}</div>
        <p>Total score <b>{me?.score ?? 0}</b> · Rank #{me?.rank ?? '–'} of {s.count}</p>
        <p className="muted">Waiting for the next question…</p>
      </div>
    );
  }

  return (
    <div className="center">
      {home}
      <h1>Game over</h1>
      <div className="big">#{me?.rank ?? '–'}</div>
      <p>{me?.score ?? 0} points</p>
      <ol className="board">{(s.top || []).slice(0, 5).map((t: any, i: number) => <li key={i}><span>{i + 1}. {t.name}</span><b>{t.score}</b></li>)}</ol>
      <button onClick={() => router.push('/')}>Play again</button>
    </div>
  );
}

function PlayInner() {
  const router = useRouter();
  const pin = useSearchParams().get('pin') || '';
  const [creds, setCreds] = useState<any>(undefined);
  useEffect(() => {
    const c = load(`qp:${pin}`);
    if (!c) router.replace('/'); else setCreds(c);
  }, [pin, router]);
  if (!creds) return <div className="center"><p className="muted">Loading…</p></div>;
  return <Player pin={pin} creds={creds} />;
}

export default function PlayPage() {
  return <Suspense fallback={<div className="center"><p className="muted">Loading…</p></div>}><PlayInner /></Suspense>;
}
