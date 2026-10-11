import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const createQueueSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional(),
  member_ids: z.array(z.string().uuid()).max(100).default([]),
  is_default: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service_queues")
    .select("id, name, description, is_default, active, created_at, service_queue_members(user_id)")
    .eq("organization_id", authz.org.orgId)
    .eq("active", true)
    .order("name");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_routing" });
  if (!authz.ok) return authz.response;
  let input: z.infer<typeof createQueueSchema>;
  try { input = await validateRequest(createQueueSchema, req); }
  catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { details: err.details as Record<string, unknown> | undefined, requestId });
    throw err;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_create_service_queue", {
    p_organization_id: authz.org.orgId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_member_ids: input.member_ids,
    p_is_default: input.is_default ?? false,
  });
  if (error) return fail("unprocessable_entity", error.message, 422, { requestId });
  await audit({ action: "service_queue.created", actorUserId: authz.user.id, organizationId: authz.org.orgId, resourceType: "service_queue", resourceId: data as string, requestId });
  return ok({ id: data }, { requestId });
}
