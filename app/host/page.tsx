'use client';
import { useEffect, useMemo, useState } from 'react';
import { post, load, save, drop, SHAPES } from '@/lib/client';
import { useGame } from '@/lib/useGame';

type Q = { text: string; options: string[]; correct: number; time: number };
const blank = (): Q => ({ text: '', options: ['', '', '', ''], correct: 0, time: 20 });
const SAMPLE = {
  title: 'Sample quiz',
  questions: [
    { text: 'What is 7 x 8?', options: ['54', '56', '58', '64'], correct: 1, time: 15 },
    { text: 'Capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], correct: 2, time: 20 },
    { text: 'Which is a prime number?', options: ['21', '27', '29', '33'], correct: 2, time: 20 },
  ],
};

function Editor({ onCreated }: { onCreated: (c: any) => void }) {
  const [title, setTitle] = useState('My quiz');
  const [qs, setQs] = useState<Q[]>([blank()]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = load('qh:draft');
    if (d && Array.isArray(d.questions) && d.questions.length) { setTitle(d.title || 'My quiz'); setQs(d.questions); }
  }, []);
  useEffect(() => { save('qh:draft', { title, questions: qs }); }, [title, qs]);

  const upd = (i: number, patch: Partial<Q>) => setQs((a) => a.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setOpt = (i: number, k: number, v: string) => setQs((a) => a.map((q, j) => (j === i ? { ...q, options: q.options.map((o, m) => (m === k ? v : o)) } : q)));

  async function create() {
    setBusy(true); setErr('');
    try {
      const r = await post('/api/create', { quiz: { title, questions: qs } });
      const c = { pin: r.pin, room: r.room, hostToken: r.hostToken, backend: r.backend };
      save(`qh:${r.pin}`, c); save('qh:last', r.pin);
      onCreated(c);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Host a quiz</h1>
        <button className="ghost" onClick={() => { setTitle(SAMPLE.title); setQs(SAMPLE.questions); }}>Load sample</button>
      </div>
      <p className="muted">Up to 50 players. Leave an option blank to use fewer than 4.</p>
      <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Quiz title" style={{ marginBottom: 12 }} />
      {qs.map((q, i) => (
        <div className="qedit" key={i}>
          <div className="row">
            <b>Question {i + 1}</b>
            <span className="grow" />
            <button className="ghost" disabled={qs.length === 1} onClick={() => setQs((a) => a.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <input value={q.text} maxLength={300} placeholder="Question text" onChange={(e) => upd(i, { text: e.target.value })} />
          <div className="two">
            {q.options.map((o, k) => (
              <input key={k} value={o} maxLength={120} placeholder={`${SHAPES[k]} Option ${k + 1}`} onChange={(e) => setOpt(i, k, e.target.value)} />
            ))}
          </div>
          <div className="two">
            <label>Correct answer
              <select value={q.correct} onChange={(e) => upd(i, { correct: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((k) => <option key={k} value={k}>{SHAPES[k]} Option {k + 1}</option>)}
              </select>
            </label>
            <label>Seconds
              <select value={q.time} onChange={(e) => upd(i, { time: Number(e.target.value) })}>
                {[10, 15, 20, 30, 45, 60, 90, 120].map((t) => <option key={t} value={t}>{t}s</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
      <div className="row">
        <button className="ghost" disabled={qs.length >= 60} onClick={() => setQs((a) => [...a, blank()])}>+ Add question</button>
        <span className="grow" />
        <button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create game'}</button>
      </div>
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  );
}

function Controller({ creds, onExit }: { creds: any; onExit: () => void }) {
  const { pin, hostToken, room, backend } = creds;
  const auth = useMemo(() => ({ hostToken }), [hostToken]);
  const { state: s, error, refresh, nowMs } = useGame(pin, auth, room || undefined, 2500, false);
  const [busy, setBusy] = useState(false);
  const [aerr, setAerr] = useState('');

  async function act(action: 'next' | 'reveal' | 'end') {
    setBusy(true); setAerr('');
    try { await post('/api/host', { pin, hostToken, action }); await refresh(); }
    catch (e: any) { setAerr(e.message); }
    finally { setBusy(false); }
  }

  if (!s) return <div className="center">{error ? <><div className="err">{error}</div><button onClick={onExit}>Back</button></> : <p className="muted">Loading…</p>}</div>;

  const origin = typeof window !== 'undefined' ? window.location.host : '';
  const footer = (
    <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
      {s.phase !== 'ended' && <button className="danger" disabled={busy} onClick={() => { if (confirm('End the game for everyone?')) act('end'); }}>End game</button>}
      {aerr && <span className="err">{aerr}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );

  if (s.phase === 'lobby') return (
    <div className="center">
      {backend === 'firebase' && <div className="err">Backup server in use: the main database was unavailable when this game was created.</div>}
      <p className="muted">Join at <b>{origin}</b> with PIN</p>
      <div className="pin">{pin}</div>
      <p>{s.count} / 50 joined</p>
      <div className="chips" style={{ maxWidth: 700 }}>{(s.names || []).map((n: string) => <span className="chip" key={n}>{n}</span>)}</div>
      <button disabled={busy || s.count === 0} onClick={() => act('next')}>Start game</button>
      {footer}
    </div>
  );

  if (s.phase === 'question') {
    const total = s.question.time * 1000;
    const left = Math.max(0, s.qEnd - nowMs());
    return (
      <div className="wrap">
        <div className="bar"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
        <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0' }}>
          <span className="muted">Question {s.qIndex + 1} / {s.total}</span>
          <span>{Math.ceil(left / 1000)}s · {s.answered} / {s.count} answered</span>
        </div>
        <div className="q">{s.question.text}</div>
        <div className="opts">
          {s.question.options.map((o: string, i: number) => <div key={i} className={`opt c${i}`}><span className="sh">{SHAPES[i]}</span><span>{o}</span></div>)}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button disabled={busy} onClick={() => act('reveal')}>Show results now</button>
        </div>
        {footer}
      </div>
    );
  }

  if (s.phase === 'reveal') {
    const counts: number[] = s.counts || [];
    const max = Math.max(1, ...counts);
    const last = s.qIndex + 1 >= s.total;
    return (
      <div className="wrap" style={{ textAlign: 'center' }}>
        <div className="q">{s.question.text}</div>
        <div className="hist">
          {s.question.options.map((o: string, i: number) => (
            <div key={i} style={{ opacity: i === s.correct ? 1 : 0.45 }}>
              <b>{counts[i] || 0}</b>
              <div className={`b c${i}`} style={{ height: `${((counts[i] || 0) / max) * 100}%` }} />
              <span>{SHAPES[i]}{i === s.correct ? ' ✓' : ''}</span>
            </div>
          ))}
        </div>
        <p className="muted">Correct: {s.question.options[s.correct]}</p>
        <h2>Top players</h2>
        <ol className="board" style={{ margin: '0 auto' }}>{(s.top || []).slice(0, 5).map((t: any, i: number) => <li key={i}><span>{i + 1}. {t.name}</span><b>{t.score}</b></li>)}</ol>
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <button disabled={busy} onClick={() => act('next')}>{last ? 'Finish' : 'Next question'}</button>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="center">
      <h1>Final results</h1>
      <ol className="board">{(s.top || []).map((t: any, i: number) => <li key={i}><span>{i + 1}. {t.name}</span><b>{t.score}</b></li>)}</ol>
      <button onClick={() => { drop(`qh:${pin}`); drop('qh:last'); onExit(); }}>New game</button>
    </div>
  );
}

export default function HostPage() {
  const [creds, setCreds] = useState<any>(null);
  const [resume, setResume] = useState<any>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const last = load<string>('qh:last');
    if (last) { const c = load(`qh:${last}`); if (c) setResume(c); }
    setReady(true);
  }, []);
  if (!ready) return null;
  if (creds) return <Controller creds={creds} onExit={() => { setCreds(null); setResume(null); }} />;
  return (
    <>
      {resume && (
        <div className="wrap" style={{ paddingBottom: 0 }}>
          <div className="card row">
            <span className="grow">A game is in progress (PIN {resume.pin}).</span>
            <button onClick={() => setCreds(resume)}>Resume</button>
            <button className="ghost" onClick={() => { drop(`qh:${resume.pin}`); drop('qh:last'); setResume(null); }}>Discard</button>
          </div>
        </div>
      )}
      <Editor onCreated={setCreds} />
    </>
  );
}
