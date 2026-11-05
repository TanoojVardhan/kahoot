// Per-player option shuffle and answer-pace comments. Pure functions, no server involvement.
// The server only ever sees the ORIGINAL option index, so scoring and answer privacy are unchanged.

function seedOf(str: string): number { // FNV-1a, 32 bit
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Display order of option indexes for one player on one question. Stable across refreshes. */
export function optionOrder(n: number, playerId: string, qIndex: number, pin: string): number[] {
  const rnd = mulberry32(seedOf(`${pin}:${playerId}:${qIndex}`));
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** frac = time taken / time allowed (0 = instant, 1 = at the buzzer). */
export function paceComment(frac: number): string {
  if (frac < 0.2) return 'Lightning fast!';
  if (frac < 0.45) return 'Good pace';
  if (frac < 0.75) return 'Taking your time';
  return 'That was slow. Speed up next time!';
}
