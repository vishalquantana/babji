"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  telegramUserId: string | null;
  plan: string;
  timezone: string;
  containerStatus: string;
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
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  notifiedAt: string | null;
}

interface Job {
  id: string;
  tenantId: string;
  jobType: string;
  scheduleType: string;
  scheduledAt: string;
  recurrenceRule: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  lastRunAt: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  tenantId: string;
  action: string;
  skillName: string | null;
  channel: string | null;
  creditCost: number;
  metadata: unknown;
  createdAt: string;
}

interface Todo {
  id: string;
  tenantId: string;
  title: string;
  notes: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

interface CreditBalance {
  tenantId: string;
  dailyFree: number;
  prepaid: number;
  proMonthly: number;
  lastDailyReset: string;
}

interface CreditTransaction {
  id: string;
  tenantId: string;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

interface TenantDetailData {
  tenant: Tenant;
  connections: Connection[];
  skillRequests: SkillRequest[];
  jobs: Job[];
  audit: AuditEntry[];
  todos: Todo[];
  creditBalance: CreditBalance | null;
  creditTransactions: CreditTransaction[];
}

// ---------------------------------------------------------------------------
// Shared style helpers (matching the main dashboard)
// ---------------------------------------------------------------------------

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

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  padding: "8px 0",
  textAlign: "left",
  borderBottom: "1px solid #eee",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 0",
  borderBottom: "1px solid #f5f5f5",
};

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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function planColor(plan: string): string {
  if (plan === "pro") return "#8b5cf6";
  if (plan === "prepaid") return "#f59e0b";
  return "#6b7280";
}

function statusColor(status: string): string {
  if (status === "completed" || status === "done") return "#10b981";
  if (status === "rejected" || status === "failed") return "#ef4444";
  if (status === "in_progress" || status === "active") return "#f59e0b";
  if (status === "paused") return "#6366f1";
  return "#6b7280";
}

function priorityColor(priority: string): string {
  if (priority === "high") return "#ef4444";
  if (priority === "medium") return "#f59e0b";
  return "#6b7280";
}

// ---------------------------------------------------------------------------
// Payload preview helper
// ---------------------------------------------------------------------------

function payloadPreview(job: Job): string {
  if (!job.payload) return "\u2014";
  const p = job.payload;
  if (job.jobType === "deep_research" && typeof p.query === "string") {
    return p.query.length > 80 ? p.query.slice(0, 80) + "\u2026" : p.query;
  }
  if (job.jobType === "reminder" && typeof p.text === "string") {
    return p.text.length > 80 ? p.text.slice(0, 80) + "\u2026" : p.text;
  }
  if (job.jobType === "todo_reminder" && typeof p.title === "string") {
    return p.title.length > 80 ? p.title.slice(0, 80) + "\u2026" : p.title;
  }
  // Fallback: JSON preview
  const raw = JSON.stringify(p);
  return raw.length > 80 ? raw.slice(0, 80) + "\u2026" : raw;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TenantDetailClient({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<TenantDetailData | null>(null);
  const [error, setError] = useState("");
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/admin/tenant/${tenantId}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Tenant not found" : "Unauthorized");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [tenantId]);

  // -- Error state ----------------------------------------------------------
  if (error) {
    return (
      <div style={{ textAlign: "center", marginTop: 100 }}>
        <p style={{ color: "#e53e3e", marginBottom: 16 }}>{error}</p>
        <a href="/admin/dashboard" style={{ color: "#2563eb", textDecoration: "none" }}>
          &larr; Back to dashboard
        </a>
      </div>
    );
  }

  // -- Loading state --------------------------------------------------------
  if (!data) {
    return <p style={{ textAlign: "center", marginTop: 100, color: "#888" }}>Loading&hellip;</p>;
  }

  const { tenant, connections, skillRequests, jobs, audit, todos, creditBalance, creditTransactions } = data;

  // Sort todos: pending first, then done
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return 0;
  });

  // -- Complete & Notify handler --------------------------------------------
  async function handleCompleteSkillRequest(requestId: string) {
    setCompletingIds((prev) => new Set(prev).add(requestId));
    try {
      const res = await fetch(`/api/admin/skill-requests/${requestId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      setData((prev) =>
        prev
          ? {
              ...prev,
              skillRequests: prev.skillRequests.map((sr) =>
                sr.id === requestId ? { ...sr, status: "completed" } : sr,
              ),
            }
          : prev,
      );
    } catch {
      alert("Failed to complete skill request");
    } finally {
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* ---- Header ---- */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <a
          href="/admin/dashboard"
          style={{
            color: "#2563eb",
            textDecoration: "none",
            fontSize: 20,
            lineHeight: 1,
          }}
          title="Back to dashboard"
        >
          &larr;
        </a>
        <h1 style={{ fontSize: 24, margin: 0 }}>{tenant.name}</h1>
        <span style={badgeStyle(planColor(tenant.plan))}>{tenant.plan}</span>
        <span style={{ color: "#888", fontSize: 13 }}>{tenant.timezone}</span>
      </div>

      {/* ---- Overview Card ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Overview</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 16,
          }}
        >
          <StatItem label="Member since" value={formatDate(tenant.createdAt)} />
          <StatItem label="Last active" value={timeAgo(tenant.lastActiveAt)} />
          <StatItem
            label="Credits"
            value={
              creditBalance
                ? `${creditBalance.dailyFree} free / ${creditBalance.prepaid} prepaid / ${creditBalance.proMonthly} pro`
                : "No balance record"
            }
          />
          <StatItem label="Connected services" value={String(connections.length)} />
          <StatItem label="Phone" value={tenant.phone || "\u2014"} />
          <StatItem label="Telegram ID" value={tenant.telegramUserId || "\u2014"} />
        </div>
      </div>

      {/* ---- Connected Services ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Connected Services</h2>
        {connections.length === 0 ? (
          <p style={{ color: "#888" }}>No services connected yet</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Provider</th>
                <th style={thStyle}>Scopes</th>
                <th style={thStyle}>Expires</th>
                <th style={thStyle}>Connected</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => {
                const expired = new Date(c.expiresAt) < new Date();
                return (
                  <tr key={c.id}>
                    <td style={tdStyle}>
                      <span style={badgeStyle("#2563eb")}>{c.provider}</span>
                    </td>
                    <td style={{ ...tdStyle, color: "#666", fontSize: 12 }}>
                      {c.scopes.length} scope{c.scopes.length !== 1 ? "s" : ""}
                    </td>
                    <td style={{ ...tdStyle, color: expired ? "#ef4444" : "#888", fontWeight: expired ? 600 : 400 }}>
                      {expired ? "Expired" : timeAgo(c.expiresAt)}
                    </td>
                    <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(c.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Skill Requests ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Skill Requests</h2>
        {skillRequests.length === 0 ? (
          <p style={{ color: "#888" }}>No skill requests from this tenant</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Skill</th>
                <th style={thStyle}>Context</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Requested</th>
                <th style={thStyle}>Resolved</th>
                <th style={thStyle}>Notified</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {skillRequests.map((sr) => (
                <tr key={sr.id}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{sr.skillName}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color: "#666",
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sr.context}
                  </td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(statusColor(sr.status))}>{sr.status}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(sr.createdAt)}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{sr.resolvedAt ? timeAgo(sr.resolvedAt) : "\u2014"}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{sr.notifiedAt ? timeAgo(sr.notifiedAt) : "\u2014"}</td>
                  <td style={tdStyle}>
                    {(sr.status === "pending" || sr.status === "in_progress") && (
                      <button
                        onClick={() => handleCompleteSkillRequest(sr.id)}
                        disabled={completingIds.has(sr.id)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 6,
                          border: "none",
                          backgroundColor: completingIds.has(sr.id) ? "#9ca3af" : "#10b981",
                          color: "white",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: completingIds.has(sr.id) ? "default" : "pointer",
                        }}
                      >
                        {completingIds.has(sr.id) ? "Sending\u2026" : "Complete & Notify"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Scheduled Jobs ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Scheduled Jobs</h2>
        {jobs.length === 0 ? (
          <p style={{ color: "#888" }}>No scheduled jobs for this tenant</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Schedule</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Next Run</th>
                <th style={thStyle}>Last Run</th>
                <th style={thStyle}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td style={tdStyle}>
                    <span
                      style={badgeStyle(j.jobType === "deep_research" ? "#7c3aed" : "#2563eb")}
                    >
                      {j.jobType}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: "#666" }}>
                    {j.scheduleType}
                    {j.recurrenceRule ? ` (${j.recurrenceRule})` : ""}
                  </td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(statusColor(j.status))}>{j.status}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(j.scheduledAt)}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{j.lastRunAt ? timeAgo(j.lastRunAt) : "\u2014"}</td>
                  <td
                    style={{
                      ...tdStyle,
                      color: "#666",
                      fontSize: 12,
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {payloadPreview(j)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Todos ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Todos</h2>
        {sortedTodos.length === 0 ? (
          <p style={{ color: "#888" }}>No todos for this tenant</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Priority</th>
                <th style={thStyle}>Due Date</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {sortedTodos.map((t) => (
                <tr key={t.id} style={{ opacity: t.status === "done" ? 0.55 : 1 }}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{t.title}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(priorityColor(t.priority))}>{t.priority}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#666" }}>{t.dueDate || "\u2014"}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(statusColor(t.status))}>{t.status}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Activity Log ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>
          Activity Log{" "}
          <span style={{ fontSize: 13, fontWeight: 400, color: "#888" }}>(last 100)</span>
        </h2>
        {audit.length === 0 ? (
          <p style={{ color: "#888" }}>No activity logged yet</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Skill</th>
                <th style={thStyle}>Channel</th>
                <th style={thStyle}>Credits</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td style={tdStyle}>{a.action}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{a.skillName || "\u2014"}</td>
                  <td style={{ ...tdStyle, color: "#666" }}>{a.channel || "\u2014"}</td>
                  <td style={tdStyle}>{a.creditCost > 0 ? `-${a.creditCost}` : "\u2014"}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- Credit Transactions ---- */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>
          Credit Transactions{" "}
          <span style={{ fontSize: 13, fontWeight: 400, color: "#888" }}>(last 50)</span>
        </h2>
        {creditTransactions.length === 0 ? (
          <p style={{ color: "#888" }}>No credit transactions recorded</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {creditTransactions.map((ct) => (
                <tr key={ct.id}>
                  <td style={tdStyle}>
                    <span
                      style={badgeStyle(
                        ct.amount > 0 ? "#10b981" : ct.amount < 0 ? "#ef4444" : "#6b7280",
                      )}
                    >
                      {ct.type}
                    </span>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: 600,
                      color: ct.amount > 0 ? "#10b981" : ct.amount < 0 ? "#ef4444" : "#666",
                    }}
                  >
                    {ct.amount > 0 ? `+${ct.amount}` : ct.amount}
                  </td>
                  <td style={{ ...tdStyle, color: "#666" }}>{ct.description}</td>
                  <td style={{ ...tdStyle, color: "#888" }}>{timeAgo(ct.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small sub-component for the overview grid
// ---------------------------------------------------------------------------

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: "#333" }}>{value}</div>
    </div>
  );
}
