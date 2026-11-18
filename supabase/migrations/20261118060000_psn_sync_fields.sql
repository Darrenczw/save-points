-- Fields psn-sync needs to update games incrementally.
alter table public.games
  add column psn_title_ids     text[] not null default '{}',   -- PS4/PS5 title ids merged into this game
  add column np_comm_id        text,                            -- trophy set id
  add column np_service        text check (np_service in ('trophy', 'trophy2')),
  add column trophy_synced_at  timestamptz;                     -- last time trophies were fetched

-- Server-side settings (connect key, cron key, owner id) live in Vault too; same helpers, own names.
create function public.sp_get_config(p_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'sp_cfg_' || p_name;
$$;
revoke all on function public.sp_get_config(text) from public, anon, authenticated;
grant execute on function public.sp_get_config(text) to service_role;
