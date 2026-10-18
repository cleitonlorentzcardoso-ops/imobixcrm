/** Importação manual de etiquetas: leitura no canal, escrita só no CRM da organização. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createLeadHandler, moveLeadHandler, updateLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { getAdapter } from "@/lib/channels";
import { ORIGEM_DO_WHATSAPP } from "@/lib/channels/origem-do-negocio";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels/session-ref";
import type { ChannelLabeledContact, ChannelLabel, ChannelProvider } from "@/lib/channels/types";

export interface LabelMapping {
  label_id: string;
  pipeline_id: string;
  stage_id: string;
}
type Assignment = { contact: ChannelLabeledContact; label: ChannelLabel; mapping: LabelMapping };

export class LabelImportError extends Error {
  constructor(
    public readonly code:
      "session_not_found" | "unsupported_channel" | "invalid_mapping" | "no_labels",
  ) {
    super(code);
  }
}

async function sessionAndAdapter(admin: SupabaseClient, org: string, sessionId: string) {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(`id, ${CHANNEL_SESSION_REF_COLUMNS}`)
    .eq("organization_id", org)
    .eq("id", sessionId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new LabelImportError("session_not_found");
  const ref = data as unknown as ChannelSessionRef;
  const adapter = getAdapter(ref.provider as ChannelProvider);
  if (!adapter.listLabels || !adapter.listLabeledContacts)
    throw new LabelImportError("unsupported_channel");
  return { adapter, sessionRef: resolveSessionRef(ref) };
}

export async function listChannelLabels(admin: SupabaseClient, org: string, sessionId: string) {
  const { adapter, sessionRef } = await sessionAndAdapter(admin, org, sessionId);
  return adapter.listLabels!({ sessionRef });
}

/** Constrói um plano determinístico. Duas etiquetas mapeadas no mesmo contato = conflito, não "última vence". */
export async function planLabelImport(
  admin: SupabaseClient,
  org: string,
  sessionId: string,
  mappings: LabelMapping[],
) {
  const { adapter, sessionRef } = await sessionAndAdapter(admin, org, sessionId);
  const labels = await adapter.listLabels!({ sessionRef });
  if (labels.length === 0) throw new LabelImportError("no_labels");
  const known = new Map(labels.map((label) => [label.id, label]));
  const stageIds = mappings.map((m) => m.stage_id);
  const { data: stages, error } = await admin
    .from("crm_stages")
    .select("id, pipeline_id, is_won, is_lost, is_archived")
    .eq("organization_id", org)
    .in("id", stageIds);
  if (error) throw error;
  const validStages = new Map((stages ?? []).map((stage) => [stage.id, stage]));
  const pipelineIds = [...new Set(mappings.map((mapping) => mapping.pipeline_id))];
  const { data: pipelines, error: pipelineError } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", org)
    .eq("is_archived", false)
    .in("id", pipelineIds);
  if (pipelineError) throw pipelineError;
  const validPipelines = new Set((pipelines ?? []).map((pipeline) => pipeline.id));
  for (const mapping of mappings) {
    const stage = validStages.get(mapping.stage_id);
    if (
      !known.has(mapping.label_id) ||
      !validPipelines.has(mapping.pipeline_id) ||
      !stage ||
      stage.pipeline_id !== mapping.pipeline_id ||
      stage.is_won ||
      stage.is_lost ||
      stage.is_archived
    )
      throw new LabelImportError("invalid_mapping");
  }
  const labeled = await Promise.all(
    mappings.map(async (mapping) => ({
      mapping,
      label: known.get(mapping.label_id)!,
      contacts: await adapter.listLabeledContacts!({ sessionRef, labelId: mapping.label_id }),
    })),
  );
  return makeLabelAssignments(labeled);
}

/** Parte pura do plano: colisões entre etiquetas não ganham destino arbitrário. */
export function makeLabelAssignments(
  labeled: Array<{
    mapping: LabelMapping;
    label: ChannelLabel;
    contacts: ChannelLabeledContact[];
  }>,
) {
  const all = new Map<string, Assignment>();
  const conflicts = new Set<string>();
  for (const { mapping, label, contacts } of labeled) {
    for (const contact of contacts) {
      const previous = all.get(contact.chatId);
      if (previous && previous.label.id !== label.id) conflicts.add(contact.chatId);
      else all.set(contact.chatId, { contact, label, mapping });
    }
  }
  for (const chatId of conflicts) all.delete(chatId);
  return {
    assignments: [...all.values()].sort((a, b) =>
      a.contact.chatId < b.contact.chatId ? -1 : a.contact.chatId > b.contact.chatId ? 1 : 0,
    ),
    conflicts: conflicts.size,
  };
}

type BatchResult = {
  created: number;
  moved: number;
  tagged: number;
  unchanged: number;
  skipped: number;
  failed: number;
};

/** Um lote curto por pedido evita timeout; repetir é seguro (não duplica negócio aberto). */
export async function importLabelBatch(
  admin: SupabaseClient,
  org: string,
  ctx: HandlerCtx,
  assignments: Assignment[],
  after: string | null,
  sessionId: string,
): Promise<BatchResult & { next: string | null }> {
  const remaining = assignments.filter((a) => after === null || a.contact.chatId > after);
  const batch = remaining.slice(0, 20);
  const result: BatchResult = {
    created: 0,
    moved: 0,
    tagged: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
  for (const { contact, label, mapping } of batch) {
    try {
      const { data: contactId, error: upsertError } = await admin.rpc(
        "fn_upsert_wa_contact" as never,
        {
          p_org: org,
          p_kind: contact.identity.kind,
          p_phone: contact.identity.phone,
          p_lid: contact.identity.lid,
          p_chat_id: contact.chatId,
          p_notify: contact.name,
        } as never,
      );
      if (upsertError || !contactId) throw upsertError ?? new Error("contact_not_created");
      const id = String(contactId);
      const { data: person, error: personError } = await admin
        .from("contacts")
        .select("id, display_name, is_anonymized, is_merged_into")
        .eq("organization_id", org)
        .eq("id", id)
        .maybeSingle();
      if (personError) throw personError;
      if (!person || person.is_anonymized || person.is_merged_into) {
        result.skipped++;
        continue;
      }

      const { data: open, error: openError } = await admin
        .from("crm_leads")
        .select("id, pipeline_id, stage_id, tags")
        .eq("organization_id", org)
        .eq("contact_id", id)
        .eq("status", "open")
        .limit(3);
      if (openError) throw openError;
      // Não atravessa outro funil nem escolhe arbitrariamente entre duplicados.
      if (
        (open ?? []).some((lead) => lead.pipeline_id !== mapping.pipeline_id) ||
        (open ?? []).length > 1
      ) {
        result.skipped++;
        continue;
      }
      const existing = open?.[0];
      if (existing) {
        if (existing.stage_id !== mapping.stage_id) {
          await moveLeadHandler(admin, ctx, existing.id, {
            to_stage_id: mapping.stage_id,
            reason: "Importação de etiqueta do WhatsApp Business",
          });
          result.moved++;
        }
        const tags = Array.isArray(existing.tags)
          ? existing.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        if (!tags.includes(label.name)) {
          await updateLeadHandler(admin, ctx, existing.id, { tags: [...tags, label.name] });
          result.tagged++;
        } else if (existing.stage_id === mapping.stage_id) result.unchanged++;
        continue;
      }
      const name = (
        person.display_name ||
        contact.name ||
        contact.identity.phone ||
        "Contato do WhatsApp"
      ).slice(0, 180);
      await createLeadHandler(admin, ctx, {
        pipeline_id: mapping.pipeline_id,
        stage_id: mapping.stage_id,
        title: name.length >= 2 ? name : "Contato do WhatsApp",
        contact_id: id,
        tags: [label.name],
        source: ORIGEM_DO_WHATSAPP.source,
        source_metadata: { channel_session_id: sessionId, whatsapp_label_id: label.id },
        // Importação de acervo, não lead que acabou de chegar: não inscrever
        // automaticamente todo o lote no gatilho de follow-up "Lead criado".
        via_planilha: true,
      });
      result.created++;
    } catch {
      // Um contato com campos obrigatórios pendentes não interrompe os demais;
      // o operador vê a contagem e pode corrigir/repetir sem duplicar.
      result.failed++;
    }
  }
  return {
    ...result,
    next: remaining.length > batch.length ? (batch.at(-1)?.contact.chatId ?? null) : null,
  };
}
