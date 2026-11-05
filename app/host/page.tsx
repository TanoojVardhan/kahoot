'use client';
import { useEffect, useMemo, useState } from 'react';
import { post, load, save, drop, SHAPES } from '@/lib/client';
import { useGame } from '@/lib/useGame';
import { parseQuizFile } from '@/lib/excel';

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
  const [importErrs, setImportErrs] = useState<string[]>([]);
  const [importOk, setImportOk] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after fixing it
    if (!f) return;
    setImportErrs([]); setImportOk('');
    if (f.size > 2_000_000) { setImportErrs(['That file is larger than 2 MB.']); return; }
    try {
      const r = await parseQuizFile(f);
      if (r.questions.length === 0) {
        setImportErrs(r.errors.length ? ['Nothing was imported.', ...r.errors.slice(0, 12)] : ['No questions found in that file.']);
        return;
      }
      const hasContent = qs.some((q) => q.text.trim() || q.options.some((o) => o.trim()));
      if (hasContent && !confirm(`Replace your current ${qs.length} question(s) with the ${r.questions.length} valid one(s) from this file?`)) return;
      setQs(r.questions);
      const skipped = r.errors.length;
      setImportOk(`Imported ${r.questions.length} question${r.questions.length === 1 ? '' : 's'} from ${f.name}.`);
      if (skipped) {
        setImportErrs([
          `${skipped} row${skipped === 1 ? ' was' : 's were'} NOT imported. Add ${skipped === 1 ? 'it' : 'them'} yourself with "+ Add question" below, or fix the file and upload again:`,
          ...r.errors.slice(0, 12).concat(skipped > 12 ? [`…and ${skipped - 12} more`] : []),
        ]);
      }
    } catch {
      setImportErrs(['Could not read that file. Use the template and save it as .xlsx.']);
    }
  }

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
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row">
          <b className="grow">Import from Excel</b>
          <a href="/quiz-template.xlsx" download="quiz-template.xlsx">Download template</a>
          <label style={{ cursor: 'pointer' }}>
            <span className="ghost" style={{ display: 'inline-block', padding: '10px 16px', borderRadius: 10, border: '2px solid #4b3f78', fontWeight: 700 }}>Upload .xlsx</span>
            <input type="file" accept=".xlsx" onChange={onFile} style={{ display: 'none' }} />
          </label>
        </div>
        {importOk && <p style={{ color: '#7ee27e', margin: '10px 0 0' }}>{importOk}</p>}
        {importErrs.length > 0 && (
          <div className="err" style={{ marginTop: 10 }}>
            <b>{importErrs[0]}</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{importErrs.slice(1).map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
      </div>
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

function JoinQR({ pin }: { pin: string }) {
  const [src, setSrc] = useState('');
  const url = typeof window !== 'undefined' ? `${window.location.origin}/?pin=${pin}` : '';
  useEffect(() => {
    let live = true;
    if (!url) return;
    (async () => {
      try {
        const mod: any = await import('qrcode');
        const toDataURL = mod.toDataURL || mod.default?.toDataURL;
        const d = await toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
        if (live) setSrc(d);
      } catch {}
    })();
    return () => { live = false; };
  }, [url]);
  if (!src) return null;
  return (
    <div style={{ textAlign: 'center' }}>
      <img src={src} width={200} height={200} alt={`QR code to join game ${pin}`} style={{ background: '#fff', borderRadius: 12 }} />
      <div className="muted" style={{ fontSize: '.85rem', marginTop: 4 }}>Scan to join</div>
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
      <JoinQR pin={pin} />
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
