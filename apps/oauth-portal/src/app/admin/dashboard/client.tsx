"use client";

import { useEffect, useState } from "react";

interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  telegramUserId: string | null;
  plan: string;
  createdAt: string;
  lastActiveAt: string;
}

interface Connection {
  id: string;
  tenantId: string;
  provider: string;
  scopes: string[];
  expiresAt: string;
  createdAt: string;
}

interface SkillRequest {
  id: string;
  tenantId: string;
  skillName: string;
  context: string;
  status: string;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  tenantId: string;
  action: string;
  skillName: string | null;
  channel: string | null;
  creditCost: number;
  createdAt: string;
}

interface DashboardData {
  tenants: Tenant[];
  connections: Connection[];
  skillRequests: SkillRequest[];
  recentAudit: AuditEntry[];
}

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 24,
  marginBottom: 24,
  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 12,
  fontSize: 12,
  fontWeight: 600,
  backgroundColor: color,
  color: "white",
});

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

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/data")
      .then((r) => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div style={{ textAlign: "center", marginTop: 100 }}>
        <p style={{ color: "#e53e3e" }}>{error}</p>
        <a href="/admin">Back to login</a>
      </div>
    );
  }

  if (!data) {
    return <p style={{ textAlign: "center", marginTop: 100, color: "#888" }}>Loading...</p>;
  }

  // Build a tenant name lookup
  const tenantNames: Record<string, string> = {};
  for (const t of data.tenants) {
    tenantNames[t.id] = t.name;
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Babji Admin</h1>
        <span style={{ color: "#888", fontSize: 14 }}>
          {data.tenants.length} tenants &middot; {data.connections.length} connections
        </span>
      </div>

      {/* Tenants */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Tenants</h2>
        {data.tenants.length === 0 ? (
          <p style={{ color: "#888" }}>No tenants yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "8px 0" }}>Name</th>
                <th>Plan</th>
                <th>Phone</th>
                <th>Telegram</th>
                <th>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "8px 0", fontWeight: 500 }}>{t.name}</td>
                  <td>
                    <span style={badgeStyle(t.plan === "pro" ? "#8b5cf6" : t.plan === "prepaid" ? "#f59e0b" : "#6b7280")}>
                      {t.plan}
                    </span>
                  </td>
                  <td style={{ color: "#666" }}>{t.phone || "—"}</td>
                  <td style={{ color: "#666" }}>{t.telegramUserId || "—"}</td>
                  <td style={{ color: "#888" }}>{timeAgo(t.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Service Connections */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Service Connections</h2>
        {data.connections.length === 0 ? (
          <p style={{ color: "#888" }}>No connections yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "8px 0" }}>Tenant</th>
                <th>Provider</th>
                <th>Scopes</th>
                <th>Expires</th>
                <th>Connected</th>
              </tr>
            </thead>
            <tbody>
              {data.connections.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "8px 0" }}>{tenantNames[c.tenantId] || c.tenantId.slice(0, 8)}</td>
                  <td>
                    <span style={badgeStyle("#2563eb")}>{c.provider}</span>
                  </td>
                  <td style={{ color: "#666", fontSize: 12 }}>{c.scopes.length} scopes</td>
                  <td style={{ color: new Date(c.expiresAt) < new Date() ? "#e53e3e" : "#888" }}>
                    {new Date(c.expiresAt) < new Date() ? "Expired" : timeAgo(c.expiresAt)}
                  </td>
                  <td style={{ color: "#888" }}>{timeAgo(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Skill Requests */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Skill Requests</h2>
        {data.skillRequests.length === 0 ? (
          <p style={{ color: "#888" }}>No skill requests yet — users will ask to &quot;check with my teacher&quot; when they need new capabilities</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "8px 0" }}>Tenant</th>
                <th>Skill</th>
                <th>Context</th>
                <th>Status</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {data.skillRequests.map((sr) => (
                <tr key={sr.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "8px 0" }}>{tenantNames[sr.tenantId] || sr.tenantId.slice(0, 8)}</td>
                  <td style={{ fontWeight: 500 }}>{sr.skillName}</td>
                  <td style={{ color: "#666", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sr.context}
                  </td>
                  <td>
                    <span
                      style={badgeStyle(
                        sr.status === "completed" ? "#10b981" : sr.status === "rejected" ? "#ef4444" : sr.status === "in_progress" ? "#f59e0b" : "#6b7280"
                      )}
                    >
                      {sr.status}
                    </span>
                  </td>
                  <td style={{ color: "#888" }}>{timeAgo(sr.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Activity */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Recent Activity</h2>
        {data.recentAudit.length === 0 ? (
          <p style={{ color: "#888" }}>No activity logged yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "8px 0" }}>Tenant</th>
                <th>Action</th>
                <th>Skill</th>
                <th>Channel</th>
                <th>Credits</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentAudit.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "8px 0" }}>{tenantNames[a.tenantId] || a.tenantId.slice(0, 8)}</td>
                  <td>{a.action}</td>
                  <td style={{ color: "#666" }}>{a.skillName || "—"}</td>
                  <td style={{ color: "#666" }}>{a.channel || "—"}</td>
                  <td>{a.creditCost > 0 ? `-${a.creditCost}` : "—"}</td>
                  <td style={{ color: "#888" }}>{timeAgo(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
