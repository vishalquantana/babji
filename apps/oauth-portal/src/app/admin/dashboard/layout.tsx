import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "../../../lib/admin-auth";
import { DashboardLayout } from "./layout-client";

async function fetchDashboardData() {
  const port = process.env.PORT || 3100;
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/data`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard data");
  return res.json();
}

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAdminAuthenticated();
  if (!authed) redirect("/admin");

  const data = await fetchDashboardData();

  return <DashboardLayout data={data}>{children}</DashboardLayout>;
}
