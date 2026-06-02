-- ============================================================
-- NapChief MIS Dashboard — Supabase schema
-- Run this in Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists mis_users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,
  display_name  text,
  role          text not null default 'user',   -- 'admin' or 'user'
  created_at    timestamptz not null default now()
);

-- The app talks to this table ONLY via the service-role key (server side),
-- which bypasses RLS. We enable RLS with no public policies so the public
-- anon key cannot read or write user rows.
alter table mis_users enable row level security;

-- ============================================================
-- After running this, seed the first 5 users by running, in your terminal:
--     npm run seed
-- (that hashes the passwords and inserts sumanth + the others)
-- ============================================================
