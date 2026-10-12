-- manifest: Filas nomeadas por organização, membros autorizados e roteamento por campanha com fallback à fila geral.

create table if not exists public.service_queues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text null check (description is null or char_length(description) <= 240),
  active boolean not null default true,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table if not exists public.service_queue_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (queue_id, user_id),
  foreign key (queue_id, organization_id) references public.service_queues(id, organization_id) on delete cascade,
  foreign key (user_id, organization_id) references public.user_organizations(user_id, organization_id) on delete cascade
);

create table if not exists public.service_queue_campaign_rules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null default 'meta_ads' check (platform = 'meta_ads'),
  campaign_id text not null check (char_length(btrim(campaign_id)) between 1 and 100),
  queue_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, platform, campaign_id),
  foreign key (queue_id, organization_id) references public.service_queues(id, organization_id) on delete cascade
);

alter table public.conversations add column if not exists service_queue_id uuid null references public.service_queues(id) on delete set null;
create index if not exists idx_conversations_org_service_queue_open
  on public.conversations (organization_id, service_queue_id, awaiting_since asc nulls last)
  where status = 'open' and assigned_to_user_id is null;

alter table public.service_queues enable row level security;
alter table public.service_queue_members enable row level security;
alter table public.service_queue_campaign_rules enable row level security;
drop policy if exists service_queues_read on public.service_queues;
create policy service_queues_read on public.service_queues for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists service_queues_manager_write on public.service_queues;
create policy service_queues_manager_write on public.service_queues for all
  using (public.fn_role_at_least(organization_id, 'manager'))
  with check (public.fn_role_at_least(organization_id, 'manager'));
drop policy if exists service_queue_members_read on public.service_queue_members;
create policy service_queue_members_read on public.service_queue_members for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists service_queue_members_manager_write on public.service_queue_members;
create policy service_queue_members_manager_write on public.service_queue_members for all
  using (public.fn_role_at_least(organization_id, 'manager'))
  with check (public.fn_role_at_least(organization_id, 'manager'));
drop policy if exists service_queue_campaign_rules_read on public.service_queue_campaign_rules;
create policy service_queue_campaign_rules_read on public.service_queue_campaign_rules for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists service_queue_campaign_rules_manager_write on public.service_queue_campaign_rules;
create policy service_queue_campaign_rules_manager_write on public.service_queue_campaign_rules for all
  using (public.fn_role_at_least(organization_id, 'manager'))
  with check (public.fn_role_at_least(organization_id, 'manager'));
-- Membro da fila vê seu trabalho mesmo se a organização configurou "só minhas".
-- Não abre a Fila geral nem conversas assumidas por outro atendente.
drop policy if exists conversations_service_queue_member_select on public.conversations;
create policy conversations_service_queue_member_select on public.conversations for select
  using (assigned_to_user_id is null and service_queue_id is not null
    and organization_id in (select public.fn_user_org_ids())
    and exists (select 1 from public.service_queue_members m
      where m.queue_id = conversations.service_queue_id
        and m.organization_id = conversations.organization_id
        and m.user_id = auth.uid()));
revoke all on public.service_queues, public.service_queue_members, public.service_queue_campaign_rules from anon;

create or replace function public.fn_create_service_queue(
  p_organization_id uuid, p_name text, p_description text, p_member_ids uuid[], p_campaign_ids text[]
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.fn_role_at_least(p_organization_id, 'manager') then raise exception 'forbidden'; end if;
  insert into public.service_queues (id, organization_id, name, description, created_by_user_id)
  values (v_id, p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), auth.uid());
  insert into public.service_queue_members (organization_id, queue_id, user_id)
  select p_organization_id, v_id, m.user_id from public.user_organizations m
  where m.organization_id = p_organization_id and m.user_id = any(coalesce(p_member_ids, '{}'::uuid[]))
    and m.revoked_at is null and m.role in ('agent', 'manager', 'admin');
  insert into public.service_queue_campaign_rules (organization_id, campaign_id, queue_id)
  select p_organization_id, btrim(campaign_id), v_id
  from unnest(coalesce(p_campaign_ids, '{}'::text[])) as campaign_id
  where btrim(campaign_id) <> '';
  return v_id;
end $$;
revoke all on function public.fn_create_service_queue(uuid, text, text, uuid[], text[]) from public, anon;
grant execute on function public.fn_create_service_queue(uuid, text, text, uuid[], text[]) to authenticated;

create or replace function public.fn_update_service_queue(
  p_organization_id uuid, p_queue_id uuid, p_name text, p_description text,
  p_member_ids uuid[], p_campaign_ids text[]
) returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.fn_role_at_least(p_organization_id, 'manager') then raise exception 'forbidden'; end if;
  update public.service_queues set name = btrim(p_name),
    description = nullif(btrim(coalesce(p_description, '')), ''), updated_at = now()
  where id = p_queue_id and organization_id = p_organization_id and active;
  if not found then raise exception 'service_queue_not_found'; end if;
  delete from public.service_queue_members where queue_id = p_queue_id and organization_id = p_organization_id;
  insert into public.service_queue_members (organization_id, queue_id, user_id)
  select p_organization_id, p_queue_id, m.user_id from public.user_organizations m
  where m.organization_id = p_organization_id and m.user_id = any(coalesce(p_member_ids, '{}'::uuid[]))
    and m.revoked_at is null and m.role in ('agent', 'manager', 'admin');
  delete from public.service_queue_campaign_rules where queue_id = p_queue_id and organization_id = p_organization_id;
  insert into public.service_queue_campaign_rules (organization_id, campaign_id, queue_id)
  select p_organization_id, btrim(campaign_id), p_queue_id
  from unnest(coalesce(p_campaign_ids, '{}'::text[])) as campaign_id
  where btrim(campaign_id) <> '';
end $$;
revoke all on function public.fn_update_service_queue(uuid, uuid, text, text, uuid[], text[]) from public, anon;
grant execute on function public.fn_update_service_queue(uuid, uuid, text, text, uuid[], text[]) to authenticated;

create or replace function public.fn_conversation_send_to_queue(
  p_organization_id uuid, p_conversation_id uuid, p_queue_id uuid
) returns public.conversations language plpgsql security definer set search_path = public, auth as $$
declare v_conv public.conversations; v_from uuid;
begin
  if not public.fn_role_at_least(p_organization_id, 'agent') then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.service_queues where id = p_queue_id and organization_id = p_organization_id and active) then
    raise exception 'service_queue_not_found';
  end if;
  select * into v_conv from public.conversations
  where id = p_conversation_id and organization_id = p_organization_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if v_conv.assigned_to_user_id is distinct from auth.uid()
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception 'forbidden';
  end if;
  v_from := v_conv.assigned_to_user_id;
  update public.conversations set service_queue_id = p_queue_id, assigned_to_user_id = null, assigned_to_user_name = null,
    assignee_kind = null, assigned_at = null, status = 'open', bot_silenced_until = 'infinity', updated_at = now()
  where id = p_conversation_id and organization_id = p_organization_id returning * into v_conv;
  if v_from is not null then
    insert into public.conversation_assignment_events
      (organization_id, conversation_id, from_user_id, to_user_id, changed_by, reason)
    values (p_organization_id, p_conversation_id, v_from, null, auth.uid(), 'release');
  end if;
  return v_conv;
end $$;
revoke all on function public.fn_conversation_send_to_queue(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_conversation_send_to_queue(uuid, uuid, uuid) to authenticated;

create or replace function public.fn_resolve_campaign_service_queue(p_organization_id uuid, p_contact_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_metadata jsonb; v_campaign_id text; v_queue_id uuid;
begin
  select source_metadata into v_metadata from public.contacts
  where id = p_contact_id and organization_id = p_organization_id;
  if v_metadata->>'ad_platform' is distinct from 'meta_ads' then return null; end if;
  v_campaign_id := nullif(btrim(v_metadata->>'campaign_id'), '');
  if v_campaign_id is null then
    select h.campaign_id into v_campaign_id from public.ad_hierarchy_cache h
    where h.organization_id = p_organization_id and h.platform = 'meta_ads'
      and h.ad_id = v_metadata->>'ad_id' limit 1;
  end if;
  if v_campaign_id is null then return null; end if;
  select r.queue_id into v_queue_id from public.service_queue_campaign_rules r
  join public.service_queues q on q.id = r.queue_id and q.organization_id = r.organization_id and q.active
  where r.organization_id = p_organization_id and r.platform = 'meta_ads'
    and r.campaign_id = v_campaign_id;
  return v_queue_id;
end $$;
revoke all on function public.fn_resolve_campaign_service_queue(uuid, uuid) from public, anon, authenticated;

create or replace function public.fn_route_new_conversation_to_service_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_queue_id is null and new.assigned_to_user_id is null and new.status in ('open', 'pending') then
    new.service_queue_id := public.fn_resolve_campaign_service_queue(new.organization_id, new.contact_id);
    if new.service_queue_id is not null then new.bot_silenced_until := 'infinity'; end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_route_new_conversation_to_service_queue() from public, anon, authenticated;
drop trigger if exists trg_conversations_route_service_queue on public.conversations;
create trigger trg_conversations_route_service_queue before insert on public.conversations
  for each row execute function public.fn_route_new_conversation_to_service_queue();

create or replace function public.fn_route_existing_conversations_to_service_queue()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_queue_id uuid;
begin
  v_queue_id := public.fn_resolve_campaign_service_queue(new.organization_id, new.id);
  if v_queue_id is not null then
    update public.conversations set service_queue_id = v_queue_id, bot_silenced_until = 'infinity'
    where organization_id = new.organization_id and contact_id = new.id
      and assigned_to_user_id is null and service_queue_id is null and status in ('open', 'pending');
  end if;
  return new;
end $$;
revoke all on function public.fn_route_existing_conversations_to_service_queue() from public, anon, authenticated;
drop trigger if exists trg_contacts_route_service_queue on public.contacts;
create trigger trg_contacts_route_service_queue after update of source_metadata on public.contacts
  for each row when (old.source_metadata is distinct from new.source_metadata)
  execute function public.fn_route_existing_conversations_to_service_queue();

create or replace function public.fn_route_campaign_cache_to_service_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.platform = 'meta_ads' and new.campaign_id is not null then
    update public.conversations v set service_queue_id = r.queue_id, bot_silenced_until = 'infinity'
    from public.contacts c
    join public.service_queue_campaign_rules r on r.organization_id = c.organization_id
      and r.platform = 'meta_ads' and r.campaign_id = new.campaign_id
    join public.service_queues q on q.id = r.queue_id and q.organization_id = r.organization_id and q.active
    where v.organization_id = new.organization_id and v.contact_id = c.id
      and c.organization_id = new.organization_id
      and c.source_metadata->>'ad_platform' = 'meta_ads'
      and c.source_metadata->>'ad_id' = new.ad_id
      and v.assigned_to_user_id is null and v.service_queue_id is null
      and v.status in ('open', 'pending');
  end if;
  return new;
end $$;
revoke all on function public.fn_route_campaign_cache_to_service_queue() from public, anon, authenticated;
drop trigger if exists trg_ad_hierarchy_cache_route_service_queue on public.ad_hierarchy_cache;
create trigger trg_ad_hierarchy_cache_route_service_queue after insert or update of campaign_id on public.ad_hierarchy_cache
  for each row execute function public.fn_route_campaign_cache_to_service_queue();

create or replace function public.fn_clear_service_queue_when_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_queue_id is not null and not exists (
    select 1 from public.service_queues q where q.id = new.service_queue_id
      and q.organization_id = new.organization_id and q.active
  ) then raise exception 'service_queue_not_found'; end if;
  if tg_op = 'UPDATE' and old.service_queue_id is not null then
    if new.assigned_to_user_id is not null and not exists (
      select 1 from public.service_queue_members m
      where m.queue_id = old.service_queue_id and m.organization_id = new.organization_id
        and m.user_id = new.assigned_to_user_id
        and exists (select 1 from public.user_organizations u where u.user_id = m.user_id
          and u.organization_id = m.organization_id and u.revoked_at is null)
    ) then raise exception 'service_queue_member_required'; end if;
    if new.assigned_to_user_id is null and new.service_queue_id is null
      and auth.uid() is not null and not public.fn_role_at_least(new.organization_id, 'manager') then
      raise exception 'service_queue_release_forbidden';
    end if;
  end if;
  if new.assigned_to_user_id is not null then new.service_queue_id := null; end if;
  return new;
end $$;
revoke all on function public.fn_clear_service_queue_when_assigned() from public, anon, authenticated;
drop trigger if exists trg_conversations_clear_service_queue_when_assigned on public.conversations;
create trigger trg_conversations_clear_service_queue_when_assigned before insert or update of assigned_to_user_id, service_queue_id on public.conversations
  for each row execute function public.fn_clear_service_queue_when_assigned();
