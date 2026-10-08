import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { importarLoteDoHistorico } from "@/lib/channels/importar-historico";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  channel_session_id: z.string().uuid(),
  dias: z.number().int().min(1).max(3650),
  offset: z.number().int().min(0).max(5_000_000).default(0),
  desde: z.string().datetime().optional(),
});

function historicoLigado(metadata: unknown): boolean {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).guardar_historico === true,
  );
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "conversation_data" });
  if (!authz.ok) return authz.response;
  const { data, error } = await createAdminClient()
    .from("channel_sessions")
    .select("id,display_name,phone_number,status,metadata,waha_session_name")
    .eq("organization_id", authz.org.orgId)
    .eq("provider", "waha")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    return fail("internal_error", traduzir("Não foi possível listar as conexões.", authz.user.idioma), 500, { requestId });
  }
  return ok(
    (data ?? []).map((canal) => ({
      id: canal.id,
      nome: canal.display_name || canal.phone_number || "WhatsApp",
      status: canal.status,
      historico_ligado: historicoLigado(canal.metadata),
      pronto: Boolean(canal.waha_session_name),
    })),
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "conversation_data" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", t("Escolha uma conexão e um período válido."), 400, { requestId });
  }
  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const { data: canal, error } = await admin
    .from("channel_sessions")
    .select("id,status,metadata,waha_session_name")
    .eq("organization_id", orgId)
    .eq("id", parsed.data.channel_session_id)
    .eq("provider", "waha")
    .is("archived_at", null)
    .maybeSingle();
  if (error || !canal) {
    return fail("not_found", t("Conexão não encontrada."), 404, { requestId });
  }
  if (!historicoLigado(canal.metadata)) {
    return fail(
      "history_not_enabled",
      t("Ative primeiro a opção de guardar histórico nesta conexão."),
      409,
      { requestId },
    );
  }
  if (!canal.waha_session_name || canal.status !== "WORKING") {
    return fail("channel_unavailable", t("Esta conexão precisa estar online para importar."), 409, { requestId });
  }

  const agora = Date.now();
  const calculado = new Date(agora - parsed.data.dias * 86_400_000).toISOString();
  const desde = parsed.data.offset === 0 ? calculado : parsed.data.desde;
  const limiteAntigo = agora - 3650 * 86_400_000;
  const desdeMs = desde ? Date.parse(desde) : Number.NaN;
  if (!desde || !Number.isFinite(desdeMs) || desdeMs < limiteAntigo || desdeMs > agora + 60_000) {
    return fail("invalid_request", t("O período da importação não é válido."), 400, { requestId });
  }

  try {
    const lote = await importarLoteDoHistorico({
      admin,
      organizationId: orgId,
      sessionId: canal.id,
      sessionName: canal.waha_session_name,
      desde,
      offset: parsed.data.offset,
    });
    if (lote.importadas > 0) {
      void audit({
        action: "conversation_history.batch_imported",
        actorUserId: authz.user.id,
        organizationId: orgId,
        resourceType: "channel_session",
        resourceId: canal.id,
        requestId,
        metadata: {
          dias: parsed.data.dias,
          offset: parsed.data.offset,
          importadas: lote.importadas,
          repetidas: lote.repetidas,
          ignoradas: lote.ignoradas,
        },
      });
    }
    return ok({ ...lote, desde }, { requestId });
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "unknown";
    logger.error("[historico] lote de importação falhou", {
      requestId,
      organization_id: orgId,
      channel_session_id: canal.id,
      codigo: codigo.split(":", 1)[0],
    });
    if (codigo === "waha_history_unavailable") {
      return fail(
        "history_unavailable",
        t("O canal ainda não tem histórico disponível. Talvez seja necessário vincular o número novamente com a opção de histórico ligada."),
        409,
        { requestId },
      );
    }
    if (codigo === "channel_unavailable") {
      return fail("channel_unavailable", t("O serviço do canal está indisponível."), 503, { requestId });
    }
    return fail("internal_error", t("A importação parou por um erro. Você pode tentar novamente sem duplicar mensagens."), 500, { requestId });
  }
}
