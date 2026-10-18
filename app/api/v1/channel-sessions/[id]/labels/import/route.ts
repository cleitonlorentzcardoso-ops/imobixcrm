/** Prévia e importação em lotes das etiquetas do WhatsApp Business para o funil. */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  importLabelBatch,
  LabelImportError,
  listChannelLabels,
  planLabelImport,
} from "@/lib/channels/label-import";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid();
const bodySchema = z
  .object({
    mode: z.enum(["preview", "apply"]),
    mappings: z
      .array(
        z
          .object({
            label_id: z.string().min(1).max(100),
            pipeline_id: uuid,
            stage_id: uuid,
          })
          .strict(),
      )
      .min(1)
      .max(30)
      .refine(
        (mappings) => new Set(mappings.map((m) => m.label_id)).size === mappings.length,
        "etiqueta duplicada",
      ),
    after: z.string().max(200).nullable().optional(),
    automations_reviewed: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.mode === "preview" || body.automations_reviewed === true);

function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof LabelImportError) {
    const messages = {
      session_not_found: "Conexão não encontrada nesta empresa.",
      unsupported_channel: "Este canal não oferece leitura de etiquetas.",
      invalid_mapping: "Confira as etiquetas e as colunas escolhidas.",
      no_labels: "Este número não tem etiquetas disponíveis.",
    };
    return fail(error.code, messages[error.code], error.code === "session_not_found" ? 404 : 422, {
      requestId,
    });
  }
  logger.warn("importação de etiquetas: falha ao ler canal ou banco", {
    requestId,
    error: error instanceof Error ? error.message : "unknown",
  });
  return fail(
    "channel_unavailable",
    "Não foi possível ler as etiquetas agora. Confira a conexão e tente novamente.",
    502,
    { requestId },
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "channel_label_import" });
  if (!authz.ok) return authz.response;
  const id = uuid.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_error", "Conexão inválida.", 400, { requestId });
  try {
    return ok(await listChannelLabels(createAdminClient(), authz.org.orgId, id.data), {
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "channel_label_import" });
  if (!authz.ok) return authz.response;
  const id = uuid.safeParse((await ctx.params).id);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success)
    return fail("validation_error", "Confira o mapeamento das etiquetas.", 400, { requestId });
  if (parsed.data.mode === "apply") {
    const denied = await requireSupportWrite();
    if (denied) return denied;
  }
  try {
    const admin = createAdminClient();
    const plan = await planLabelImport(admin, authz.org.orgId, id.data, parsed.data.mappings);
    if (parsed.data.mode === "preview") {
      return ok(
        {
          contacts: plan.assignments.length,
          conflicts: plan.conflicts,
          per_label: parsed.data.mappings.map((mapping) => ({
            label_id: mapping.label_id,
            contacts: plan.assignments.filter(
              (assignment) => assignment.label.id === mapping.label_id,
            ).length,
          })),
        },
        { requestId },
      );
    }
    const batch = await importLabelBatch(
      admin,
      authz.org.orgId,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
        idioma: authz.user.idioma,
      },
      plan.assignments,
      parsed.data.after ?? null,
      id.data,
    );
    return ok({ ...batch, conflicts: plan.conflicts }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
