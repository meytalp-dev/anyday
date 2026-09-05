-- ============================================================
-- AnyDay schema v8 — הזמנת חברי צוות לארגון
-- ============================================================
--
-- Run AFTER v7. Idempotent: safe to run twice.
--
-- WHY THIS TABLE EXISTS
-- getOrgContext() creates a fresh organization for every authenticated user,
-- so until now every person who signed up got an organization of their own and
-- connected THEIR OWN Monday. A real customer is three people looking at the
-- same boards, and there was no route to that at all.
--
-- WHAT IS STORED
-- An invitation is a promise made to one email address, for one organization,
-- at one role, that expires. The link that carries it holds a random token —
-- and this table holds only its SHA-256 hash. Someone who reads a row cannot
-- reconstruct the link from it, exactly as a stolen password hash is not a
-- password. That is the same reasoning that keeps the Monday token encrypted
-- one table over.
--
-- WHAT IS NOT STORED
-- Nothing about the invited person beyond the address they were invited at.
-- They become a row in org_users only when they click accept themselves.

create table if not exists public.org_invites (
  id uuid default gen_random_uuid() primary key,
  org_id uuid references public.organizations(id) on delete cascade not null,
  -- Lowercased on write. Shown back to the admin ("הוזמן: x@y.com"); it is
  -- deliberately NOT used to auto-join anybody, because an address match is
  -- not consent.
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  -- SHA-256 of the token. The token itself exists only inside the link.
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.org_invites enable row level security;

create index if not exists idx_org_invites_org on public.org_invites(org_id);
create index if not exists idx_org_invites_hash on public.org_invites(token_hash);

-- One LIVE invitation per address per organization. A second invite to the
-- same person is the same promise, not a new one; re-inviting replaces it.
-- Accepted and expired rows are excluded so history is kept and re-inviting
-- someone who left still works.
create unique index if not exists idx_org_invites_pending
  on public.org_invites(org_id, email)
  where accepted_at is null;

-- ── RLS ─────────────────────────────────────────────────────
-- Members of the organization may SEE its invitations, so the members screen
-- can list who is pending. Nobody writes through RLS: every write goes through
-- the service client behind an admin check in the API, because redemption has
-- to read a row belonging to an org the caller is not in yet.
drop policy if exists "org_invites_select" on public.org_invites;
create policy "org_invites_select" on public.org_invites
  for select using (
    org_id in (select org_id from public.org_users where user_id = auth.uid())
  );

comment on table public.org_invites is
  'הזמנות ממתינות לארגון. הטוקן עצמו לא נשמר — רק הגיבוב שלו.';
