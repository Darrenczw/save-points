-- Save Points: initial schema. One user, every row owned by user_id, row-level security everywhere.

-- ---------------------------------------------------------------- games
create table public.games (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  psn_concept_id  text,
  name            text not null check (length(name) between 1 and 200),
  platforms       text[] not null default '{}',
  cover_url       text,
  hero_url        text,
  first_played    date,
  last_played     date,
  total_hours     numeric(8,2) not null default 0 check (total_hours >= 0),
  play_count      integer,
  source          text not null default 'psn' check (source in ('psn', 'manual')),
  hidden          boolean not null default false,
  tried_override  boolean,                 -- null = automatic (< 1 h goes to Tried)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, psn_concept_id)
);
create index games_user_idx on public.games (user_id);

-- ---------------------------------------------------------------- years a game appears in
create table public.game_years (
  game_id       uuid not null references public.games(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year          smallint not null check (year between 1990 and 2100),
  label         text not null check (label in ('Played', 'Continued', 'Replayed', 'Brief visit')),
  is_main       boolean not null default false,
  est_hours     numeric(8,2) not null default 0,
  label_source  text not null default 'auto' check (label_source in ('auto', 'manual')),
  primary key (game_id, year)
);
create index game_years_user_idx on public.game_years (user_id);

-- ---------------------------------------------------------------- raw trophy evidence per year
create table public.trophy_years (
  game_id   uuid not null references public.games(id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year      smallint not null,
  trophies  integer not null check (trophies >= 0),
  primary key (game_id, year)
);
create index trophy_years_user_idx on public.trophy_years (user_id);

-- ---------------------------------------------------------------- hours over time (exact per-period hours from the first sync on)
create table public.hour_snapshots (
  id           bigint generated always as identity primary key,
  game_id      uuid not null references public.games(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  taken_at     timestamptz not null default now(),
  total_hours  numeric(8,2) not null
);
create index hour_snapshots_game_idx on public.hour_snapshots (game_id, taken_at);
create index hour_snapshots_user_idx on public.hour_snapshots (user_id);

-- ---------------------------------------------------------------- ratings
create table public.ratings (
  game_id     uuid primary key references public.games(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  overall     numeric(2,1) check (overall between 0.5 and 5 and overall * 2 = floor(overall * 2)),
  story       smallint check (story between 1 and 5),
  gameplay    smallint check (gameplay between 1 and 5),
  music       smallint check (music between 1 and 5),
  atmosphere  smallint check (atmosphere between 1 and 5),
  updated_at  timestamptz not null default now()
);
create index ratings_user_idx on public.ratings (user_id);

-- ---------------------------------------------------------------- PSN connection (secrets live in Vault; the app sees status only)
create table public.psn_link (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  npsso_secret_id     uuid,
  refresh_secret_id   uuid,
  refresh_expires_at  timestamptz,
  connected_at        timestamptz,
  last_sync_at        timestamptz,
  last_sync_status    text check (last_sync_status in ('ok', 'running', 'failed', 'expired')),
  last_sync_error     text
);

-- ---------------------------------------------------------------- updated_at
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger games_touch before update on public.games for each row execute function public.touch_updated_at();
create trigger ratings_touch before update on public.ratings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- row-level security
alter table public.games          enable row level security;
alter table public.game_years     enable row level security;
alter table public.trophy_years   enable row level security;
alter table public.hour_snapshots enable row level security;
alter table public.ratings        enable row level security;
alter table public.psn_link       enable row level security;

create policy own_games on public.games for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_years on public.game_years for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_trophies on public.trophy_years for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_snapshots on public.hour_snapshots for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_ratings on public.ratings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_link on public.psn_link for select to authenticated
  using (user_id = (select auth.uid()));

-- The app may read connection status, never the secret ids.
revoke all on public.psn_link from anon, authenticated;
grant select (user_id, refresh_expires_at, connected_at, last_sync_at, last_sync_status, last_sync_error)
  on public.psn_link to authenticated;
revoke all on public.games, public.game_years, public.trophy_years, public.hour_snapshots, public.ratings from anon;

-- ---------------------------------------------------------------- Vault helpers (server code only)
create function public.sp_set_secret(p_user uuid, p_kind text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text := 'sp_' || p_kind || '_' || p_user::text;
begin
  if p_kind not in ('npsso', 'refresh') then raise exception 'bad kind'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    v_id := vault.create_secret(p_value, v_name, 'Save Points PSN ' || p_kind);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
  insert into public.psn_link (user_id) values (p_user) on conflict (user_id) do nothing;
  if p_kind = 'npsso' then update public.psn_link set npsso_secret_id = v_id, connected_at = now() where user_id = p_user;
  else update public.psn_link set refresh_secret_id = v_id where user_id = p_user; end if;
end $$;

create function public.sp_get_secret(p_user uuid, p_kind text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'sp_' || p_kind || '_' || p_user::text;
$$;

create function public.sp_forget_psn(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where name in ('sp_npsso_' || p_user::text, 'sp_refresh_' || p_user::text);
  update public.psn_link set npsso_secret_id = null, refresh_secret_id = null, refresh_expires_at = null,
    last_sync_status = null where user_id = p_user;
end $$;

revoke all on function public.sp_set_secret(uuid, text, text), public.sp_get_secret(uuid, text), public.sp_forget_psn(uuid)
  from public, anon, authenticated;
grant execute on function public.sp_set_secret(uuid, text, text), public.sp_get_secret(uuid, text), public.sp_forget_psn(uuid)
  to service_role;
