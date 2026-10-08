-- manifest: importa o acervo do canal sem transformar mensagens antigas em eventos, fila ou contexto novo da IA

-- Conversa criada exclusivamente pelo importador. Ela nasce encerrada, então o
-- trigger de distribuição não a coloca na fila. Se a conversa já existe, seu
-- estado operacional é preservado.
create or replace function public.fn_upsert_wa_historical_conversation(
  p_org uuid, p_contact uuid, p_session uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.conversations (
    organization_id, contact_id, channel_session_id, channel, status,
    is_group, unread_count_for_assignee, metadata
  ) values (
    p_org, p_contact, p_session, 'whatsapp', 'closed',
    false, 0, jsonb_build_object('historical_import', true)
  )
  on conflict (organization_id, contact_id, channel_session_id) where is_group = false
  do update set id = conversations.id
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.fn_upsert_wa_historical_conversation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_upsert_wa_historical_conversation(uuid, uuid, uuid)
  to service_role;

-- Uma mensagem de acervo é registro, não um acontecimento novo. Sem esta
-- guarda, o INSERT emitiria message.received/message.sent e acordaria workers,
-- automações, webhooks e agentes.
create or replace function public.fn_emit_message_event() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  v_event text;
begin
  if new.metadata->>'historical_import' = 'true' then
    return new;
  end if;

  if new.direction = 'inbound' then
    if exists (select 1 from public.conversations c
               where c.id = new.conversation_id and c.organization_id = new.organization_id and c.is_group) then
      v_event := 'message.group_received';
    else
      v_event := 'message.received';
    end if;
  else
    v_event := case new.status
                 when 'sending' then 'message.sending'
                 when 'sent' then 'message.sent'
                 when 'failed' then 'message.failed'
                 else 'message.outbound'
               end;
  end if;

  perform public.fn_log_event(
    new.organization_id, v_event,
    jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id,
      'contact_id', new.contact_id, 'direction', new.direction,
      'type', new.type, 'status', new.status, 'external_id', new.external_id,
      'channel_session_id', new.channel_session_id,
      'body_preview', "left"(new.body, 280)
    )
  );
  return new;
end$$;

-- O acervo também não muda a revisão do contexto de resposta. Assim uma
-- importação não invalida rascunhos nem parece uma fala nova do cliente.
create or replace function public.fn_reply_inbound_revision() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.direction='inbound' and new.metadata->>'historical_import' is distinct from 'true' then
    update public.conversations
      set reply_context_revision=reply_context_revision+1
      where organization_id=new.organization_id
        and id=new.conversation_id
        and contact_id=new.contact_id;
  end if;
  return new;
end;$$;

revoke execute on function public.fn_reply_inbound_revision() from public,anon,authenticated;
