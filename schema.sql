-- Quizroom schema. Mirrors what is already applied to the Supabase "kahoot" project.
-- RLS is on with NO policies and function execute is revoked from anon/authenticated,
-- so only the server (service_role key) can touch the data. This keeps correct answers private.

create table if not exists public.games (
  pin text primary key,
  room text not null unique,
  host_hash text not null,
  quiz jsonb not null,
  phase text not null default 'lobby' check (phase in ('lobby','question','reveal','ended')),
  q_index int not null default -1,
  q_start timestamptz,
  q_end timestamptz,
  version int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id text primary key,
  pin text not null references public.games(pin) on delete cascade,
  name text not null,
  name_key text generated always as (lower(name)) stored,
  token_hash text not null,
  score int not null default 0,
  streak int not null default 0,
  choice int,
  pending int not null default 0,
  gained int not null default 0,
  created_at timestamptz not null default now(),
  unique (pin, name_key)
);
create index if not exists players_pin_token on public.players (pin, token_hash);

create table if not exists public.rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_at on public.rate_hits (key, at);
create index if not exists rate_hits_at on public.rate_hits (at);

alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.rate_hits enable row level security;

create or replace function public.fn_join(p_pin text, p_id text, p_name text, p_token_hash text, p_max integer)
returns jsonb language plpgsql as $$
declare g public.games; n int;
begin
  select * into g from public.games where pin = p_pin;
  if not found or g.phase = 'ended' then return jsonb_build_object('status','no_game'); end if;
  select count(*) into n from public.players where pin = p_pin;
  if n >= p_max then return jsonb_build_object('status','full'); end if;
  begin
    insert into public.players(id, pin, name, token_hash) values (p_id, p_pin, p_name, p_token_hash);
  exception when unique_violation then
    return jsonb_build_object('status','taken');
  end;
  return jsonb_build_object('status','ok','room',g.room);
end $$;

create or replace function public.fn_advance(p_pin text)
returns text language plpgsql as $$
declare g public.games; total int; t int;
begin
  select * into g from public.games where pin = p_pin for update;
  if not found then return 'no_game'; end if;
  total := jsonb_array_length(g.quiz->'questions');
  if g.phase = 'lobby' then
    if not exists (select 1 from public.players where pin = p_pin) then return 'no_players'; end if;
  elsif g.phase <> 'reveal' then
    return g.phase;
  end if;
  if g.q_index + 1 >= total then
    update public.games set phase = 'ended', version = version + 1 where pin = p_pin;
    return 'ended';
  end if;
  t := (g.quiz->'questions'->(g.q_index + 1)->>'time')::int;
  update public.players set choice = null, pending = 0, gained = 0 where pin = p_pin;
  update public.games
     set phase = 'question', q_index = g.q_index + 1,
         q_start = clock_timestamp(), q_end = clock_timestamp() + make_interval(secs => t),
         version = version + 1
   where pin = p_pin;
  return 'question';
end $$;

create or replace function public.fn_answer(p_pin text, p_token_hash text, p_choice integer)
returns text language plpgsql as $$
declare g public.games; p public.players; q jsonb; total numeric; elapsed numeric; pts int := 0; open_ct int;
begin
  select * into g from public.games where pin = p_pin for share;
  if not found then return 'no_game'; end if;
  if g.phase <> 'question' or clock_timestamp() > g.q_end + interval '600 milliseconds' then return 'closed'; end if;
  select * into p from public.players where pin = p_pin and token_hash = p_token_hash;
  if not found then return 'no_player'; end if;
  if p.choice is not null then return 'dup'; end if;
  q := g.quiz->'questions'->g.q_index;
  if p_choice < 0 or p_choice >= jsonb_array_length(q->'options') then return 'bad'; end if;
  if p_choice = (q->>'correct')::int then
    total   := (q->>'time')::numeric;
    elapsed := least(total, greatest(0, extract(epoch from (clock_timestamp() - g.q_start))));
    pts     := round(1000 * (1 - 0.5 * elapsed / total))::int + least(p.streak, 5) * 50;
  end if;
  update public.players set choice = p_choice, pending = pts where id = p.id and choice is null;
  perform pg_advisory_xact_lock(hashtext(p_pin));
  select count(*) into open_ct from public.players where pin = p_pin and choice is null;
  if open_ct = 0 then return 'all'; end if;
  return 'ok';
end $$;

create or replace function public.fn_result(p_pin text)
returns jsonb language sql stable as $$
  with g as (select quiz, q_index from public.games where pin = p_pin),
  k as (select jsonb_array_length(quiz->'questions'->q_index->'options') as n from g where q_index >= 0),
  ranked as (
    select id, score, gained, rank() over (order by score desc) as rk
      from public.players where pin = p_pin
  )
  select jsonb_build_object(
    'counts', coalesce((
      select jsonb_agg(coalesce(c.ct, 0) order by i.i)
        from k, generate_series(0, k.n - 1) as i(i)
        left join (select choice, count(*) as ct from public.players
                    where pin = p_pin and choice is not null group by choice) c on c.choice = i.i
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'score', score) order by score desc, name)
        from (select name, score from public.players where pin = p_pin order by score desc, name limit 10) t
    ), '[]'::jsonb),
    'results', coalesce((select jsonb_object_agg(id, jsonb_build_array(gained, score, rk)) from ranked), '{}'::jsonb),
    'of', (select count(*) from public.players where pin = p_pin)
  );
$$;

create or replace function public.fn_reveal(p_pin text, p_force boolean)
returns jsonb language plpgsql as $$
declare g public.games; open_ct int; due boolean;
begin
  select * into g from public.games where pin = p_pin for update;
  if not found or g.phase <> 'question' then return null; end if;
  select count(*) into open_ct from public.players where pin = p_pin and choice is null;
  due := clock_timestamp() >= g.q_end + interval '600 milliseconds';
  if not (p_force or due or open_ct = 0) then return null; end if;
  update public.players
     set score = score + pending, gained = pending,
         streak = case when pending > 0 then streak + 1 else 0 end
   where pin = p_pin;
  update public.games set phase = 'reveal', version = version + 1 where pin = p_pin;
  return public.fn_result(p_pin);
end $$;

create or replace function public.fn_end(p_pin text)
returns void language sql as $$
  update public.games set phase = 'ended', version = version + 1 where pin = p_pin and phase <> 'ended';
$$;

create or replace function public.rate_hit(p_key text, p_max integer, p_window integer)
returns boolean language plpgsql as $$
declare n int;
begin
  if random() < 0.02 then delete from public.rate_hits where at < now() - interval '1 hour'; end if;
  insert into public.rate_hits(key) values (p_key);
  select count(*) into n from public.rate_hits where key = p_key and at > now() - make_interval(secs => p_window);
  return n <= p_max;
end $$;

create or replace function public.rate_peek(p_key text, p_window integer)
returns integer language sql as $$
  select count(*)::int from public.rate_hits where key = p_key and at > now() - make_interval(secs => p_window);
$$;

revoke all on function public.fn_join, public.fn_advance, public.fn_answer, public.fn_result,
  public.fn_reveal, public.fn_end, public.rate_hit, public.rate_peek from public, anon, authenticated;
grant execute on function public.fn_join, public.fn_advance, public.fn_answer, public.fn_result,
  public.fn_reveal, public.fn_end, public.rate_hit, public.rate_peek to service_role;
