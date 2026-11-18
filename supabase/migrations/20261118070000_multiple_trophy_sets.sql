-- A game can have more than one trophy list (e.g. PS4 original + PS5 remaster). Keep them all.
alter table public.games add column np_sets jsonb not null default '[]'::jsonb;  -- [{ "id": "NPWR…", "svc": "trophy" | "trophy2" }]
update public.games set np_sets = jsonb_build_array(jsonb_build_object('id', np_comm_id, 'svc', np_service)) where np_comm_id is not null;
alter table public.games drop column np_comm_id, drop column np_service;
