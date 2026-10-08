import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import type { createAdminClient } from "@/lib/supabase/admin";
import { ackToStatus } from "@/lib/types/messaging";
import { getWahaClient } from "@/lib/waha/client";
import type { WahaPayload } from "@/lib/waha/envelope";
import {
  bodyOf,
  dataDoTimestamp,
  mediaMimeOf,
  mediaUrlOf,
  notifyNameOf,
  parseChatId,
  resolveMessageType,
  telefoneAlternativoDe,
  upsertContact,
} from "@/lib/waha/ingest";
import { bareWaMessageId, chatIdFromWaMessageId } from "@/lib/waha/message-id";

type Admin = ReturnType<typeof createAdminClient>;

export const TAMANHO_DO_LOTE_DE_HISTORICO = 100;

export interface ResultadoDoLoteDeHistorico {
  lidas: number;
  importadas: number;
  repetidas: number;
  ignoradas: number;
  proximo_offset: number;
  concluido: boolean;
}

function chatDaMensagem(p: WahaPayload): string {
  if (!p.fromMe) return p.from ?? "";
  return p.to ?? chatIdFromWaMessageId(p.id ?? "") ?? p.from ?? "";
}

function previa(p: WahaPayload): string {
  const texto = bodyOf(p)?.trim();
  if (texto) return texto.slice(0, 280);
  const tipo = resolveMessageType(p);
  return tipo === "text" ? "" : `[${tipo}]`;
}

async function conversaHistorica(
  admin: Admin,
  organizationId: string,
  contactId: string,
  sessionId: string,
): Promise<string> {
  const { data, error } = await admin.rpc("fn_upsert_wa_historical_conversation" as never, {
    p_org: organizationId,
    p_contact: contactId,
    p_session: sessionId,
  } as never);
  if (error || !data) throw new Error(`historical_conversation_failed:${error?.message ?? "empty"}`);
  return data as string;
}

async function atualizarResumoDaConversa(
  admin: Admin,
  organizationId: string,
  conversationId: string,
  direction: "inbound" | "outbound",
  sentAt: string,
  preview: string,
): Promise<void> {
  const { data } = await admin
    .from("conversations")
    .select("last_message_at,last_inbound_at,last_outbound_at")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) return;

  const mudancas: Record<string, string> = {};
  if (!data.last_message_at || sentAt > data.last_message_at) {
    mudancas.last_message_at = sentAt;
    mudancas.last_message_preview = preview;
  }
  if (direction === "inbound" && (!data.last_inbound_at || sentAt > data.last_inbound_at)) {
    mudancas.last_inbound_at = sentAt;
  }
  if (direction === "outbound" && (!data.last_outbound_at || sentAt > data.last_outbound_at)) {
    mudancas.last_outbound_at = sentAt;
  }
  if (Object.keys(mudancas).length === 0) return;
  await admin
    .from("conversations")
    .update(mudancas)
    .eq("organization_id", organizationId)
    .eq("id", conversationId);
}

async function importarMensagem(
  admin: Admin,
  organizationId: string,
  sessionId: string,
  p: WahaPayload,
): Promise<"importada" | "repetida" | "ignorada"> {
  const chatId = chatDaMensagem(p);
  const identidade = parseChatId(chatId);
  const corpo = bodyOf(p);
  if (!p.id || (!corpo && !mediaUrlOf(p) && !p.hasMedia)) return "ignorada";
  if (identidade.kind !== "phone" && identidade.kind !== "lid") return "ignorada";

  const contactId = await upsertContact(
    admin,
    organizationId,
    identidade,
    chatId,
    p.fromMe ? null : notifyNameOf(p),
    telefoneAlternativoDe(p),
  );
  if (!contactId) return "ignorada";
  const conversationId = await conversaHistorica(admin, organizationId, contactId, sessionId);
  const direction = p.fromMe ? "outbound" : "inbound";
  const externalId = p.fromMe ? bareWaMessageId(p.id) : p.id;
  const sentAt = dataDoTimestamp(p.timestamp, new Date().toISOString());
  const status = p.fromMe
    ? ackToStatus(p.ack) === "sending" ? "sent" : ackToStatus(p.ack)
    : "received";
  const telefoneAlt = telefoneAlternativoDe(p);

  const { error } = await admin.from("messages").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    channel_session_id: sessionId,
    contact_id: contactId,
    external_id: externalId,
    type: resolveMessageType(p),
    direction,
    status,
    ack: p.ack ?? null,
    body: corpo,
    media_url: mediaUrlOf(p),
    media_mime: mediaMimeOf(p),
    sent_via: "external_device",
    sent_at: sentAt,
    created_at: sentAt,
    metadata: {
      historical_import: true,
      raw_type: p.type ?? null,
      fromMe: Boolean(p.fromMe),
      ...(telefoneAlt ? { alternate_phone: canonicalPhoneBR(telefoneAlt) } : {}),
    },
  });
  if (error?.code === "23505") return "repetida";
  if (error) throw new Error(`historical_message_failed:${error.message}`);

  await atualizarResumoDaConversa(
    admin,
    organizationId,
    conversationId,
    direction,
    sentAt,
    previa(p),
  );
  return "importada";
}

export async function importarLoteDoHistorico(args: {
  admin: Admin;
  organizationId: string;
  sessionId: string;
  sessionName: string;
  desde: string;
  offset: number;
}): Promise<ResultadoDoLoteDeHistorico> {
  const client = getWahaClient();
  if (!client) throw new Error("channel_unavailable");
  const desdeUnix = Math.floor(new Date(args.desde).getTime() / 1000);
  const mensagens = await client.listarMensagensGuardadas(
    args.sessionName,
    desdeUnix,
    args.offset,
    TAMANHO_DO_LOTE_DE_HISTORICO,
  );

  let importadas = 0;
  let repetidas = 0;
  let ignoradas = 0;
  for (const mensagem of mensagens) {
    const resultado = await importarMensagem(
      args.admin,
      args.organizationId,
      args.sessionId,
      mensagem,
    );
    if (resultado === "importada") importadas += 1;
    else if (resultado === "repetida") repetidas += 1;
    else ignoradas += 1;
  }

  return {
    lidas: mensagens.length,
    importadas,
    repetidas,
    ignoradas,
    proximo_offset: args.offset + mensagens.length,
    concluido: mensagens.length < TAMANHO_DO_LOTE_DE_HISTORICO,
  };
}
