-- manifest: Filas nomeadas por organização, membros autorizados e destino padrão para que um lead entre primeiro numa fila antes de alguém assumir.

create table if not exists public.service_queues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text null check (description is null or char_length(description) <= 240),
  active boolean not null default true,
  is_default boolean not null default false,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create unique index if not exists service_queues_one_default_per_org
  on public.service_queues (organization_id) where is_default and active;

create table if not exists public.service_queue_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  queue_id uuid not null references public.service_queues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (queue_id, user_id)
);

alter table public.conversations add column if not exists service_queue_id uuid null references public.service_queues(id) on delete set null;
create index if not exists idx_conversations_org_service_queue_open
  on public.conversations (organization_id, service_queue_id, awaiting_since asc nulls last)
  where status = 'open' and assigned_to_user_id is null;

alter table public.service_queues enable row level security;
alter table public.service_queue_members enable row level security;
drop policy if exists tenant_isolation_service_queues_all on public.service_queues;
create policy tenant_isolation_service_queues_all on public.service_queues
  for all using (organization_id = any(public.fn_user_org_ids()))
  with check (organization_id = any(public.fn_user_org_ids()));
drop policy if exists tenant_isolation_service_queue_members_all on public.service_queue_members;
create policy tenant_isolation_service_queue_members_all on public.service_queue_members
  for all using (organization_id = any(public.fn_user_org_ids()))
  with check (organization_id = any(public.fn_user_org_ids()));

create or replace function public.fn_create_service_queue(
  p_organization_id uuid, p_name text, p_description text, p_member_ids uuid[], p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := gen_random_uuid();
begin
  if not public.fn_role_at_least(p_organization_id, 'manager') then raise exception 'forbidden'; end if;
  if p_is_default then update public.service_queues set is_default = false where organization_id = p_organization_id; end if;
  insert into public.service_queues (id, organization_id, name, description, is_default, created_by_user_id)
  values (v_id, p_organization_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_is_default, auth.uid());
  insert into public.service_queue_members (organization_id, queue_id, user_id)
  select p_organization_id, v_id, m.user_id from public.user_organizations m
  where m.organization_id = p_organization_id and m.user_id = any(coalesce(p_member_ids, '{}'::uuid[]))
    and m.revoked_at is null and m.role in ('agent', 'manager', 'admin');
  return v_id;
end $$;
revoke all on function public.fn_create_service_queue(uuid, text, text, uuid[], boolean) from public, anon;
grant execute on function public.fn_create_service_queue(uuid, text, text, uuid[], boolean) to authenticated;

create or replace function public.fn_conversation_send_to_queue(
  p_organization_id uuid, p_conversation_id uuid, p_queue_id uuid
) returns public.conversations language plpgsql security definer set search_path = public, auth as $$
declare v_conv public.conversations;
begin
  if not public.fn_role_at_least(p_organization_id, 'agent') then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.service_queues where id = p_queue_id and organization_id = p_organization_id and active) then
    raise exception 'service_queue_not_found';
  end if;
  update public.conversations set service_queue_id = p_queue_id, assigned_to_user_id = null, assigned_to_user_name = null,
    assignee_kind = null, assigned_at = null, status = 'open', bot_silenced_until = 'infinity', updated_at = now()
  where id = p_conversation_id and organization_id = p_organization_id returning * into v_conv;
  return v_conv;
end $$;
revoke all on function public.fn_conversation_send_to_queue(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_conversation_send_to_queue(uuid, uuid, uuid) to authenticated;

create or replace function public.fn_assign_default_service_queue()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service_queue_id is null then
    select id into new.service_queue_id from public.service_queues
      where organization_id = new.organization_id and active and is_default limit 1;
  end if;
  return new;
end $$;
revoke all on function public.fn_assign_default_service_queue() from public, anon, authenticated;
drop trigger if exists trg_conversations_default_service_queue on public.conversations;
create trigger trg_conversations_default_service_queue before insert on public.conversations
  for each row execute function public.fn_assign_default_service_queue();

create or replace function public.fn_clear_service_queue_when_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to_user_id is not null then new.service_queue_id := null; end if;
  return new;
end $$;
revoke all on function public.fn_clear_service_queue_when_assigned() from public, anon, authenticated;
drop trigger if exists trg_conversations_clear_service_queue_when_assigned on public.conversations;
create trigger trg_conversations_clear_service_queue_when_assigned before insert or update of assigned_to_user_id on public.conversations
  for each row execute function public.fn_clear_service_queue_when_assigned();
