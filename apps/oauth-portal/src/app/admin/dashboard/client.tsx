"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../../../components/admin/DashboardContext";
import { StatCard } from "../../../components/admin/StatCard";

interface SparklineDay {
  day: string;
  messages: number;
  tokens: number;
}

interface SparklineData {
  daily: SparklineDay[];
  today: { messages: number; tokens: number };
  yesterday: { messages: number; tokens: number };
}

interface UsageRow {
  tenant_name: string;
  tenant_id: string;
  messages: string;
  total_tokens: string;
  total_credits: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function calcTrend(
  today: number,
  yesterday: number
): { label: string; up: boolean } | undefined {
  if (!yesterday) return undefined;
  const pct = ((today - yesterday) / yesterday) * 100;
  const sign = pct >= 0 ? "+" : "";
  return { label: `${sign}${pct.toFixed(0)}% vs yesterday`, up: pct >= 0 };
}

export function DashboardHomeClient() {
  const router = useRouter();
  const { data, pendingSkillsCount, pendingProfilesCount } = useDashboard();
  const [sparkline, setSparkline] = useState<SparklineData | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats/daily")
      .then((r) => r.json())
      .then(setSparkline)
      .catch(() => {});
  }, []);

  const usageRows: UsageRow[] = Array.isArray(data.usageSummary)
    ? data.usageSummary
    : [];
  const top5Usage = usageRows.slice(0, 5);
  const recentAudit: any[] = Array.isArray(data.audit)
    ? data.audit.slice(0, 5)
    : [];

  const msgSparkline = sparkline ? sparkline.daily.map((d) => d.messages) : [];
  const tokSparkline = sparkline ? sparkline.daily.map((d) => d.tokens) : [];
  const msgTrend = sparkline
    ? calcTrend(sparkline.today.messages, sparkline.yesterday.messages)
    : undefined;
  const tokTrend = sparkline
    ? calcTrend(sparkline.today.tokens, sparkline.yesterday.tokens)
    : undefined;
  const totalMessages = sparkline ? sparkline.today.messages : 0;
  const totalTokens = sparkline ? sparkline.today.tokens : 0;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      {/* Stat Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Messages Today"
          value={formatNumber(totalMessages)}
          trend={msgTrend?.label}
          trendUp={msgTrend?.up}
          sparklineData={msgSparkline}
          color="#3b82f6"
        />
        <StatCard
          label="Tokens Today"
          value={formatNumber(totalTokens)}
          trend={tokTrend?.label}
          trendUp={tokTrend?.up}
          sparklineData={tokSparkline}
          color="#8b5cf6"
        />
        <StatCard
          label="Pending Skills"
          value={pendingSkillsCount}
          color="#ef4444"
          borderColor="#fecaca"
          icon={
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M13 10V3L4 14h7v7l9-11h-7z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          onClick={() => router.push("/admin/dashboard/skills")}
        />
        <StatCard
          label="Pending Profiles"
          value={pendingProfilesCount}
          color="#f59e0b"
          borderColor="#fde68a"
          icon={
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9" cy="7" r="4" />
              <path
                d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          onClick={() => router.push("/admin/dashboard/profiles")}
        />
      </div>

      {/* Two-column grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        {/* Usage by Tenant */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
              Usage by Tenant
            </span>
            <a
              href="/admin/dashboard/tenants"
              style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}
            >
              View all →
            </a>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#f8fafc" }}>
                {["Tenant", "Messages", "Tokens", "Credits"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 16px",
                      textAlign: h === "Tenant" ? "left" : "right",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top5Usage.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "#94a3b8",
                      fontSize: 13,
                    }}
                  >
                    No usage data
                  </td>
                </tr>
              ) : (
                top5Usage.map((row, i) => (
                  <tr
                    key={row.tenant_id}
                    style={{
                      borderTop: i === 0 ? "none" : "1px solid #f1f5f9",
                    }}
                  >
                    <td
                      style={{
                        padding: "10px 16px",
                        fontSize: 13,
                        color: "#0f172a",
                        fontWeight: 500,
                      }}
                    >
                      {row.tenant_name}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontSize: 13,
                        color: "#475569",
                        textAlign: "right",
                      }}
                    >
                      {formatNumber(Number(row.messages))}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontSize: 13,
                        color: "#475569",
                        textAlign: "right",
                      }}
                    >
                      {formatNumber(Number(row.total_tokens))}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontSize: 13,
                        color: "#475569",
                        textAlign: "right",
                      }}
                    >
                      {formatNumber(Number(row.total_credits))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Recent Activity */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>
              Recent Activity
            </span>
            <a
              href="/admin/dashboard/activity"
              style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}
            >
              View all →
            </a>
          </div>
          <div style={{ padding: "8px 0" }}>
            {recentAudit.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                No recent activity
              </div>
            ) : (
              recentAudit.map((entry: any, i: number) => (
                <div
                  key={entry.id ?? i}
                  style={{
                    padding: "10px 20px",
                    borderBottom:
                      i < recentAudit.length - 1
                        ? "1px solid #f1f5f9"
                        : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: "#3b82f6",
                      marginTop: 5,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#0f172a",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {entry.action ?? entry.event ?? "Activity"}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}
                    >
                      {entry.tenantName ?? entry.tenant_name ?? ""}
                      {entry.createdAt || entry.created_at
                        ? ` · ${timeAgo(entry.createdAt ?? entry.created_at)}`
                        : ""}
                    </div>
                  </div>
                  {entry.credits != null && (
                    <span
                      style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}
                    >
                      {entry.credits} cr
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
