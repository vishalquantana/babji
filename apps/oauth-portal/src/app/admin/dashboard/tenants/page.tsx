"use client";
import Link from "next/link";
import { useDashboard } from "../../../../components/admin/DashboardContext";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function planBadgeColor(plan: string): string {
  if (plan === "pro") return "#8b5cf6";
  if (plan === "prepaid") return "#f59e0b";
  return "#6b7280";
}

export default function TenantsPage() {
  const { data } = useDashboard();

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
        Tenants
      </h1>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 20px" }}>
        {data.tenants.length} registered tenants
      </p>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {data.tenants.length === 0 ? (
          <p style={{ color: "#888", padding: 24 }}>No tenants yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Name
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Plan
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Phone
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Telegram
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Last Active
                </th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t: any) => (
                <tr key={t.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>
                    <Link
                      href={`/admin/dashboard/tenant/${t.id}`}
                      style={{ color: "#2563eb", textDecoration: "none" }}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: planBadgeColor(t.plan),
                        color: "white",
                      }}
                    >
                      {t.plan}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#666" }}>{t.phone || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#666" }}>{t.telegramUserId || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#888" }}>{timeAgo(t.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
