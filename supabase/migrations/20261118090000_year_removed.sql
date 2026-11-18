-- Darren can take a game out of a year (PRD 7.5). The row stays as a manual tombstone so re-sync never brings it back.
alter table public.game_years add column removed boolean not null default false;
