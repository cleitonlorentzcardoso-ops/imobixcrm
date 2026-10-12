import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const updateQueueSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional(),
  member_ids: z.array(z.string().uuid()).max(100),
  campaign_ids: z.array(z.string().trim().min(1).max(100)).max(100),
});

interface RouteCtx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_routing" });
  if (!authz.ok) return authz.response;
  const { id: queueId } = await ctx.params;
  if (!z.string().uuid().safeParse(queueId).success) return fail("invalid_request", "Fila inválida.", 400, { requestId });

  let input: z.infer<typeof updateQueueSchema>;
  try { input = await validateRequest(updateQueueSchema, req); }
  catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    throw err;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_update_service_queue", {
    p_organization_id: authz.org.orgId,
    p_queue_id: queueId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_member_ids: [...new Set(input.member_ids)],
    p_campaign_ids: [...new Set(input.campaign_ids)],
  });
  if (error) return fail("unprocessable_entity", error.message, 422, { requestId });
  await audit({ action: "service_queue.updated", actorUserId: authz.user.id,
    organizationId: authz.org.orgId, resourceType: "service_queue", resourceId: queueId, requestId });
  return ok({ id: queueId }, { requestId });
}
