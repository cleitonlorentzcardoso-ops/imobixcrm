import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { transferConversationToQueueSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  let input;
  try { input = await validateRequest(transferConversationToQueueSchema, req); }
  catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    throw err;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_conversation_send_to_queue", {
    p_organization_id: authz.org.orgId, p_conversation_id: id, p_queue_id: input.queue_id,
  });
  if (error) return fail("unprocessable_entity", error.message, 422, { requestId });
  if (!data) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  await audit({ action: "conversation.sent_to_queue", actorUserId: authz.user.id, organizationId: authz.org.orgId, resourceType: "conversation", resourceId: id, requestId, metadata: { queue_id: input.queue_id, ...(input.reason ? { note: input.reason } : {}) } });
  return ok(data, { requestId });
}
