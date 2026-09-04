-- ============================================================
-- AnyDay schema v7 — saved spreadsheets, so automations can run on them
-- ============================================================
--
-- Run AFTER v5 and v6. Idempotent: safe to run twice.
--
-- WHY THIS TABLE EXISTS (הכרעת מיטל 4.9)
-- An automation does not need to WRITE anywhere. It needs to READ when nobody
-- is looking — the weekly digest fires on Sunday at 05:00 with no browser
-- open. A Monday board can be re-read then, because the server holds a token.
-- A Google Sheets link can be re-read too. But a file someone dragged into a
-- tab exists ONLY in that tab, and vanishes when it closes.
--
-- So saving a dashboard built from a sheet means saving the sheet. This table
-- is that, and nothing more.
--
-- WHAT IS STORED, AND WHAT IS NOT
-- Browsing /sheet stores NOTHING: the file is read, charted and forgotten in
-- the browser, exactly as before. A row appears here only when a person
-- deliberately SAVES a dashboard, and the screen says in those words that the
-- data will be stored. Deleting the dashboard deletes this with it.
--
-- The raw sheet text is stored, not parsed rows: one parser in the system
-- (sheet-to-board), and the user's type corrections survive a refetch because
-- column ids are positional.

create table if not exists public.sheet_sources (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  title       text not null,
  -- 'file'  — uploaded once; the stored csv IS the data, forever
  -- 'link'  — a Google Sheets url; the csv is the last read, refreshable
  kind        text not null default 'file',
  -- Google Sheets url, for 'link' only. Validated against the same SSRF rule
  -- that guards the live fetch: a link we would refuse to read is never stored.
  url         text,
  -- the sheet's raw text, capped in the API at 2MB (browsing allows 20MB —
  -- storage is not a disk)
  csv         text not null,
  -- column id -> the type the user corrected it to, so a refetch keeps it
  type_overrides jsonb not null default '{}'::jsonb,
  -- when the csv was last read from the source ('link'), or uploaded ('file')
  fetched_at  timestamptz not null default now(),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sheet_sources_org_idx on public.sheet_sources (org_id, created_at desc);

alter table public.sheet_sources enable row level security;

-- Same shape as dashboards: members read, writers write. The wall is here;
-- the checks in the API make it a clear 403 instead of an empty result.
drop policy if exists "sheet_sources_select" on public.sheet_sources;
create policy "sheet_sources_select" on public.sheet_sources
  for select
  using (org_id in (select public.current_user_org_ids()));

drop policy if exists "sheet_sources_insert" on public.sheet_sources;
create policy "sheet_sources_insert" on public.sheet_sources
  for insert
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "sheet_sources_update" on public.sheet_sources;
create policy "sheet_sources_update" on public.sheet_sources
  for update
  using (org_id in (select public.current_user_writer_org_ids()))
  with check (org_id in (select public.current_user_writer_org_ids()));

drop policy if exists "sheet_sources_delete" on public.sheet_sources;
create policy "sheet_sources_delete" on public.sheet_sources
  for delete
  using (org_id in (select public.current_user_writer_org_ids()));

drop trigger if exists sheet_sources_touch on public.sheet_sources;
create trigger sheet_sources_touch
  before update on public.sheet_sources
  for each row execute function public.touch_updated_at();

-- ============================================================
-- dashboards.source_ref may now hold a sheet_sources id
-- ============================================================
-- The column already exists and its comment already anticipated this:
--   'monday' | 'sheet' — board ids (csv) for monday, sheet url for sheets.
-- In practice a sheet dashboard stores the sheet_sources UUID, not the url,
-- so an uploaded file (which has no url) works the same way as a link.
comment on column public.dashboards.source_ref is
  'monday: board ids (csv). sheet: a public.sheet_sources id.';

-- A saved sheet dashboard owns its source: removing the dashboard must not
-- leave the spreadsheet behind. Enforced in the API delete path (the two rows
-- are written together there) — no FK, because a source may outlive a single
-- dashboard while the user builds a second one from it.
