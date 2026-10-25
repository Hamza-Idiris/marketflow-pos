-- Phase 1: tenancy, profiles, memberships, audit log, RLS and trusted RPCs.
-- Business tables (products, stock, sales...) arrive in later phases and must
-- follow the same pattern: supermarket_id + RLS using can_access_store()/has_store_role().

create type public.app_role as enum ('admin', 'stock_staff', 'cashier');

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  is_super_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supermarkets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  phone text,
  email text,
  address text,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supermarket_members (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  is_active boolean not null default true,
  cashier_max_discount_pct numeric(5, 2) not null default 0
    check (cashier_max_discount_pct between 0 and 100),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supermarket_id, user_id)
);
create index supermarket_members_user_idx on public.supermarket_members (user_id) where is_active;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid references public.supermarkets (id) on delete restrict,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_store_created_idx on public.audit_logs (supermarket_id, created_at desc);

create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger supermarkets_updated before update on public.supermarkets
  for each row execute function public.set_updated_at();
create trigger members_updated before update on public.supermarket_members
  for each row execute function public.set_updated_at();

-- Defense in depth: clients can never flip privileged profile columns.
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated')
     and (new.is_super_admin is distinct from old.is_super_admin
          or new.is_active is distinct from old.is_active
          or new.id is distinct from old.id) then
    raise exception 'privileged profile columns cannot be changed directly' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Every new auth user gets a profile. Roles are never taken from user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------- helper functions
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.is_super_admin
  );
$$;

-- Active user + active membership + active supermarket.
create or replace function public.is_store_member(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.supermarket_members m
    join public.supermarkets s on s.id = m.supermarket_id and s.is_active
    join public.profiles p on p.id = m.user_id and p.is_active
    where m.supermarket_id = sid and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function public.has_store_role(sid uuid, roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.supermarket_members m
    join public.supermarkets s on s.id = m.supermarket_id and s.is_active
    join public.profiles p on p.id = m.user_id and p.is_active
    where m.supermarket_id = sid and m.user_id = auth.uid() and m.is_active
      and m.role = any (roles)
  );
$$;

create or replace function public.can_access_store(sid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin() or public.is_store_member(sid);
$$;

-- True when the caller is an active admin of a store the target user belongs to.
create or replace function public.shares_store_as_admin(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists (
    select 1
    from public.supermarket_members a
    join public.supermarket_members t on t.supermarket_id = a.supermarket_id
    where a.user_id = auth.uid() and a.role = 'admin' and a.is_active and t.user_id = target
  );
$$;

create or replace function public.write_audit(
  p_store uuid, p_action text, p_entity text, p_entity_id uuid, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (supermarket_id, actor_id, action, entity_type, entity_id, details)
  values (p_store, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
grant select on public.profiles, public.supermarkets,
  public.supermarket_members, public.audit_logs to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.supermarkets enable row level security;
alter table public.supermarket_members enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super_admin() or public.shares_store_as_admin(id));

create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid());

create policy supermarkets_select on public.supermarkets for select to authenticated
  using (public.can_access_store(id));

create policy members_select on public.supermarket_members for select to authenticated
  using (
    public.is_super_admin()
    or (user_id = auth.uid() and public.is_active_user())
    or public.has_store_role(supermarket_id, array['admin']::public.app_role[])
  );

create policy audit_select on public.audit_logs for select to authenticated
  using (
    public.is_super_admin()
    or (supermarket_id is not null
        and public.has_store_role(supermarket_id, array['admin']::public.app_role[]))
  );
-- No INSERT/UPDATE/DELETE policies: all writes go through the functions below.

-- ------------------------------------------------------------ trusted RPCs
create or replace function public.create_supermarket(
  p_name text, p_slug text, p_phone text default null,
  p_email text default null, p_address text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin can create supermarkets' using errcode = '42501';
  end if;
  insert into public.supermarkets (name, slug, phone, email, address, created_by)
  values (btrim(p_name), lower(btrim(p_slug)), nullif(btrim(p_phone), ''),
          nullif(btrim(p_email), ''), nullif(btrim(p_address), ''), auth.uid())
  returning id into v_id;
  perform public.write_audit(v_id, 'supermarket.created', 'supermarket', v_id,
    jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.set_supermarket_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin can change supermarket status' using errcode = '42501';
  end if;
  update public.supermarkets set is_active = p_active where id = p_id;
  if not found then raise exception 'supermarket not found' using errcode = 'P0002'; end if;
  perform public.write_audit(p_id,
    case when p_active then 'supermarket.activated' else 'supermarket.suspended' end,
    'supermarket', p_id, '{}'::jsonb);
end $$;

create or replace function public.update_supermarket_details(
  p_id uuid, p_name text, p_phone text default null,
  p_email text default null, p_address text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_super_admin()
          or public.has_store_role(p_id, array['admin']::public.app_role[])) then
    raise exception 'not allowed to edit this supermarket' using errcode = '42501';
  end if;
  update public.supermarkets
     set name = btrim(p_name), phone = nullif(btrim(p_phone), ''),
         email = nullif(btrim(p_email), ''), address = nullif(btrim(p_address), '')
   where id = p_id;
  if not found then raise exception 'supermarket not found' using errcode = 'P0002'; end if;
  perform public.write_audit(p_id, 'supermarket.updated', 'supermarket', p_id, '{}'::jsonb);
end $$;

-- Assign or change a member. Callers can never change their own membership.
create or replace function public.upsert_store_member(
  p_store uuid, p_user uuid, p_role public.app_role, p_max_discount numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (public.is_super_admin()
          or public.has_store_role(p_store, array['admin']::public.app_role[])) then
    raise exception 'not allowed to manage members of this supermarket' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot change your own membership' using errcode = '42501';
  end if;
  if p_max_discount is null or p_max_discount < 0 or p_max_discount > 100 then
    raise exception 'discount limit must be between 0 and 100' using errcode = '22023';
  end if;
  if not exists (select 1 from public.supermarkets where id = p_store) then
    raise exception 'supermarket not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then
    raise exception 'user not found or inactive' using errcode = 'P0002';
  end if;
  insert into public.supermarket_members
    (supermarket_id, user_id, role, cashier_max_discount_pct, created_by)
  values (p_store, p_user, p_role, p_max_discount, auth.uid())
  on conflict (supermarket_id, user_id) do update
    set role = excluded.role,
        cashier_max_discount_pct = excluded.cashier_max_discount_pct,
        is_active = true
  returning id into v_id;
  perform public.write_audit(p_store, 'member.upserted', 'supermarket_member', v_id,
    jsonb_build_object('user_id', p_user, 'role', p_role, 'max_discount', p_max_discount));
  return v_id;
end $$;

create or replace function public.set_member_active(p_member uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.supermarket_members;
begin
  select * into v from public.supermarket_members where id = p_member;
  if not found then raise exception 'member not found' using errcode = 'P0002'; end if;
  if not (public.is_super_admin()
          or public.has_store_role(v.supermarket_id, array['admin']::public.app_role[])) then
    raise exception 'not allowed to manage members of this supermarket' using errcode = '42501';
  end if;
  if v.user_id = auth.uid() then
    raise exception 'you cannot change your own membership' using errcode = '42501';
  end if;
  update public.supermarket_members set is_active = p_active where id = p_member;
  perform public.write_audit(v.supermarket_id,
    case when p_active then 'member.activated' else 'member.deactivated' end,
    'supermarket_member', p_member, jsonb_build_object('user_id', v.user_id));
end $$;

-- Platform-wide disable of a user account (super admin only).
create or replace function public.set_profile_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'only a super admin can change account status' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot change your own account status' using errcode = '42501';
  end if;
  update public.profiles set is_active = p_active where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  perform public.write_audit(null,
    case when p_active then 'user.activated' else 'user.deactivated' end,
    'profile', p_user, '{}'::jsonb);
end $$;

-- Function privileges: nothing is callable by anon; internal helpers are hidden.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant execute on function
  public.is_active_user(), public.is_super_admin(), public.is_store_member(uuid),
  public.has_store_role(uuid, public.app_role[]), public.can_access_store(uuid),
  public.shares_store_as_admin(uuid),
  public.create_supermarket(text, text, text, text, text),
  public.set_supermarket_active(uuid, boolean),
  public.update_supermarket_details(uuid, text, text, text, text),
  public.upsert_store_member(uuid, uuid, public.app_role, numeric),
  public.set_member_active(uuid, boolean),
  public.set_profile_active(uuid, boolean)
  to authenticated;
