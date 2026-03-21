"use client";

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

function badgeStyle(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: color,
    color: "white",
  };
}

export default function ConnectionsPage() {
  const { data } = useDashboard();

  // Build tenant name lookup
  const tenantNames: Record<string, string> = {};
  for (const t of data.tenants) {
    tenantNames[t.id] = t.name;
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>
        Service Connections
      </h1>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 20px" }}>
        {data.connections.length} active connections
      </p>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {data.connections.length === 0 ? (
          <p style={{ color: "#888", padding: 24, margin: 0 }}>No connections yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Tenant
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Provider
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Scopes
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Expires
                </th>
                <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>
                  Connected
                </th>
              </tr>
            </thead>
            <tbody>
              {data.connections.map((c: any) => {
                const isExpired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 500 }}>
                      {tenantNames[c.tenantId] || c.tenantId.slice(0, 8)}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={badgeStyle("#2563eb")}>{c.provider}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#666" }}>
                      {c.scopes ? `${c.scopes.length} scopes` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: isExpired ? "#e53e3e" : "#888" }}>
                      {c.expiresAt ? (isExpired ? `Expired ${timeAgo(c.expiresAt)}` : timeAgo(c.expiresAt)) : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#888" }}>
                      {timeAgo(c.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
