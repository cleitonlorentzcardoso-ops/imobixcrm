import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { idsDeContatosPessoais } from "@/app/api/v1/conversations/_handler";

export const dynamic = "force-dynamic";
interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id: queueId } = await ctx.params;
  if (!z.string().uuid().safeParse(queueId).success) return fail("invalid_request", "Fila inválida.", 400, { requestId });
  const page = z.coerce.number().int().min(0).max(1000).safeParse(new URL(req.url).searchParams.get("page") ?? "0");
  if (!page.success) return fail("invalid_request", "Página inválida.", 400, { requestId });
  const supabase = await createClient();
  const { data: queue, error: queueError } = await supabase.from("service_queues")
    .select("id, service_queue_members(user_id)")
    .eq("id", queueId).eq("organization_id", authz.org.orgId).eq("active", true).maybeSingle();
  if (queueError) return fail("internal_error", queueError.message, 500, { requestId });
  if (!queue) return fail("not_found", "Fila não encontrada.", 404, { requestId });
  if (ROLE_RANK[authz.org.role] < ROLE_RANK.manager &&
      !queue.service_queue_members.some((member) => member.user_id === authz.user.id)) {
    return fail("forbidden", "Você não faz parte desta fila.", 403, { requestId });
  }
  const from = page.data * 50;
  let conversationsQuery = supabase.from("conversations")
    .select("id, contact_id, awaiting_since, last_message_preview, created_at, contacts:contact_id(display_name, name, phone_number)", { count: "exact" })
    .eq("organization_id", authz.org.orgId).eq("service_queue_id", queueId)
    .in("status", ["open", "pending"]).is("assigned_to_user_id", null);
  const personalContacts = await idsDeContatosPessoais(supabase, authz.org.orgId);
  if (personalContacts.length > 0) conversationsQuery = conversationsQuery.not("contact_id", "in", `(${personalContacts.join(",")})`);
  const { data, count, error } = await conversationsQuery
    .order("awaiting_since", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true }).range(from, from + 49);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ conversations: data ?? [], count: count ?? 0, page: page.data }, { requestId });
}
