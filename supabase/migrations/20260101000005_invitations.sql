create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  supermarket_id uuid not null references public.supermarkets (id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  role public.app_role not null,
  max_discount numeric(5, 2) not null default 0 check (max_discount between 0 and 100),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  invited_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index invitations_pending_uq on public.invitations (supermarket_id, email) where status = 'pending';
alter table public.invitations enable row level security;
create policy invitations_select on public.invitations for select to authenticated using (
  public.is_super_admin() or public.has_store_role(supermarket_id, array['admin']::public.app_role[]));
grant select on public.invitations to authenticated;

create or replace function public.invite_member(
  p_store uuid, p_email text, p_full_name text, p_role public.app_role, p_max_discount numeric default 0)
returns text language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); u record;
        v_disc numeric := case when p_role = 'cashier' then coalesce(p_max_discount, 0) else 0 end;
begin
  if not (public.is_super_admin() or public.has_store_role(p_store, array['admin']::public.app_role[])) then
    raise exception 'not allowed to add people to this supermarket' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email address' using errcode = '22023'; end if;
  if v_disc < 0 or v_disc > 100 then raise exception 'discount limit must be between 0 and 100' using errcode = '22023'; end if;
  if not exists (select 1 from public.supermarkets where id = p_store) then raise exception 'supermarket not found' using errcode = 'P0002'; end if;
  select id, email_confirmed_at into u from auth.users where lower(email) = v_email limit 1;
  if found and u.email_confirmed_at is not null then
    perform public.upsert_store_member(p_store, u.id, p_role, v_disc);
    return 'added';
  end if;
  update public.invitations set role = p_role, max_discount = v_disc, full_name = nullif(btrim(p_full_name), ''), invited_by = auth.uid()
   where supermarket_id = p_store and email = v_email and status = 'pending';
  if not found then
    insert into public.invitations (supermarket_id, email, full_name, role, max_discount, invited_by)
    values (p_store, v_email, nullif(btrim(p_full_name), ''), p_role, v_disc, auth.uid());
  end if;
  perform public.write_audit(p_store, 'invitation.created', 'invitation', null, jsonb_build_object('email', v_email, 'role', p_role));
  return 'invited';
end $$;

create or replace function public.cancel_invitation(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  select * into i from public.invitations where id = p_id and status = 'pending';
  if not found then raise exception 'invitation not found' using errcode = 'P0002'; end if;
  if not (public.is_super_admin() or public.has_store_role(i.supermarket_id, array['admin']::public.app_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.invitations set status = 'cancelled' where id = p_id;
  perform public.write_audit(i.supermarket_id, 'invitation.cancelled', 'invitation', p_id, '{}'::jsonb);
end $$;

create or replace function public.claim_invitations() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  for inv in select * from public.invitations where email = lower(btrim(new.email)) and status = 'pending' loop
    insert into public.supermarket_members (supermarket_id, user_id, role, cashier_max_discount_pct, created_by)
    values (inv.supermarket_id, new.id, inv.role, inv.max_discount, inv.invited_by)
    on conflict (supermarket_id, user_id) do update
      set role = excluded.role, cashier_max_discount_pct = excluded.cashier_max_discount_pct, is_active = true;
    update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
    if coalesce((select full_name from public.profiles where id = new.id), '') = '' and inv.full_name is not null then
      update public.profiles set full_name = inv.full_name where id = new.id;
    end if;
    perform public.write_audit(inv.supermarket_id, 'invitation.accepted', 'invitation', inv.id, jsonb_build_object('user_id', new.id));
  end loop;
  return new;
end $$;
-- Name sorts after on_auth_user_created so the profile exists first.
create trigger zz_claim_invitations after insert or update of email_confirmed_at on auth.users
  for each row when (new.email_confirmed_at is not null) execute function public.claim_invitations();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.invite_member(uuid, text, text, public.app_role, numeric),
                          public.cancel_invitation(uuid) to authenticated;
