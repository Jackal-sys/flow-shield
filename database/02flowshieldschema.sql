-- =====================================================================
-- FlowShield RLS / authorization tests
-- Setup: in Supabase Dashboard > Authentication > Users, create two
-- test users (A and B). Copy their UUIDs into the two lines below.
-- Run the whole block. If any check fails it raises "FAIL: ..." and
-- everything rolls back. On success you see "ALL TESTS PASSED".
-- Keep the output as evidence for Chapter Six.
-- =====================================================================
do $$
declare
  user_a uuid := 'REPLACE-WITH-USER-A-UUID';
  user_b uuid := 'REPLACE-WITH-USER-B-UUID';
  n int;
begin
  -- helper: act as a given user (regular session, no MFA)
  -- (set_config(..., true) = local to this transaction)

  -- T1: A can create their own task
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  insert into public.tasks (title) values ('A private task');
  select count(*) into n from public.tasks;
  assert n = 1, 'FAIL T1: A should see exactly their own task';

  -- T2: B cannot see A's task
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks;
  assert n = 0, 'FAIL T2: B can see A''s tasks';

  -- T3: B cannot insert a row owned by A
  begin
    insert into public.tasks (user_id, title) values (user_a, 'forged by B');
    raise exception 'FAIL T3: B inserted a task for A';
  exception when sqlstate '42501' then null;   -- expected: RLS violation
  end;

  -- T4: B cannot promote themselves to admin
  begin
    update public.profiles set role = 'admin' where id = user_b;
    raise exception 'FAIL T4: B changed their own role';
  exception when sqlstate '42501' then null;   -- expected: permission denied
  end;

  -- T5: B cannot change their own status
  begin
    update public.profiles set status = 'active' where id = user_b;
    raise exception 'FAIL T5: B changed their own status';
  exception when sqlstate '42501' then null;
  end;

  -- T6: B cannot call admin functions
  begin
    perform public.admin_list_accounts();
    raise exception 'FAIL T6: non-admin called admin_list_accounts';
  exception when sqlstate '42501' then null;
  end;

  -- T7: B cannot read audit entries about A
  select count(*) into n from public.audit_log where target_user_id <> user_b;
  assert n = 0, 'FAIL T7: B can read audit entries about other users';

  -- T8: nobody can edit or delete audit log rows
  begin
    delete from public.audit_log;
    raise exception 'FAIL T8: audit_log delete was allowed';
  exception when sqlstate '42501' then null;   -- no DELETE grant
  end;

  -- T9: anonymous users can read nothing
  reset role;
  set local role anon;
  begin
    perform count(*) from public.tasks;
    raise exception 'FAIL T9: anon could query tasks';
  exception when sqlstate '42501' then null;
  end;

  -- T10: a suspended account loses access to its own data immediately
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set status = 'suspended' where id = user_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  select count(*) into n from public.tasks;
  assert n = 0, 'FAIL T10: suspended user still sees their data';

  -- cleanup
  reset role;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set status = 'active' where id = user_a;
  delete from public.tasks where title = 'A private task';

  raise notice 'ALL TESTS PASSED';
end $$;

-- Not covered here (needs a real admin session with MFA): test the admin
-- functions through the control panel once it exists, and confirm that a
-- second admin cannot be created:
--   update public.profiles set role = 'admin' where id = '<another user id>';
--   -- expected: unique violation on profiles_single_admin
