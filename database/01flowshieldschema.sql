-- =====================================================================
-- FlowShield schema v1  (Supabase / Postgres)
-- Run once in a FRESH project: Supabase Dashboard > SQL Editor.
--
-- Design rules:
--   1. Deny by default: every table has RLS on; grants are minimal.
--   2. Users only ever touch their own rows.
--   3. ONE admin. The admin manages ACCOUNTS (view, suspend, revoke,
--      delete) but can NOT read anyone's tasks, events or notes.
--      (Your thesis excludes employer-style surveillance.)
--   4. Admin powers exist only as server-side functions that re-check
--      admin status + MFA (aal2) and write to an append-only audit log.
-- =====================================================================

create schema if not exists private;   -- not exposed through the API

-- ---------- Types ----------------------------------------------------
create type public.account_status as enum ('active', 'suspended');
create type public.task_status    as enum ('todo', 'in_progress', 'done', 'postponed');
create type public.event_kind     as enum ('class', 'shift', 'appointment', 'other');

-- ---------- Audit log (created first: other parts write to it) -------
create table public.audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_id       uuid,                 -- who did it (null = system/SQL editor)
  action         text not null,
  target_user_id uuid,                 -- no FK on purpose: log survives account deletion
  details        jsonb not null default '{}'
);
create index audit_log_target_idx on public.audit_log (target_user_id, at desc);

create function private.write_audit(p_actor uuid, p_action text, p_target uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, target_user_id, details)
  values (p_actor, p_action, p_target, p_details);
$$;

-- Append-only: nobody (even via API) can edit or delete log rows.
create function private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_change before update or delete on public.audit_log
  for each row execute function private.audit_immutable();

-- ---------- Profiles -------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  role         text not null default 'user' check (role in ('user', 'admin')),
  status       public.account_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Database-level guarantee: at most ONE admin can ever exist.
create unique index profiles_single_admin on public.profiles (role) where role = 'admin';

-- Auto-create a profile for every new sign-up.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(nullif(new.raw_user_meta_data ->> 'display_name', ''), 80));
  perform private.write_audit(new.id, 'account_created', new.id, '{}');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Log any change to role or status (who, from, to).
create function private.audit_profile_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    perform private.write_audit((select auth.uid()), 'status_changed', new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.role is distinct from old.role then
    perform private.write_audit((select auth.uid()), 'role_changed', new.id,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end $$;
create trigger profiles_audit after update on public.profiles
  for each row execute function private.audit_profile_change();

-- ---------- Helper functions used by policies ------------------------
-- SECURITY DEFINER lets them read profiles without RLS recursion.
create function public.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and status = 'active');
$$;

-- Admin only counts if the session passed MFA (aal2).
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and role = 'admin' and status = 'active')
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

create function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

-- ---------- User data tables -----------------------------------------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null check (char_length(title) between 1 and 200),
  notes             text check (char_length(notes) <= 4000),
  status            public.task_status not null default 'todo',
  priority          smallint not null default 2 check (priority between 1 and 3),
  category          text check (char_length(category) <= 50),
  estimated_minutes integer check (estimated_minutes between 1 and 1440),
  due_at            timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tasks_user_due_idx on public.tasks (user_id, due_at);

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  kind       public.event_kind not null default 'other',
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  recurrence text check (char_length(recurrence) <= 200),   -- e.g. an RRULE string
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index events_user_start_idx on public.events (user_id, starts_at);

create table public.protected_periods (   -- sleep, meals, rest, personal time
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label       text not null check (char_length(label) <= 50),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time  time not null,
  end_time    time not null
);

create table public.preferences (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  planning_mode text not null default 'guided' check (planning_mode in ('quick', 'guided', 'planner')),
  settings      jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);

create table public.consents (            -- append-only consent history
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purpose     text not null check (char_length(purpose) <= 100),  -- e.g. 'pattern_learning'
  granted     boolean not null,
  recorded_at timestamptz not null default now()
);

-- Keep updated_at honest.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger tasks_touch       before update on public.tasks       for each row execute function private.touch_updated_at();
create trigger profiles_touch    before update on public.profiles    for each row execute function private.touch_updated_at();
create trigger preferences_touch before update on public.preferences for each row execute function private.touch_updated_at();

-- Log every consent decision.
create function private.audit_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.write_audit(new.user_id, 'consent_recorded', new.user_id,
    jsonb_build_object('purpose', new.purpose, 'granted', new.granted));
  return new;
end $$;
create trigger consents_audit after insert on public.consents
  for each row execute function private.audit_consent();

-- ---------- Row Level Security ---------------------------------------
alter table public.profiles          enable row level security;
alter table public.tasks             enable row level security;
alter table public.events            enable row level security;
alter table public.protected_periods enable row level security;
alter table public.preferences       enable row level security;
alter table public.consents          enable row level security;
alter table public.audit_log         enable row level security;

-- Profiles: read own (so a suspended user can still see their status).
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and public.is_active())
  with check (id = (select auth.uid()));

-- Owner-only access, and only while the account is active.
create policy tasks_owner on public.tasks for all to authenticated
  using      (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());
create policy events_owner on public.events for all to authenticated
  using      (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());
create policy periods_owner on public.protected_periods for all to authenticated
  using      (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());
create policy prefs_owner on public.preferences for all to authenticated
  using      (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select auth.uid()));
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_active());

-- Audit log: users see events about themselves; admin sees all. No write policies.
create policy audit_select_own   on public.audit_log for select to authenticated
  using (target_user_id = (select auth.uid()));
create policy audit_select_admin on public.audit_log for select to authenticated
  using (public.is_admin());

-- ---------- Grants (least privilege) -----------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select                          on public.profiles          to authenticated;
grant update (display_name)           on public.profiles          to authenticated;  -- NOT role/status
grant select, insert, update, delete  on public.tasks, public.events,
                                         public.protected_periods, public.preferences to authenticated;
grant select, insert                  on public.consents          to authenticated;
grant select                          on public.audit_log         to authenticated;

revoke execute on function public.is_active(), public.is_admin() from public, anon;
grant  execute on function public.is_active(), public.is_admin() to authenticated;

-- ---------- Admin control-panel functions -------------------------------
-- Each one: checks admin + MFA, never lets the admin target themselves,
-- and leaves an audit trail.

create function public.admin_list_accounts()
returns table (id uuid, email text, display_name text, role text,
               status public.account_status, created_at timestamptz,
               last_sign_in_at timestamptz, mfa_enabled boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  perform private.write_audit((select auth.uid()), 'admin_list_accounts', null, '{}');
  return query
    select p.id, u.email::text, p.display_name, p.role, p.status, p.created_at,
           u.last_sign_in_at,
           exists (select 1 from auth.mfa_factors f
                   where f.user_id = p.id and f.status = 'verified')
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end $$;

-- Suspend / reactivate. Suspending also kills all sessions immediately.
create function public.admin_set_account_status(p_target uuid, p_status public.account_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_target = (select auth.uid()) then
    raise exception 'admins cannot change their own account';
  end if;
  update public.profiles set status = p_status where id = p_target;   -- trigger logs it
  if not found then raise exception 'account not found'; end if;
  if p_status = 'suspended' then
    delete from auth.sessions where user_id = p_target;   -- also removes refresh tokens
  end if;
end $$;

-- Force logout on all devices without suspending.
create function public.admin_revoke_sessions(p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  delete from auth.sessions where user_id = p_target;
  perform private.write_audit((select auth.uid()), 'sessions_revoked', p_target, '{}');
end $$;

-- Permanent delete (cascades to all of that user's data).
create function public.admin_delete_account(p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_target = (select auth.uid()) then
    raise exception 'admins cannot delete their own account here';
  end if;
  delete from auth.users where id = p_target;
  if not found then raise exception 'account not found'; end if;
  perform private.write_audit((select auth.uid()), 'account_deleted', p_target, '{}');
end $$;

revoke execute on function public.admin_list_accounts(),
                           public.admin_set_account_status(uuid, public.account_status),
                           public.admin_revoke_sessions(uuid),
                           public.admin_delete_account(uuid)
  from public, anon;
grant execute on function public.admin_list_accounts(),
                          public.admin_set_account_status(uuid, public.account_status),
                          public.admin_revoke_sessions(uuid),
                          public.admin_delete_account(uuid)
  to authenticated;

-- =====================================================================
-- BECOMING THE ADMIN (do this by hand, never through the app):
--   1. Sign up in the app with your admin email.
--   2. Enroll an MFA factor (TOTP) on that account.
--   3. Run this in the SQL editor:
--        update public.profiles set role = 'admin'
--        where id = (select id from auth.users where email = 'you@example.com');
-- The unique index guarantees a second admin can never be created.
-- =====================================================================
