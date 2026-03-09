"use client";

import React, { useEffect, useState } from "react";

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

interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  linkedinUrl: string | null;
  scrapedData: Record<string, unknown> | null;
  status: string;
  scrapedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface DashboardData {
  tenants: Tenant[];
  connections: Connection[];
  skillRequests: SkillRequest[];
  recentAudit: AuditEntry[];
  profiles: Profile[];
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
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());
  const [profileFilter, setProfileFilter] = useState<string>("all");
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [rescrapingIds, setRescrapingIds] = useState<Set<string>>(new Set());

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

  async function handleCompleteSkillRequest(requestId: string) {
    setCompletingIds((prev) => new Set(prev).add(requestId));
    try {
      const res = await fetch(`/api/admin/skill-requests/${requestId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      // Update local state to reflect completion
      setData((prev) => prev ? {
        ...prev,
        skillRequests: prev.skillRequests.map((sr) =>
          sr.id === requestId ? { ...sr, status: "completed" } : sr
        ),
      } : prev);
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

  async function handleVerifyProfile(profileId: string) {
    setVerifyingIds((prev) => new Set(prev).add(profileId));
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verify`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      setData((prev) => prev ? {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === profileId ? { ...p, status: "verified", verifiedBy: "admin", verifiedAt: new Date().toISOString() } : p
        ),
      } : prev);
    } catch {
      alert("Failed to verify profile");
    } finally {
      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
    }
  }

  async function handleRescrapeProfile(profileId: string) {
    setRescrapingIds((prev) => new Set(prev).add(profileId));
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/rescrape`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json();
      setData((prev) => prev ? {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === profileId ? {
            ...p,
            scrapedData: result.profile,
            scrapedAt: new Date().toISOString(),
            status: "corrected",
            verifiedBy: "admin",
            verifiedAt: new Date().toISOString(),
          } : p
        ),
      } : prev);
      setEditingProfile(null);
    } catch {
      alert("Failed to rescrape profile");
    } finally {
      setRescrapingIds((prev) => {
        const next = new Set(prev);
        next.delete(profileId);
        return next;
      });
    }
  }

  async function handleSaveAndRescrape(profileId: string) {
    // First update the URL
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profileId, linkedinUrl: editUrl }),
      });
      if (!res.ok) throw new Error("Failed to update URL");
      // Update local state with new URL
      setData((prev) => prev ? {
        ...prev,
        profiles: prev.profiles.map((p) =>
          p.id === profileId ? { ...p, linkedinUrl: editUrl } : p
        ),
      } : prev);
    } catch {
      alert("Failed to update LinkedIn URL");
      return;
    }
    // Then rescrape
    await handleRescrapeProfile(profileId);
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
                  <td style={{ padding: "8px 0", fontWeight: 500 }}>
                    <a href={`/admin/dashboard/tenant/${t.id}`} style={{ color: "#2563eb", textDecoration: "none", cursor: "pointer" }}>
                      {t.name}
                    </a>
                  </td>
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
                <th>Actions</th>
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
                  <td>
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

      {/* Profile Directory */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Profile Directory</h2>
          <div style={{ display: "flex", gap: 8 }}>
            {["all", "pending", "failed", "verified", "corrected"].map((f) => (
              <button
                key={f}
                onClick={() => setProfileFilter(f)}
                style={{
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  backgroundColor: profileFilter === f ? "#2563eb" : "white",
                  color: profileFilter === f ? "white" : "#374151",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {(() => {
          const filtered = profileFilter === "all"
            ? data.profiles
            : data.profiles.filter((p) => p.status === profileFilter);

          if (filtered.length === 0) {
            return <p style={{ color: "#888" }}>No profiles {profileFilter !== "all" ? `with status "${profileFilter}"` : "yet"}</p>;
          }

          return (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "8px 0" }}>Email</th>
                  <th>Name / Title</th>
                  <th>LinkedIn</th>
                  <th>Status</th>
                  <th>Scraped</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const person = p.scrapedData?.person as Record<string, unknown> | undefined;
                  const headline = (p.scrapedData?.headline as string) || (person?.headline as string) || "";
                  const isExpanded = expandedProfile === p.id;
                  const isEditing = editingProfile === p.id;

                  return (
                    <React.Fragment key={p.id}>
                      <tr
                        style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                        onClick={() => setExpandedProfile(isExpanded ? null : p.id)}
                      >
                        <td style={{ padding: "8px 0", fontWeight: 500 }}>{p.email}</td>
                        <td>
                          <div>{p.displayName || "\u2014"}</div>
                          {headline && <div style={{ fontSize: 12, color: "#666" }}>{headline}</div>}
                        </td>
                        <td style={{ fontSize: 12, color: "#2563eb", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.linkedinUrl ? (
                            <a href={p.linkedinUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              {p.linkedinUrl.replace("https://www.linkedin.com", "").replace("https://linkedin.com", "")}
                            </a>
                          ) : "\u2014"}
                        </td>
                        <td>
                          <span
                            style={badgeStyle(
                              p.status === "verified" ? "#10b981" :
                              p.status === "corrected" ? "#2563eb" :
                              p.status === "failed" ? "#ef4444" : "#6b7280"
                            )}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td style={{ color: "#888" }}>{p.scrapedAt ? timeAgo(p.scrapedAt) : "\u2014"}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {p.status !== "verified" && (
                              <button
                                onClick={() => handleVerifyProfile(p.id)}
                                disabled={verifyingIds.has(p.id)}
                                style={{
                                  padding: "2px 8px", borderRadius: 4, border: "none",
                                  backgroundColor: verifyingIds.has(p.id) ? "#9ca3af" : "#10b981",
                                  color: "white", fontSize: 11, cursor: "pointer",
                                }}
                              >
                                {verifyingIds.has(p.id) ? "..." : "Verify"}
                              </button>
                            )}
                            <button
                              onClick={() => { setEditingProfile(isEditing ? null : p.id); setEditUrl(p.linkedinUrl || ""); }}
                              style={{
                                padding: "2px 8px", borderRadius: 4, border: "1px solid #d1d5db",
                                backgroundColor: "white", color: "#374151", fontSize: 11, cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleRescrapeProfile(p.id)}
                              disabled={rescrapingIds.has(p.id) || !p.linkedinUrl}
                              style={{
                                padding: "2px 8px", borderRadius: 4, border: "1px solid #d1d5db",
                                backgroundColor: "white", color: rescrapingIds.has(p.id) ? "#9ca3af" : "#374151",
                                fontSize: 11, cursor: rescrapingIds.has(p.id) || !p.linkedinUrl ? "default" : "pointer",
                              }}
                            >
                              {rescrapingIds.has(p.id) ? "Scraping..." : "Rescrape"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={6} style={{ padding: "12px 0", backgroundColor: "#f9fafb" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 8px" }}>
                              <span style={{ fontSize: 13, fontWeight: 500 }}>LinkedIn URL:</span>
                              <input
                                type="text"
                                value={editUrl}
                                onChange={(e) => setEditUrl(e.target.value)}
                                style={{
                                  flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #d1d5db",
                                  fontSize: 13, outline: "none",
                                }}
                                placeholder="https://linkedin.com/in/..."
                              />
                              <button
                                onClick={() => handleSaveAndRescrape(p.id)}
                                disabled={rescrapingIds.has(p.id) || !editUrl}
                                style={{
                                  padding: "6px 16px", borderRadius: 6, border: "none",
                                  backgroundColor: rescrapingIds.has(p.id) ? "#9ca3af" : "#2563eb",
                                  color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                {rescrapingIds.has(p.id) ? "Scraping..." : "Save & Rescrape"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {isExpanded && !isEditing && (
                        <tr>
                          <td colSpan={6} style={{ padding: "12px 8px", backgroundColor: "#f9fafb", fontSize: 13 }}>
                            <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflow: "auto" }}>
                              {JSON.stringify(p.scrapedData, null, 2)}
                            </pre>
                            {p.verifiedBy && (
                              <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
                                Verified by {p.verifiedBy} {p.verifiedAt ? timeAgo(p.verifiedAt) : ""}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
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
