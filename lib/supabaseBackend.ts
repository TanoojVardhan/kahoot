import { db } from './server';
import { viewState } from './state';
import type { Backend } from './backend';

export const supabaseBackend: Backend = {
  name: 'supabase',

  async create(pin, room, hostHash, quiz) {
    const { error } = await db().from('games').insert({ pin, room, host_hash: hostHash, quiz });
    if (!error) return 'ok';
    if (error.code === '23505') return 'exists';
    throw new Error(`supabase create: ${error.message}`);
  },

  async hostRoom(pin, hostHash) {
    const { data, error } = await db().from('games').select('room,host_hash').eq('pin', pin).maybeSingle();
    if (error) throw new Error(error.message);
    return data && data.host_hash === hostHash ? { room: data.room } : null;
  },

  async roomOf(pin) {
    const { data } = await db().from('games').select('room').eq('pin', pin).maybeSingle();
    return data?.room ?? null;
  },

  async join(pin, id, name, tokenHash, max) {
    const { data, error } = await db().rpc('fn_join', { p_pin: pin, p_id: id, p_name: name, p_token_hash: tokenHash, p_max: max });
    if (error) throw new Error(error.message);
    return { status: data.status, room: data.room ?? null };
  },

  async view(pin, who) {
    if (who.playerId) {
      const { data } = await db().from('players').select('id,token_hash').eq('pin', pin).eq('id', who.playerId).maybeSingle();
      if (!data || data.token_hash !== who.tokenHash) return 'forbidden';
    }
    return viewState(pin, { host: who.host, playerId: who.playerId });
  },

  async advance(pin) {
    const { data, error } = await db().rpc('fn_advance', { p_pin: pin });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async answer(pin, _id, tokenHash, choice) {
    const { data, error } = await db().rpc('fn_answer', { p_pin: pin, p_token_hash: tokenHash, p_choice: choice });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async reveal(pin, force) {
    const { data, error } = await db().rpc('fn_reveal', { p_pin: pin, p_force: force });
    if (error) throw new Error(error.message);
    return !!data;
  },

  async end(pin) {
    const { error } = await db().rpc('fn_end', { p_pin: pin });
    if (error) throw new Error(error.message);
  },
};
