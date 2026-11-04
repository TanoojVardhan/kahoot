'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, load, SHAPES } from '@/lib/client';
import { useGame } from '@/lib/useGame';

function Player({ pin, creds }: { pin: string; creds: any }) {
  const router = useRouter();
  const auth = useMemo(() => ({ id: creds.id, token: creds.token }), [creds.id, creds.token]);
  const { state: s, error, refresh, nowMs } = useGame(pin, auth, creds.room, 5000, true);
  const [sending, setSending] = useState(false);
  const [localChoice, setLocalChoice] = useState<number | null>(null);
  const [aerr, setAerr] = useState('');

  useEffect(() => { setLocalChoice(null); setAerr(''); }, [s?.qIndex]);

  async function answer(i: number) {
    if (sending || localChoice !== null) return;
    setSending(true); setLocalChoice(i); setAerr('');
    try { await post('/api/answer', { pin, id: creds.id, token: creds.token, choice: i }); await refresh(); }
    catch (e: any) { setAerr(e.message); setLocalChoice(null); }
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

  if (s.phase === 'lobby') return (
    <div className="center">
      <h1>You&apos;re in{me ? `, ${me.name}` : ''}!</h1>
      <p className="muted">{s.count} player{s.count === 1 ? '' : 's'} joined. Waiting for the host to start…</p>
    </div>
  );

  if (s.phase === 'question') {
    const total = s.question.time * 1000;
    const left = Math.max(0, s.qEnd - nowMs());
    const locked = localChoice !== null || me?.answered;
    return (
      <div className="wrap">
        <div className="bar"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
          <span className="muted">Question {s.qIndex + 1} / {s.total}</span><span className="muted">{Math.ceil(left / 1000)}s</span>
        </div>
        <div className="q">{s.question.text}</div>
        {locked ? (
          <div className="center" style={{ minHeight: '40vh' }}><h2>Answer locked in</h2><p className="muted">Waiting for others…</p></div>
        ) : (
          <div className="opts">
            {s.question.options.map((o: string, i: number) => (
              <button key={i} className={`opt c${i}`} disabled={sending || left <= 0} onClick={() => answer(i)}>
                <span className="sh">{SHAPES[i]}</span><span>{o}</span>
              </button>
            ))}
          </div>
        )}
        {aerr && <div className="err" style={{ marginTop: 10 }}>{aerr}</div>}
      </div>
    );
  }

  if (s.phase === 'reveal') return (
    <div className="center">
      {me?.answered ? (
        <h1 style={{ color: me.correct ? '#7ee27e' : '#ff8a99' }}>{me.correct ? 'Correct!' : 'Wrong'}</h1>
      ) : <h1 className="muted">Too slow</h1>}
      <div className="big">+{me?.gained ?? 0}</div>
      <p>Total {me?.score ?? 0} · Rank #{me?.rank ?? '–'} of {s.count}</p>
      <p className="muted">Waiting for the next question…</p>
    </div>
  );

  return (
    <div className="center">
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
