import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { DashboardClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin");
  }

  return <DashboardClient />;
}
