'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { post, save } from '@/lib/client';

export default function Home() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // The host's QR code opens /?pin=123456 so players only have to type a nickname.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('pin');
      if (p && /^\d{6}$/.test(p)) { setPin(p); setPrefilled(true); }
    } catch {}
  }, []);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await post('/api/join', { pin, name });
      save(`qp:${pin}`, r);
      router.push(`/play?pin=${pin}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="center">
      <h1>Quizroom</h1>
      <form onSubmit={join} className="card" style={{ width: '100%', maxWidth: 360, display: 'grid', gap: 10 }}>
        <input inputMode="numeric" pattern="\d{6}" maxLength={6} placeholder="Game PIN" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label="Game PIN" />
        <input autoFocus={prefilled} maxLength={20} placeholder="Nickname" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nickname" />
        <button disabled={busy || pin.length !== 6 || !name.trim()}>{busy ? 'Joining…' : 'Join game'}</button>
        {err && <div className="err">{err}</div>}
      </form>
      <a href="/host">Host a quiz</a>
    </div>
  );
}
