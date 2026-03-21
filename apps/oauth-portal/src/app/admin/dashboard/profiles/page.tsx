"use client";
import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboard } from "../../../../components/admin/DashboardContext";

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

export default function ProfilesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("status") || "all";

  const { data } = useDashboard();

  const [profileFilter, setProfileFilter] = useState<string>(initialFilter);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [rescrapingIds, setRescrapingIds] = useState<Set<string>>(new Set());

  async function handleVerifyProfile(profileId: string) {
    setVerifyingIds((prev) => new Set(prev).add(profileId));
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verify`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
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
      setEditingProfile(null);
      router.refresh();
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
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profileId, linkedinUrl: editUrl }),
      });
      if (!res.ok) throw new Error("Failed to update URL");
    } catch {
      alert("Failed to update LinkedIn URL");
      return;
    }
    await handleRescrapeProfile(profileId);
  }

  const filtered =
    profileFilter === "all"
      ? data.profiles
      : data.profiles.filter((p: any) => p.status === profileFilter);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700 }}>
          Profile Directory{" "}
          <span style={{ fontSize: 14, color: "#6b7280", fontWeight: 400 }}>
            ({filtered.length} result{filtered.length !== 1 ? "s" : ""})
          </span>
        </h1>
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

      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {filtered.length === 0 ? (
          <p style={{ color: "#888", padding: 24 }}>
            No profiles {profileFilter !== "all" ? `with status "${profileFilter}"` : "yet"}
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: "12px 16px" }}>Email</th>
                <th style={{ padding: "12px 8px" }}>Name / Title</th>
                <th style={{ padding: "12px 8px" }}>LinkedIn</th>
                <th style={{ padding: "12px 8px" }}>Status</th>
                <th style={{ padding: "12px 8px" }}>Scraped</th>
                <th style={{ padding: "12px 8px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => {
                const person = p.scrapedData?.person as Record<string, unknown> | undefined;
                const headline =
                  (p.scrapedData?.headline as string) || (person?.headline as string) || "";
                const isExpanded = expandedProfile === p.id;
                const isEditing = editingProfile === p.id;

                return (
                  <React.Fragment key={p.id}>
                    <tr
                      style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                      onClick={() => setExpandedProfile(isExpanded ? null : p.id)}
                    >
                      <td style={{ padding: "10px 16px", fontWeight: 500 }}>{p.email}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <div>{p.displayName || "\u2014"}</div>
                        {headline && (
                          <div style={{ fontSize: 12, color: "#666" }}>{headline}</div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          fontSize: 12,
                          color: "#2563eb",
                          maxWidth: 150,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.linkedinUrl ? (
                          <a
                            href={p.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.linkedinUrl
                              .replace("https://www.linkedin.com", "")
                              .replace("https://linkedin.com", "")}
                          </a>
                        ) : (
                          "\u2014"
                        )}
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <span
                          style={badgeStyle(
                            p.status === "verified"
                              ? "#10b981"
                              : p.status === "corrected"
                              ? "#2563eb"
                              : p.status === "failed"
                              ? "#ef4444"
                              : "#6b7280"
                          )}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", color: "#888" }}>
                        {p.scrapedAt ? timeAgo(p.scrapedAt) : "\u2014"}
                      </td>
                      <td style={{ padding: "10px 8px" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4 }}>
                          {p.status !== "verified" && (
                            <button
                              onClick={() => handleVerifyProfile(p.id)}
                              disabled={verifyingIds.has(p.id)}
                              style={{
                                padding: "2px 8px",
                                borderRadius: 4,
                                border: "none",
                                backgroundColor: verifyingIds.has(p.id) ? "#9ca3af" : "#10b981",
                                color: "white",
                                fontSize: 11,
                                cursor: "pointer",
                              }}
                            >
                              {verifyingIds.has(p.id) ? "..." : "Verify"}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setEditingProfile(isEditing ? null : p.id);
                              setEditUrl(p.linkedinUrl || "");
                            }}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: "1px solid #d1d5db",
                              backgroundColor: "white",
                              color: "#374151",
                              fontSize: 11,
                              cursor: "pointer",
                            }}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRescrapeProfile(p.id)}
                            disabled={rescrapingIds.has(p.id) || !p.linkedinUrl}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              border: "1px solid #d1d5db",
                              backgroundColor: "white",
                              color: rescrapingIds.has(p.id) ? "#9ca3af" : "#374151",
                              fontSize: 11,
                              cursor:
                                rescrapingIds.has(p.id) || !p.linkedinUrl ? "default" : "pointer",
                            }}
                          >
                            {rescrapingIds.has(p.id) ? "Scraping..." : "Rescrape"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{ padding: "12px 16px", backgroundColor: "#f9fafb" }}
                        >
                          <div
                            style={{ display: "flex", gap: 8, alignItems: "center" }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 500 }}>LinkedIn URL:</span>
                            <input
                              type="text"
                              value={editUrl}
                              onChange={(e) => setEditUrl(e.target.value)}
                              style={{
                                flex: 1,
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                fontSize: 13,
                                outline: "none",
                              }}
                              placeholder="https://linkedin.com/in/..."
                            />
                            <button
                              onClick={() => handleSaveAndRescrape(p.id)}
                              disabled={rescrapingIds.has(p.id) || !editUrl}
                              style={{
                                padding: "6px 16px",
                                borderRadius: 6,
                                border: "none",
                                backgroundColor: rescrapingIds.has(p.id) ? "#9ca3af" : "#2563eb",
                                color: "white",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
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
                        <td
                          colSpan={6}
                          style={{
                            padding: "12px 16px",
                            backgroundColor: "#f9fafb",
                            fontSize: 13,
                          }}
                        >
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: 300,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(p.scrapedData, null, 2)}
                          </pre>
                          {p.verifiedBy && (
                            <div style={{ marginTop: 8, color: "#888", fontSize: 12 }}>
                              Verified by {p.verifiedBy}{" "}
                              {p.verifiedAt ? timeAgo(p.verifiedAt) : ""}
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
        )}
      </div>
    </div>
  );
}
