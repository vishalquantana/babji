import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { TenantDetailClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin");
  }

  const { tenantId } = await params;
  return <TenantDetailClient tenantId={tenantId} />;
}
