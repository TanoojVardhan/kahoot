import { broadcast, memLimit, limit } from './server';
import { supabaseBackend } from './supabaseBackend';
import { firebaseBackend } from './firebaseBackend';

export type JoinResult = { status: 'ok' | 'no_game' | 'full' | 'taken'; room?: string | null };

// Both databases implement this. Routes never talk to a database directly.
export interface Backend {
  name: 'supabase' | 'firebase';
  create(pin: string, room: string | null, hostHash: string, quiz: any): Promise<'ok' | 'exists'>;
  /** Returns { room } if hostHash matches this game's host, else null. */
  hostRoom(pin: string, hostHash: string): Promise<{ room: string | null } | null>;
  roomOf(pin: string): Promise<string | null>;
  join(pin: string, id: string, name: string, tokenHash: string, max: number): Promise<JoinResult>;
  view(pin: string, who: { host?: boolean; playerId?: string; tokenHash?: string }): Promise<any | null | 'forbidden'>;
  advance(pin: string): Promise<string>;
  answer(pin: string, id: string, tokenHash: string, choice: number): Promise<string>;
  reveal(pin: string, force: boolean): Promise<boolean>;
  end(pin: string): Promise<void>;
}

// PINs 900000-999999 live in Firebase, everything else in Supabase. The PIN alone says where a game is,
// so nothing has to ask a (possibly dead) Supabase "where is this game?".
export const isFirebasePin = (pin: string) => pin.startsWith('9');
export const backendFor = (pin: string): Backend => (isFirebasePin(pin) ? firebaseBackend : supabaseBackend);

// Firebase games never touch Supabase, not even for rate limiting.
export const rate = (pin: string, key: string, max: number, secs: number) =>
  isFirebasePin(pin) ? Promise.resolve(memLimit(key, max, secs)) : limit(key, max, secs);

export async function notify(be: Backend, pin: string) {
  const room = await be.roomOf(pin);
  if (room) await broadcast(room);
}
