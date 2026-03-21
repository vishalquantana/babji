"use client";
import { useDashboard } from "../../../../components/admin/DashboardContext";

interface UsageRow {
  tenant_name: string;
  tenant_id: string;
  messages: string;
  total_tokens: string;
  input_tokens: string;
  output_tokens: string;
  tool_calls: string;
  external_api_calls: string;
  bg_jobs: string;
  total_credits: string;
}

export default function ActivityPage() {
  const { data } = useDashboard();

  const usageSummary: UsageRow[] = Array.isArray(data.usageSummary)
    ? data.usageSummary
    : [];

  const totalMessages = usageSummary.reduce(
    (sum, r) => sum + parseInt(r.messages || "0", 10),
    0
  );
  const totalTokens = usageSummary.reduce(
    (sum, r) => sum + parseInt(r.total_tokens || "0", 10),
    0
  );
  const totalToolCalls = usageSummary.reduce(
    (sum, r) => sum + parseInt(r.tool_calls || "0", 10),
    0
  );
  const totalExternalApis = usageSummary.reduce(
    (sum, r) => sum + parseInt(r.external_api_calls || "0", 10),
    0
  );

  const audit: any[] = Array.isArray(data.audit) ? data.audit : [];

  const tenantNames: Record<string, string> = {};
  if (Array.isArray(data.tenants)) {
    for (const t of data.tenants) {
      tenantNames[t.id] = t.name || t.id;
    }
  }

  const statBoxStyle: React.CSSProperties = {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    textAlign: "center",
    minWidth: 100,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: 24,
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 12px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e5e7eb",
  };

  const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 14,
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  };

  const tdRightStyle: React.CSSProperties = { ...tdStyle, textAlign: "right" };

  return (
    <div style={{ padding: "24px", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
        Activity &amp; Usage
      </h1>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 24 }}>
        7-day usage summary and audit trail
      </p>

      {/* Usage Summary Card */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 16 }}>
          Usage Summary (Last 7 Days)
        </h2>

        {/* Stat Boxes */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#2563eb" }}>
              {totalMessages.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Messages</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#8b5cf6" }}>
              {totalTokens.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Tokens</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>
              {totalToolCalls.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Tool Calls</div>
          </div>
          <div style={statBoxStyle}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>
              {totalExternalApis.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>External APIs</div>
          </div>
        </div>

        {/* Per-Tenant Breakdown Table */}
        {usageSummary.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb" }}>
                  <th style={thStyle}>Tenant</th>
                  <th style={thRightStyle}>Messages</th>
                  <th style={thRightStyle}>Tokens</th>
                  <th style={thRightStyle}>Tool Calls</th>
                  <th style={thRightStyle}>Ext. APIs</th>
                  <th style={thRightStyle}>Credits</th>
                </tr>
              </thead>
              <tbody>
                {usageSummary.map((row) => (
                  <tr key={row.tenant_id} style={{ cursor: "default" }}>
                    <td style={tdStyle}>{row.tenant_name || row.tenant_id}</td>
                    <td style={tdRightStyle}>{parseInt(row.messages || "0", 10).toLocaleString()}</td>
                    <td style={tdRightStyle}>{parseInt(row.total_tokens || "0", 10).toLocaleString()}</td>
                    <td style={tdRightStyle}>{parseInt(row.tool_calls || "0", 10).toLocaleString()}</td>
                    <td style={tdRightStyle}>{parseInt(row.external_api_calls || "0", 10).toLocaleString()}</td>
                    <td style={tdRightStyle}>{parseInt(row.total_credits || "0", 10).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af", textAlign: "center", padding: "24px 0" }}>
            No usage data for the last 7 days.
          </p>
        )}
      </div>

      <div style={{ height: 24 }} />

      {/* Recent Audit Log Card */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#111827", marginBottom: 16 }}>
          Recent Activity
        </h2>

        {audit.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb" }}>
                  <th style={thStyle}>Tenant</th>
                  <th style={thStyle}>Action</th>
                  <th style={thStyle}>Skill</th>
                  <th style={thStyle}>Channel</th>
                  <th style={thRightStyle}>Credits</th>
                  <th style={thStyle}>When</th>
                </tr>
              </thead>
              <tbody>
                {audit.slice(0, 50).map((entry: any, idx: number) => {
                  const tenantId = entry.tenantId || entry.tenant_id;
                  const tenantName = tenantNames[tenantId] || tenantId || "—";
                  const action = entry.action || "—";
                  const skillName = entry.skillName || entry.skill_name || "—";
                  const channel = entry.channel || "—";
                  const creditCost = entry.creditCost ?? entry.credit_cost ?? 0;
                  const createdAt = entry.createdAt || entry.created_at;

                  let whenStr = "—";
                  if (createdAt) {
                    try {
                      whenStr = new Date(createdAt).toLocaleString();
                    } catch {
                      whenStr = String(createdAt);
                    }
                  }

                  return (
                    <tr key={idx}>
                      <td style={tdStyle}>{tenantName}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            fontSize: 12,
                            padding: "2px 8px",
                            borderRadius: 9999,
                            backgroundColor: "#eff6ff",
                            color: "#1d4ed8",
                          }}
                        >
                          {action}
                        </span>
                      </td>
                      <td style={tdStyle}>{skillName}</td>
                      <td style={tdStyle}>{channel}</td>
                      <td style={tdRightStyle}>
                        {creditCost > 0 ? (
                          <span style={{ color: "#ef4444" }}>-{creditCost}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "#9ca3af" }}>{whenStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#9ca3af", textAlign: "center", padding: "24px 0" }}>
            No recent activity.
          </p>
        )}
      </div>
    </div>
  );
}
