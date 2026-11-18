-- Pairing codes: a signed-in device shows a 6-digit code; another device types it to sign in.
-- Only the `pair` edge function (service role) touches these tables.
create table public.device_codes (
  code_hash   text primary key,                 -- SHA-256 of the 6-digit code, never the code itself
  user_id     uuid not null references auth.users(id) on delete cascade,
  token_hash  text not null,                    -- one-time sign-in token from auth.admin.generateLink (no email sent)
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index device_codes_user_idx on public.device_codes (user_id);

create table public.pair_attempts (            -- failed redeem attempts, to stop guessing
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now()
);

alter table public.device_codes enable row level security;
alter table public.pair_attempts enable row level security;
revoke all on public.device_codes, public.pair_attempts from anon, authenticated;
