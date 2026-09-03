-- Created for the db-int branch. Apply this migration to the linked Supabase
-- project before enabling cloud vault sync in the app.

create table public.vault_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schema_version smallint not null default 1 check (schema_version = 1),
  revision bigint not null default 0 check (revision >= 0),
  vault jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

revoke all on table public.vault_snapshots from anon;
grant select, insert, update, delete on table public.vault_snapshots to authenticated;

alter table public.vault_snapshots enable row level security;

create policy "Users can read their own vault"
  on public.vault_snapshots for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own vault"
  on public.vault_snapshots for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own vault"
  on public.vault_snapshots for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own vault"
  on public.vault_snapshots for delete
  to authenticated
  using ((select auth.uid()) = user_id);
