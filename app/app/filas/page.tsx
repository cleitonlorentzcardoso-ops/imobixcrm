import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { FilasClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function FilasPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const platformAdmin = user.is_platform_admin && !user.support;
  if (!platformAdmin && ROLE_RANK[org.role] < ROLE_RANK.agent) redirect("/403");
  return <FilasClient canManage={platformAdmin || ROLE_RANK[org.role] >= ROLE_RANK.manager} />;
}
