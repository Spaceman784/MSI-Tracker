-- ============================================================
-- NapChief MIS Dashboard — Supabase schema
-- Run this in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run multiple times.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---- Login accounts ----------------------------------------
create table if not exists mis_users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,
  display_name  text,
  role          text not null default 'user',   -- 'admin' or 'user'
  created_at    timestamptz not null default now()
);
alter table mis_users enable row level security;

-- ---- Tasks (synced from Asana) -----------------------------
create table if not exists mis_tasks (
  gid          text primary key,
  name         text,
  assignee     text,
  project      text,
  section      text,
  completed    boolean default false,
  completed_at timestamptz,
  created_at   timestamptz,
  due_on       date,
  synced_at    timestamptz default now()
);
create index if not exists idx_mis_tasks_assignee  on mis_tasks(assignee);
create index if not exists idx_mis_tasks_project    on mis_tasks(project);
create index if not exists idx_mis_tasks_completed  on mis_tasks(completed);
create index if not exists idx_mis_tasks_due        on mis_tasks(due_on);
alter table mis_tasks enable row level security;

-- ---- Meta (member roster, last-synced timestamp) ----------
create table if not exists mis_meta (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);
alter table mis_meta enable row level security;

-- The app uses the service-role key (server side), which bypasses RLS.
-- RLS is enabled with NO public policies so the anon key cannot read these.

-- ============================================================
-- After running this:
--   1) npm run seed     (creates the 5 login accounts)
--   2) npm run sync     (pulls Asana data into mis_tasks — takes ~8 min)
-- ============================================================
