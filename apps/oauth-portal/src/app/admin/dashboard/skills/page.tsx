"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

export default function SkillsPage() {
  const { data } = useDashboard();
  const router = useRouter();
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  // Build tenant name lookup
  const tenantNames: Record<string, string> = {};
  for (const t of data.tenants) {
    tenantNames[t.id] = t.name;
  }

  async function handleCompleteSkillRequest(requestId: string) {
    setCompletingIds((prev) => new Set(prev).add(requestId));
    try {
      const res = await fetch(`/api/admin/skill-requests/${requestId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
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

  const pendingCount = data.skillRequests.filter((sr: any) => sr.status === "pending").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#0f172a" }}>Skill Requests</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 4, marginBottom: 0 }}>
            Requests from users who asked to &quot;check with my teacher&quot;
          </p>
        </div>
        {pendingCount > 0 && (
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              backgroundColor: "#fef3c7",
              color: "#92400e",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>

      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {data.skillRequests.length === 0 ? (
          <p style={{ color: "#888", padding: 24, margin: 0 }}>
            No skill requests yet — users will ask to &quot;check with my teacher&quot; when they need new capabilities
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Tenant
                </th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Skill
                </th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Context
                </th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Status
                </th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Requested
                </th>
                <th style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 600, padding: "10px 14px", textAlign: "left" }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data.skillRequests.map((sr: any) => (
                <tr key={sr.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 14px" }}>
                    {tenantNames[sr.tenantId] || sr.tenantId.slice(0, 8)}
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 500 }}>{sr.skillName}</td>
                  <td
                    style={{
                      padding: "10px 14px",
                      color: "#666",
                      maxWidth: 300,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sr.context}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={badgeStyle(
                        sr.status === "completed"
                          ? "#10b981"
                          : sr.status === "rejected"
                          ? "#ef4444"
                          : sr.status === "in_progress"
                          ? "#f59e0b"
                          : "#6b7280"
                      )}
                    >
                      {sr.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#888" }}>{timeAgo(sr.createdAt)}</td>
                  <td style={{ padding: "10px 14px" }}>
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
                        {completingIds.has(sr.id) ? "Sending..." : "Complete & Notify"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
