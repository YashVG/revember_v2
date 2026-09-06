-- Supabase default grants may include privileges not limited by row policies.
revoke all on table public.vault_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.vault_snapshots to authenticated;

-- This optional dashboard-created helper is an administrative event trigger,
-- not an application RPC. Keep the trigger intact and restrict direct execution.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
