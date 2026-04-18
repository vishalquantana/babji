# Admin Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the admin dashboard from a monolithic scrollable page into a sidebar-navigated layout with an at-a-glance dashboard home view featuring today's stats and sparkline trends.

**Architecture:** Break the existing 900-line `client.tsx` into separate route-based pages under `/admin/dashboard/`, sharing data via React Context from a layout component. Add a collapsible icon sidebar with badge counts for actionable items (pending skills, pending profiles). Add a new API endpoint for sparkline data.

**Tech Stack:** Next.js 15 App Router, React (inline styles), PostgreSQL via Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-21-admin-dashboard-redesign-design.md`

---

## File Structure

```
apps/oauth-portal/src/
├── app/admin/dashboard/
│   ├── layout.tsx                    ← NEW: Server layout, fetches data, wraps children
│   ├── layout-client.tsx             ← NEW: Client layout with sidebar + DashboardContext
│   ├── page.tsx                      ← REWRITE: Server component for dashboard home
│   ├── client.tsx                    ← REWRITE: Dashboard home (stats + sparklines)
│   ├── skills/
│   │   └── page.tsx                  ← NEW: Skill requests page (server + client)
│   ├── profiles/
│   │   └── page.tsx                  ← NEW: Profile directory page (server + client)
│   ├── tenants/
│   │   └── page.tsx                  ← NEW: Tenants list page (server + client)
│   ├── connections/
│   │   └── page.tsx                  ← NEW: Service connections page (server + client)
│   ├── activity/
│   │   └── page.tsx                  ← NEW: Activity + usage summary page (server + client)
│   ├── settings/
│   │   └── page.tsx                  ← NEW: Settings page (server + client)
│   └── tenant/[tenantId]/           ← EXISTING: No changes needed, inherits layout
│       ├── page.tsx
│       └── client.tsx
├── components/admin/
│   ├── DashboardContext.tsx           ← NEW: React context for shared data + badge counts
│   ├── Sidebar.tsx                   ← NEW: Collapsible icon sidebar
│   └── StatCard.tsx                  ← NEW: Stat card with sparkline SVG
└── app/api/admin/
    └── stats/daily/route.ts          ← NEW: Sparkline data endpoint
```

**Note:** Section pages use a single file with `"use client"` at the top (matching the existing `tenant/[tenantId]/page.tsx` pattern). The auth check redirects are handled by the shared `layout.tsx`.

---

### Task 1: DashboardContext — Shared Data Provider

**Files:**
- Create: `apps/oauth-portal/src/components/admin/DashboardContext.tsx`

- [ ] **Step 1: Create the context file**

```typescript
// apps/oauth-portal/src/components/admin/DashboardContext.tsx
"use client";

import { createContext, useContext, ReactNode } from "react";

export interface DashboardData {
  tenants: any[];
  connections: any[];
  skillRequests: any[];
  audit: any[];
  profiles: any[];
  settings: { defaultDailyFreeCredits: number };
  usageSummary: any;
}

interface DashboardContextValue {
  data: DashboardData;
  pendingSkillsCount: number;
  pendingProfilesCount: number;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  data,
  children,
}: {
  data: DashboardData;
  children: ReactNode;
}) {
  const pendingSkillsCount = data.skillRequests.filter(
    (s: any) => s.status === "pending"
  ).length;
  const pendingProfilesCount = data.profiles.filter(
    (p: any) => p.status === "pending"
  ).length;

  return (
    <DashboardContext.Provider
      value={{ data, pendingSkillsCount, pendingProfilesCount }}
    >
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/oauth-portal && npx tsc --noEmit src/components/admin/DashboardContext.tsx 2>&1 || echo "Check for errors"`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/components/admin/DashboardContext.tsx
git commit -m "feat(admin): add DashboardContext for shared data"
```

---

### Task 2: Sidebar Component

**Files:**
- Create: `apps/oauth-portal/src/components/admin/Sidebar.tsx`

- [ ] **Step 1: Create the Sidebar component**

The sidebar is 60px wide (collapsed), expands to 200px on hover. Dark background, icon + label for each nav item. Badge counts on Skills and Profiles. Uses `usePathname()` to highlight active route.

```typescript
// apps/oauth-portal/src/components/admin/Sidebar.tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useDashboard } from "./DashboardContext";

interface NavItem {
  label: string;
  icon: string;
  path: string;
  badge?: number;
  badgeColor?: string;
}

export function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { pendingSkillsCount, pendingProfilesCount } = useDashboard();

  const navItems: NavItem[] = [
    { label: "Home", icon: "⊞", path: "/admin/dashboard" },
    {
      label: "Skills",
      icon: "⚡",
      path: "/admin/dashboard/skills",
      badge: pendingSkillsCount || undefined,
      badgeColor: "#ef4444",
    },
    {
      label: "Profiles",
      icon: "👤",
      path: "/admin/dashboard/profiles",
      badge: pendingProfilesCount || undefined,
      badgeColor: "#f59e0b",
    },
    { label: "Tenants", icon: "👥", path: "/admin/dashboard/tenants" },
    { label: "Connections", icon: "🔗", path: "/admin/dashboard/connections" },
    { label: "Activity", icon: "📊", path: "/admin/dashboard/activity" },
  ];

  const settingsItem: NavItem = {
    label: "Settings",
    icon: "⚙️",
    path: "/admin/dashboard/settings",
  };

  const isActive = (path: string) => {
    if (path === "/admin/dashboard") return pathname === "/admin/dashboard";
    return pathname.startsWith(path);
  };

  // Also highlight Tenants when viewing tenant detail
  const isItemActive = (item: NavItem) => {
    if (item.path === "/admin/dashboard/tenants") {
      return pathname.startsWith("/admin/dashboard/tenant");
    }
    return isActive(item.path);
  };

  const sidebarStyle: React.CSSProperties = {
    width: expanded ? 200 : 60,
    minWidth: expanded ? 200 : 60,
    background: "#0f172a",
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    alignItems: expanded ? "stretch" : "center",
    padding: "12px 0",
    transition: "width 200ms ease, min-width 200ms ease",
    overflow: "hidden",
    flexShrink: 0,
    height: "100vh",
    position: "sticky",
    top: 0,
  };

  const logoStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 16,
    flexShrink: 0,
    cursor: "pointer",
    alignSelf: expanded ? "flex-start" : "center",
    marginLeft: expanded ? 12 : 0,
  };

  const navItemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: expanded ? "10px 14px" : "10px 0",
    justifyContent: expanded ? "flex-start" : "center",
    background: active ? "#1e293b" : "transparent",
    color: active ? "white" : "#94a3b8",
    borderRadius: 0,
    borderLeft: active ? "3px solid #3b82f6" : "3px solid transparent",
    cursor: "pointer",
    position: "relative",
    fontSize: 13,
    whiteSpace: "nowrap",
    transition: "background 150ms ease",
  });

  const badgeStyle = (color: string): React.CSSProperties => ({
    background: color,
    color: "white",
    borderRadius: 8,
    padding: "1px 6px",
    fontSize: 10,
    fontWeight: 600,
    lineHeight: "16px",
    marginLeft: "auto",
  });

  const iconBadgeStyle = (color: string): React.CSSProperties => ({
    position: "absolute",
    top: 2,
    right: expanded ? "auto" : 6,
    background: color,
    color: "white",
    borderRadius: 8,
    padding: "0 4px",
    fontSize: 9,
    fontWeight: 600,
    lineHeight: "14px",
  });

  const renderNavItem = (item: NavItem) => {
    const active = isItemActive(item);
    return (
      <div
        key={item.path}
        style={navItemStyle(active)}
        onClick={() => router.push(item.path)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && router.push(item.path)}
      >
        <span style={{ fontSize: 18, width: 24, textAlign: "center", flexShrink: 0 }}>
          {item.icon}
        </span>
        {expanded && <span>{item.label}</span>}
        {item.badge !== undefined && expanded && (
          <span style={badgeStyle(item.badgeColor || "#ef4444")}>{item.badge}</span>
        )}
        {item.badge !== undefined && !expanded && (
          <span style={iconBadgeStyle(item.badgeColor || "#ef4444")}>{item.badge}</span>
        )}
      </div>
    );
  };

  return (
    <nav
      style={sidebarStyle}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      role="navigation"
      aria-label="Admin sidebar"
    >
      <div style={logoStyle} onClick={() => router.push("/admin/dashboard")}>
        B
      </div>
      {navItems.map(renderNavItem)}
      <div style={{ flex: 1 }} />
      <div style={{ borderTop: "1px solid #1e293b", paddingTop: 4 }}>
        {renderNavItem(settingsItem)}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd apps/oauth-portal && npx tsc --noEmit src/components/admin/Sidebar.tsx 2>&1 || echo "Check for errors"`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/components/admin/Sidebar.tsx
git commit -m "feat(admin): add collapsible icon sidebar with badge counts"
```

---

### Task 3: Layout — Server + Client Wrapper

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/layout-client.tsx`
- Modify: `apps/oauth-portal/src/app/admin/dashboard/page.tsx` (will be modified in Task 6)
- Create/Rewrite: `apps/oauth-portal/src/app/admin/dashboard/layout.tsx`

- [ ] **Step 1: Create the client layout wrapper**

```typescript
// apps/oauth-portal/src/app/admin/dashboard/layout-client.tsx
"use client";

import { ReactNode } from "react";
import { DashboardProvider, DashboardData } from "../../../components/admin/DashboardContext";
import { Sidebar } from "../../../components/admin/Sidebar";

export function DashboardLayout({
  data,
  children,
}: {
  data: DashboardData;
  children: ReactNode;
}) {
  return (
    <DashboardProvider data={data}>
      <div style={{ display: "flex", minHeight: "100vh", background: "#f8fafc" }}>
        <Sidebar />
        <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          {children}
        </main>
      </div>
    </DashboardProvider>
  );
}
```

- [ ] **Step 2: Create the server layout**

```typescript
// apps/oauth-portal/src/app/admin/dashboard/layout.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isAdminAuthenticated } from "../../../lib/admin-auth";
import { DashboardLayout } from "./layout-client";

async function fetchDashboardData() {
  // Build the internal URL for the data endpoint
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
  const cookieStore = await cookies();
  const authed = await isAdminAuthenticated(cookieStore);
  if (!authed) redirect("/admin");

  const data = await fetchDashboardData();

  return <DashboardLayout data={data}>{children}</DashboardLayout>;
}
```

**Note:** The auth check moves to `layout.tsx` so individual pages don't need to repeat it. The existing `page.tsx` server component auth check should be removed when we rewrite it in Task 6.

- [ ] **Step 3: Verify both files compile**

Run: `cd apps/oauth-portal && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to layout files

- [ ] **Step 4: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/layout.tsx apps/oauth-portal/src/app/admin/dashboard/layout-client.tsx
git commit -m "feat(admin): add dashboard layout with sidebar and data context"
```

---

### Task 4: StatCard Component with Sparkline

**Files:**
- Create: `apps/oauth-portal/src/components/admin/StatCard.tsx`

- [ ] **Step 1: Create the StatCard component**

```typescript
// apps/oauth-portal/src/components/admin/StatCard.tsx
"use client";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;          // e.g. "+12% vs yesterday"
  trendUp?: boolean;       // green if true, red if false
  sparklineData?: number[]; // 7 data points for the week
  color: string;           // primary color
  borderColor?: string;    // optional highlight border
  icon?: React.ReactNode;  // optional icon instead of sparkline
  onClick?: () => void;
}

export function StatCard({
  label,
  value,
  trend,
  trendUp,
  sparklineData,
  color,
  borderColor,
  icon,
  onClick,
}: StatCardProps) {
  const cardStyle: React.CSSProperties = {
    background: "white",
    borderRadius: 12,
    padding: 16,
    border: `1px solid ${borderColor || "#e2e8f0"}`,
    cursor: onClick ? "pointer" : "default",
  };

  // Generate sparkline SVG path from data points
  const renderSparkline = (data: number[]) => {
    if (!data.length) return null;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const w = 64;
    const h = 32;
    const points = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / range) * h * 0.8 - h * 0.1;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 4 }}>
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div style={cardStyle} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 4,
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a" }}>{value}</div>
          {trend && (
            <div
              style={{
                fontSize: 10,
                color: trendUp === false ? "#ef4444" : trendUp ? "#22c55e" : color,
                marginTop: 2,
              }}
            >
              {trend}
            </div>
          )}
        </div>
        {sparklineData && renderSparkline(sparklineData)}
        {icon && (
          <div
            style={{
              width: 36,
              height: 36,
              background: `${color}15`,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/oauth-portal/src/components/admin/StatCard.tsx
git commit -m "feat(admin): add StatCard component with sparkline SVG"
```

---

### Task 5: Sparkline Data API Endpoint

**Files:**
- Create: `apps/oauth-portal/src/app/api/admin/stats/daily/route.ts`

- [ ] **Step 1: Create the stats endpoint**

This queries `audit_log` for daily aggregates (past 7 days) and hourly breakdown (today). Refer to the existing `/api/admin/data/route.ts` for the database connection pattern.

```typescript
// apps/oauth-portal/src/app/api/admin/stats/daily/route.ts
import { NextResponse } from "next/server";
import { db } from "@babji/db";
import { auditLog } from "@babji/db/schema";
import { sql, gte, and } from "drizzle-orm";

export async function GET() {
  try {
    // Daily aggregates for the past 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // NOTE: auditLog has no totalTokens column. Token data is in metadata JSONB:
    //   metadata->>'totalTokens', metadata->>'inputTokens', metadata->>'outputTokens'
    // Use raw SQL via db.execute() to access JSONB fields.

    const dailyStats = await db.execute(sql`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS messages,
        COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
      FROM audit_log
      WHERE created_at >= ${sevenDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `);

    // Today's hourly breakdown
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const hourlyStats = await db.execute(sql`
      SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*) AS messages,
        COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
      FROM audit_log
      WHERE created_at >= ${todayStart}
      GROUP BY DATE_TRUNC('hour', created_at)
      ORDER BY DATE_TRUNC('hour', created_at)
    `);

    // Today's totals
    const todayTotals = await db.execute(sql`
      SELECT
        COUNT(*) AS messages,
        COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
      FROM audit_log
      WHERE created_at >= ${todayStart}
    `);

    // Yesterday's totals for comparison
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const yesterdayTotals = await db.execute(sql`
      SELECT
        COUNT(*) AS messages,
        COALESCE(SUM((metadata->>'totalTokens')::int), 0) AS tokens
      FROM audit_log
      WHERE created_at >= ${yesterdayStart} AND created_at < ${todayStart}
    `);

    return NextResponse.json({
      daily: dailyStats.rows || dailyStats,
      hourly: hourlyStats.rows || hourlyStats,
      today: (todayTotals.rows || todayTotals)[0] || { messages: 0, tokens: 0 },
      yesterday: (yesterdayTotals.rows || yesterdayTotals)[0] || { messages: 0, tokens: 0 },
    });
  } catch (error) {
    console.error("Failed to fetch daily stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
```

**Important:** The `audit_log` table has no `totalTokens` column — token data lives in the `metadata` JSONB field. The queries above use `metadata->>'totalTokens'` to extract it, matching the pattern in `/api/admin/data/route.ts`.

- [ ] **Step 2: Verify the endpoint builds**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/api/admin/stats/daily/route.ts
git commit -m "feat(admin): add sparkline data API endpoint"
```

---

### Task 6: Dashboard Home Page (Rewrite)

**Depends on:** Task 5 (sparkline API endpoint must exist for the stats fetch)

**Files:**
- Rewrite: `apps/oauth-portal/src/app/admin/dashboard/page.tsx`
- Rewrite: `apps/oauth-portal/src/app/admin/dashboard/client.tsx`

- [ ] **Step 1: Rewrite the server page component**

The auth check is now handled by `layout.tsx`, so this page just renders the client component.

```typescript
// apps/oauth-portal/src/app/admin/dashboard/page.tsx
import { DashboardHomeClient } from "./client";

export default function DashboardHomePage() {
  return <DashboardHomeClient />;
}
```

- [ ] **Step 2: Rewrite client.tsx as the dashboard home**

This replaces the monolithic 900-line component with just the home view: 4 stat cards + usage table + recent activity feed.

```typescript
// apps/oauth-portal/src/app/admin/dashboard/client.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../../../components/admin/DashboardContext";
import { StatCard } from "../../../components/admin/StatCard";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface DailyStats {
  daily: { day: string; messages: number; tokens: number }[];
  today: { messages: number; tokens: number };
  yesterday: { messages: number; tokens: number };
}

export function DashboardHomeClient() {
  const { data, pendingSkillsCount, pendingProfilesCount } = useDashboard();
  const router = useRouter();
  const [stats, setStats] = useState<DailyStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats/daily")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  const messageTrend = stats
    ? (() => {
        const today = stats.today.messages;
        const yesterday = stats.yesterday.messages;
        if (yesterday === 0) return { text: "No data yesterday", up: undefined };
        const pct = Math.round(((today - yesterday) / yesterday) * 100);
        return {
          text: `${pct >= 0 ? "+" : ""}${pct}% vs yesterday`,
          up: pct >= 0,
        };
      })()
    : null;

  const tokenTrend = stats
    ? (() => {
        const today = stats.today.tokens;
        const yesterday = stats.yesterday.tokens;
        if (yesterday === 0) return { text: "No data yesterday", up: undefined };
        const pct = Math.round(((today - yesterday) / yesterday) * 100);
        return {
          text: `${pct >= 0 ? "+" : ""}${pct}% vs yesterday`,
          up: pct >= 0,
        };
      })()
    : null;

  const messageSparkline = stats?.daily.map((d) => d.messages) || [];
  const tokenSparkline = stats?.daily.map((d) => d.tokens) || [];

  const formatNumber = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  // Usage by tenant — usageSummary is a flat array with snake_case keys:
  // { tenant_name, tenant_id, messages, total_tokens, input_tokens, output_tokens, tool_calls, external_api_calls, bg_jobs, total_credits }
  const usageSummary = data.usageSummary as any[];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0" }}>
            Today&apos;s overview with weekly trends
          </p>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", background: "white", padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard
          label="Messages"
          value={stats ? stats.today.messages : "—"}
          trend={messageTrend?.text}
          trendUp={messageTrend?.up}
          sparklineData={messageSparkline}
          color="#3b82f6"
        />
        <StatCard
          label="Tokens"
          value={stats ? formatNumber(stats.today.tokens) : "—"}
          trend={tokenTrend?.text}
          trendUp={tokenTrend?.up}
          sparklineData={tokenSparkline}
          color="#8b5cf6"
        />
        <StatCard
          label="Pending Skills"
          value={pendingSkillsCount}
          trend="Needs attention"
          color="#ef4444"
          borderColor="#fecaca"
          icon={<span style={{ fontSize: 18 }}>⚡</span>}
          onClick={() => router.push("/admin/dashboard/skills")}
        />
        <StatCard
          label="Pending Profiles"
          value={pendingProfilesCount}
          trend="Awaiting verification"
          color="#f59e0b"
          borderColor="#fde68a"
          icon={<span style={{ fontSize: 18 }}>👤</span>}
          onClick={() => router.push("/admin/dashboard/profiles")}
        />
      </div>

      {/* Two Column: Usage + Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Usage by Tenant */}
        <div style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>Usage by Tenant</span>
            <span
              style={{ fontSize: 11, color: "#3b82f6", cursor: "pointer" }}
              onClick={() => router.push("/admin/dashboard/tenants")}
            >
              View all →
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", display: "flex", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
            <span style={{ flex: 2 }}>Tenant</span>
            <span style={{ flex: 1, textAlign: "right" }}>Messages</span>
            <span style={{ flex: 1, textAlign: "right" }}>Tokens</span>
            <span style={{ flex: 1, textAlign: "right" }}>Credits</span>
          </div>
          {usageSummary?.slice(0, 5).map((t: any) => (
            <div key={t.tenant_id} style={{ fontSize: 12, display: "flex", padding: "8px 0", borderBottom: "1px solid #f8fafc", alignItems: "center" }}>
              <span style={{ flex: 2 }}>{t.tenant_name || t.tenant_id}</span>
              <span style={{ flex: 1, textAlign: "right" }}>{t.messages}</span>
              <span style={{ flex: 1, textAlign: "right" }}>{formatNumber(Number(t.total_tokens) || 0)}</span>
              <span style={{ flex: 1, textAlign: "right" }}>{t.total_credits || 0}</span>
            </div>
          ))}
          {(!usageSummary || usageSummary.length === 0) && (
            <div style={{ fontSize: 12, color: "#94a3b8", padding: "12px 0", textAlign: "center" }}>No usage data</div>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{ background: "white", borderRadius: 12, padding: 16, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>Recent Activity</span>
            <span
              style={{ fontSize: 11, color: "#3b82f6", cursor: "pointer" }}
              onClick={() => router.push("/admin/dashboard/activity")}
            >
              View all →
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.audit.slice(0, 5).map((entry: any) => (
              <div key={entry.id} style={{ display: "flex", alignItems: "start", gap: 10 }}>
                <div style={{ width: 8, height: 8, background: "#3b82f6", borderRadius: "50%", marginTop: 4, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 12, color: "#0f172a" }}>
                    {entry.tenantName || "Unknown"} — {entry.action}{entry.skill ? ` (${entry.skill})` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {timeAgo(entry.createdAt)}{entry.creditCost ? ` · ${entry.creditCost} credit${entry.creditCost > 1 ? "s" : ""}` : ""}
                  </div>
                </div>
              </div>
            ))}
            {data.audit.length === 0 && (
              <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center" }}>No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test locally**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`
Then: `cd apps/oauth-portal && npx next dev -p 3100` and visit `/admin/dashboard`

- [ ] **Step 4: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/page.tsx apps/oauth-portal/src/app/admin/dashboard/client.tsx
git commit -m "feat(admin): rewrite dashboard home with stat cards and sparklines"
```

---

### Task 7: Skills Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/skills/page.tsx`

- [ ] **Step 1: Create the skills page**

Extract the Skill Requests section from the old `client.tsx`. Use `useDashboard()` for data. Call `router.refresh()` after completing a request to update sidebar badges.

The page needs:
- State: `completingIds` (Set of IDs being completed)
- Handler: `handleCompleteSkillRequest(id)` — POST to `/api/admin/skill-requests/{id}/complete`, then `router.refresh()`
- Table columns: Status, Skill, Tenant, Context, Action
- Copy the existing table markup and styling patterns from the old `client.tsx` Skill Requests section

```typescript
// apps/oauth-portal/src/app/admin/dashboard/skills/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../../../../components/admin/DashboardContext";

// Copy timeAgo, statusColor helpers from old client.tsx

export default function SkillsPage() {
  const { data } = useDashboard();
  const router = useRouter();
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  const handleComplete = async (id: string) => {
    setCompletingIds((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/admin/skill-requests/${id}/complete`, { method: "POST" });
      router.refresh();
    } catch (err) {
      console.error("Failed to complete skill request:", err);
    } finally {
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Render skill requests table — replicate existing UI from old client.tsx
  // Include: status badge, skill name, tenant name, context/payload preview, Complete & Notify button
  // ... (full implementation extracted from old client.tsx skill requests section)

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>Skill Requests</h1>
      <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 20px" }}>
        {data.skillRequests.filter((s: any) => s.status === "pending").length} pending requests
      </p>
      {/* Table with same structure as old dashboard */}
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Status</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Skill</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Tenant</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Context</th>
              <th style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.skillRequests.map((req: any) => (
              <tr key={req.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 500,
                    background: req.status === "pending" ? "#fef3c7" : "#d1fae5",
                    color: req.status === "pending" ? "#92400e" : "#065f46",
                  }}>
                    {req.status}
                  </span>
                </td>
                <td style={{ padding: "10px 14px" }}>{req.skillName}</td>
                <td style={{ padding: "10px 14px" }}>{req.tenantName || req.tenantId}</td>
                <td style={{ padding: "10px 14px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b" }}>
                  {req.context || req.payload ? JSON.stringify(req.context || req.payload).slice(0, 80) : "—"}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {req.status === "pending" && (
                    <button
                      onClick={() => handleComplete(req.id)}
                      disabled={completingIds.has(req.id)}
                      style={{
                        background: completingIds.has(req.id) ? "#94a3b8" : "#2563eb",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontSize: 12,
                        cursor: completingIds.has(req.id) ? "not-allowed" : "pointer",
                      }}
                    >
                      {completingIds.has(req.id) ? "Completing..." : "Complete & Notify"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.skillRequests.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No skill requests</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and test navigation**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`
Test: Navigate to `/admin/dashboard/skills` via sidebar

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/skills/page.tsx
git commit -m "feat(admin): extract skill requests into dedicated page"
```

---

### Task 8: Profiles Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/profiles/page.tsx`

- [ ] **Step 1: Create the profiles page**

Extract the Profile Directory section from old `client.tsx`. Needs:
- State: `profileFilter`, `expandedProfile`, `editingProfile`, `editUrl`, `verifyingIds`, `rescrapingIds`
- Handlers: `handleVerifyProfile`, `handleRescrapeProfile`, `handleSaveAndRescrape`
- URL param support: read `?status=pending` from `useSearchParams()` to initialize filter
- Call `router.refresh()` after verify/rescrape to update sidebar badge

Replicate the full profile directory UI: status filter buttons, expandable rows with scraped data, edit URL inline, verify/rescrape buttons. Copy exact styling from the old component.

- [ ] **Step 2: Build and test**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`
Test: Navigate to `/admin/dashboard/profiles` and `/admin/dashboard/profiles?status=pending`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/profiles/page.tsx
git commit -m "feat(admin): extract profile directory into dedicated page"
```

---

### Task 9: Tenants Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/tenants/page.tsx`

- [ ] **Step 1: Create the tenants page**

Extract the Tenants table from old `client.tsx`. Shows: Name (clickable link to `/admin/dashboard/tenant/[id]`), Plan badge, Phone, Telegram ID, Last Active.

Copy the existing table markup, `planColor()` helper, and `timeAgo()` helper.

- [ ] **Step 2: Build and test**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/tenants/page.tsx
git commit -m "feat(admin): extract tenants list into dedicated page"
```

---

### Task 10: Connections Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/connections/page.tsx`

- [ ] **Step 1: Create the connections page**

Extract Service Connections table. Shows: Provider, Tenant, Scopes, Expires, Connected timestamp.

- [ ] **Step 2: Build and test**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/connections/page.tsx
git commit -m "feat(admin): extract service connections into dedicated page"
```

---

### Task 11: Activity Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/activity/page.tsx`

- [ ] **Step 1: Create the activity page**

This page combines two sections from the old dashboard:
1. **Usage Summary (Last 7 Days)** — Stat boxes (total messages, tokens, tool calls, external API calls) + per-tenant breakdown table with full detail (messages, input tokens, output tokens, total tokens, tool calls, external API calls, credit cost)
2. **Recent Audit Log** — Last 50 entries table

Preserve the full 7-day usage breakdown that was on the old dashboard.

- [ ] **Step 2: Build and test**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/activity/page.tsx
git commit -m "feat(admin): extract activity log and usage summary into dedicated page"
```

---

### Task 12: Settings Page (Extract from old dashboard)

**Files:**
- Create: `apps/oauth-portal/src/app/admin/dashboard/settings/page.tsx`

- [ ] **Step 1: Create the settings page**

Extract Settings section. Needs:
- State: `dailyFreeInput`, `savingSettings`, `settingsSaved`
- Handler: `handleSaveSettings` — PUT `/api/admin/settings`
- UI: Input field for default daily free credits + Save button with loading/saved feedback

- [ ] **Step 2: Build and test**

Run: `cd apps/oauth-portal && npx next build 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add apps/oauth-portal/src/app/admin/dashboard/settings/page.tsx
git commit -m "feat(admin): extract settings into dedicated page"
```

---

### Task 13: Integration Test and Deploy

- [ ] **Step 1: Full build**

Run: `cd apps/oauth-portal && npx next build`
Expected: All routes compile successfully, no TypeScript errors

- [ ] **Step 2: Local smoke test**

Run: `cd apps/oauth-portal && npx next dev -p 3100`
Test the following manually:
- `/admin` — login works
- `/admin/dashboard` — shows stat cards, usage table, activity feed
- Sidebar: hover expands, click navigates to each section
- `/admin/dashboard/skills` — shows skill requests, Complete button works
- `/admin/dashboard/profiles` — filter works, verify/rescrape works
- `/admin/dashboard/tenants` — click tenant navigates to detail page
- `/admin/dashboard/tenant/[id]` — sidebar shows, "Tenants" highlighted
- `/admin/dashboard/connections` — shows connections
- `/admin/dashboard/activity` — shows 7-day usage + audit log
- `/admin/dashboard/settings` — save settings works
- Badge counts update after completing a skill request

- [ ] **Step 3: Deploy to production**

```bash
# Build locally
pnpm --filter oauth-portal build

# Sync to server
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude data --exclude .worktrees \
  /Users/vishalkumar/Downloads/babji/ root@65.20.76.199:/opt/babji/

# Install deps + rebuild on server
ssh root@65.20.76.199 'cd /opt/babji && pnpm install --no-frozen-lockfile && pnpm --filter @babji/db build && pnpm --filter oauth-portal build'

# Restart
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-oauth'

# Verify
ssh root@65.20.76.199 'sleep 3 && curl -s -o /dev/null -w "%{http_code}" https://babji.quantana.top/admin'
```
Expected: 200

- [ ] **Step 4: Commit deployment marker**

```bash
git add -A
git commit -m "feat(admin): complete dashboard redesign with sidebar navigation

- Collapsible icon sidebar with badge counts
- Dashboard home with today's stats, sparkline trends, usage table, activity feed
- Separate pages for skills, profiles, tenants, connections, activity, settings
- Shared data via DashboardContext to avoid duplicate API calls
- New sparkline API endpoint for daily/hourly stats"
```

---

### Follow-up: Mobile Responsiveness (Not in this plan)

Per the spec, mobile requires: sidebar hidden with hamburger toggle, stat cards stacking 2x2, tap-to-expand sidebar. This is a separate follow-up task after the core redesign is validated on desktop.

