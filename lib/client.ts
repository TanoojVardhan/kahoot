export async function post(url: string, data: any): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), cache: 'no-store' });
  let j: any = {};
  try { j = await res.json(); } catch {}
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

export function load<T = any>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function save(key: string, v: any) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
export function drop(key: string) { try { localStorage.removeItem(key); } catch {} }

export const SHAPES = ['▲', '◆', '●', '■'];
