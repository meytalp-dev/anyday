-- AnyDay Database Schema v6 — BI foundations
-- Run in the Supabase SQL Editor AFTER v3+v4+v5 (idempotent — safe to re-run).
--
-- Why this file exists
-- -------------------
-- The BI direction (2026-09-01) turns a dashboard from an ephemeral view —
-- computed from a cookie's board selection on every request — into a thing an
-- organization OWNS several of: "דשבורד תורמים", "דשבורד תקציב", each with a
-- purpose, a widget composition, and a source. That needs three things the
-- schema does not have:
--
--   1. branding on the org row      — logo + brand color, shown on every
--                                     dashboard and in the digest email
--   2. a `dashboards` table         — the saved entity the wizard creates
--   3. a `board_preferences` table  — "מה חשוב לך" per source: the user's own
--                                     answers + calibration corrections
--                                     ("אצלנו אדום לא אומר סיכון"), the fix for
--                                     the strongest review finding (no trust
--                                     contract on the engine's guesses)
--
-- RLS follows the v5 shape exactly: read = any org member, write = admin +
-- member (never viewer). Branding lives ON organizations, so v5's
-- org_admins_update already makes it admin-only — no new policy needed there.

-- ============================================================
-- 0. Branding on the organization row (admin-only via v5)
-- ============================================================

alter table public.organizations add column if not exists logo_url text;
alter table public.organizations add column if not exists brand_color text;

-- ============================================================
-- 1. dashboards — the saved entity the wizard creates
-- ============================================================

create table if not exists public.dashboards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null,
  -- what the user typed in the wizard's first step, verbatim — kept so the
  -- dashboard can be regenerated/explained later ("למה הרכיב הזה כאן")
  purpose     text,
  -- 'monday' | 'sheet' — same honest split the product already makes
  source_kind text not null default 'monday',
  -- board ids (csv) for monday, sheet url for sheets
  source_ref  text,
  -- the widget composition: [{ kind, title, source, config }] — the engine
  -- renders FROM this; the AI only ever proposes it, the user approves it
  spec        jsonb not null default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.dashboards enable row level security;

drop policy if exists "dashboards_select" on public.dashboards;
create policy "dashboards_select" on public.dashboards
  for select
  using (org_id in (select public.current_user_org_ids()));

drop policy if exists "dashboards_insert" on public.dashboards;
create policy "dashboards_insert" on public.dashboards
  for insert
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "dashboards_update" on public.dashboards;
create policy "dashboards_update" on public.dashboards
  for update
  using (org_id in (select public.current_user_writer_org_ids()))
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "dashboards_delete" on public.dashboards;
create policy "dashboards_delete" on public.dashboards
  for delete
  using (org_id in (select public.current_user_writer_org_ids()));

-- ============================================================
-- 2. board_preferences — "מה חשוב לך" + calibration, per source
-- ============================================================

create table if not exists public.board_preferences (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  -- board id for monday, sheet url for sheets — one row per source per org
  source_ref text not null,
  -- { important_columns: [..], goals_text: "...",
  --   tone_overrides: { "<label>": "neutral" },  -- "אצלנו אדום לא אומר סיכון"
  --   muted_insights: [..] }                      -- "לא רלוונטי אצלנו"
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (org_id, source_ref)
);

alter table public.board_preferences enable row level security;

drop policy if exists "board_preferences_select" on public.board_preferences;
create policy "board_preferences_select" on public.board_preferences
  for select
  using (org_id in (select public.current_user_org_ids()));

drop policy if exists "board_preferences_insert" on public.board_preferences;
create policy "board_preferences_insert" on public.board_preferences
  for insert
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "board_preferences_update" on public.board_preferences;
create policy "board_preferences_update" on public.board_preferences
  for update
  using (org_id in (select public.current_user_writer_org_ids()))
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "board_preferences_delete" on public.board_preferences;
create policy "board_preferences_delete" on public.board_preferences
  for delete
  using (org_id in (select public.current_user_writer_org_ids()));

-- ============================================================
-- 3. Public storage bucket for org logos
-- ============================================================
-- Public READ is the point: the digest email embeds the logo by URL, and mail
-- clients fetch it with no credentials (they also block data: URIs, which is
-- why the logo cannot live inline in the organizations row). Writes go only
-- through /api/org/branding with the service key after an admin check — no
-- storage.objects policy is created, so the anon/authenticated roles cannot
-- write at all.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- ============================================================
-- 4. updated_at bookkeeping (idempotent trigger)
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dashboards_touch on public.dashboards;
create trigger dashboards_touch
  before update on public.dashboards
  for each row execute function public.touch_updated_at();

drop trigger if exists board_preferences_touch on public.board_preferences;
create trigger board_preferences_touch
  before update on public.board_preferences
  for each row execute function public.touch_updated_at();
