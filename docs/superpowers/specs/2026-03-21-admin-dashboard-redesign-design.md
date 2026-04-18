# Admin Dashboard Redesign — Design Spec

## Summary

Redesign the Babji admin dashboard from a single scrollable page with 7 stacked sections into a sidebar-navigated layout with an at-a-glance dashboard home view.

## Problem

The current dashboard (`/admin/dashboard`) renders all sections (Settings, Tenants, Usage Summary, Service Connections, Skill Requests, Profile Directory, Recent Activity) in a single vertical scroll. This makes it hard to find specific sections and buries actionable items (pending skill requests, unverified profiles).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Icon sidebar (collapsible) | Compact by default, expands on hover to show labels. Maximizes content area while keeping nav accessible. |
| Dashboard home | Today's stats + sparkline weekly trends | Shows "what's happening now" with trend context. More actionable than a static 7-day summary. |
| Navigation model | Full page replacement | Each sidebar item loads its own page. Simpler than slide-overs, one thing at a time. |
| Badge counts | Sidebar icons show pending counts | Pending skill requests (red) and unverified profiles (amber) are always visible regardless of which page you're on. |

## Architecture

### Layout Structure

```
┌──────┬──────────────────────────────────────┐
│ Icon │  Main Content Area                   │
│ Side │                                      │
│ bar  │  (changes per route)                 │
│      │                                      │
│ 60px │  flex: 1                             │
│      │                                      │
│      │                                      │
└──────┴──────────────────────────────────────┘
```

**Sidebar (collapsed — default):** 60px wide, dark background (`#0f172a`). Shows icon + tiny label for each section. Badge counts on Skill Requests and Profiles icons.

**Sidebar (expanded — on hover):** ~200px wide, slides out over content (not pushing it). Shows full section names + badge counts. Transition: 200ms ease.

### Sidebar Navigation Items

| Order | Label | Icon | Badge | Route |
|-------|-------|------|-------|-------|
| 1 | Home | Grid/dashboard | — | `/admin/dashboard` |
| 2 | Skills | Alert circle | Pending count (red) | `/admin/dashboard/skills` |
| 3 | Profiles | User | Pending count (amber) | `/admin/dashboard/profiles` |
| 4 | Tenants | Users | — | `/admin/dashboard/tenants` |
| 5 | Connections | Link | — | `/admin/dashboard/connections` |
| 6 | Activity | Activity/pulse | — | `/admin/dashboard/activity` |
| — | Settings | Gear (bottom) | — | `/admin/dashboard/settings` |

### Dashboard Home View (`/admin/dashboard`)

**Top row — 4 stat cards (grid, 4 columns):**

| Card | Value | Trend | Color | Border |
|------|-------|-------|-------|--------|
| Messages | Today's count | Sparkline (7 days) + % vs yesterday | Blue (`#3b82f6`) | Default |
| Tokens | Today's total | Sparkline (7 days) + % vs yesterday | Purple (`#8b5cf6`) | Default |
| Pending Skills | Current count | — (icon instead) | Red (`#ef4444`) | Red border (`#fecaca`) |
| Pending Profiles | Current count | — (icon instead) | Amber (`#f59e0b`) | Amber border (`#fde68a`) |

Pending Skills and Pending Profiles cards are clickable — navigate to their respective pages.

**Bottom row — 2-column grid:**

| Left | Right |
|------|-------|
| **Usage by Tenant** table: Tenant name (with online indicator dot), Messages, Tokens, Credits for today. "View all →" links to Tenants page. | **Recent Activity** feed: Last 5 audit log entries with colored dots, action description, time-ago, credit cost. "View all →" links to Activity page. |

### Section Pages

Each section page renders its existing content (no changes to the data/functionality) but within the new sidebar layout. All section pages use a server/client component split: `page.tsx` (server) handles auth check, `client.tsx` (client) renders the interactive UI and consumes `DashboardContext`.

- **Skill Requests** (`/admin/dashboard/skills`): Same table with status, skill name, tenant, context, "Complete & Notify" button. On complete, calls `router.refresh()` to update sidebar badge.
- **Profiles** (`/admin/dashboard/profiles`): Same profile directory with status filter, expandable rows, verify/rescrape actions. Supports `?status=pending` URL param for deep-linking from dashboard stat card. On verify, calls `router.refresh()` to update sidebar badge.
- **Tenants** (`/admin/dashboard/tenants`): Same tenant table. Clicking a tenant navigates to `/admin/dashboard/tenant/[tenantId]`.
- **Connections** (`/admin/dashboard/connections`): Same service connections list.
- **Activity** (`/admin/dashboard/activity`): Same audit log table with full 7-day usage breakdown (messages, tokens, tool calls, external API calls, credits per tenant). This preserves the detailed usage summary that was on the old dashboard.
- **Settings** (`/admin/dashboard/settings`): Same default daily credits input.

### Component Structure

```
app/admin/dashboard/layout.tsx            ← NEW: Server component, fetches data, wraps in context
app/admin/dashboard/layout-client.tsx     ← NEW: Client layout with Sidebar + DashboardContext provider
app/admin/dashboard/page.tsx              ← Rewrite: Dashboard home (stats + sparklines)
app/admin/dashboard/client.tsx            ← Rewrite: Client component for dashboard home
app/admin/dashboard/skills/page.tsx       ← NEW: Skill requests (server + client split)
app/admin/dashboard/skills/client.tsx     ← NEW: Skill requests client component
app/admin/dashboard/profiles/page.tsx     ← NEW: Profile directory (server + client split)
app/admin/dashboard/profiles/client.tsx   ← NEW: Profile directory client component
app/admin/dashboard/tenants/page.tsx      ← NEW: Tenants list (server + client split)
app/admin/dashboard/tenants/client.tsx    ← NEW: Tenants list client component
app/admin/dashboard/connections/page.tsx  ← NEW: Service connections (server + client split)
app/admin/dashboard/connections/client.tsx← NEW: Service connections client component
app/admin/dashboard/activity/page.tsx     ← NEW: Audit log (server + client split)
app/admin/dashboard/activity/client.tsx   ← NEW: Audit log client component
app/admin/dashboard/settings/page.tsx     ← NEW: Settings (server + client split)
app/admin/dashboard/settings/client.tsx   ← NEW: Settings client component
app/admin/dashboard/tenant/[tenantId]/    ← EXISTING: Inherits sidebar layout, highlights "Tenants" in nav
components/admin/Sidebar.tsx              ← NEW: Sidebar component (client, reads DashboardContext)
components/admin/DashboardContext.tsx      ← NEW: React context for shared dashboard data
components/admin/StatCard.tsx             ← NEW: Reusable stat card with sparkline
```

**Tenant detail page:** The existing `tenant/[tenantId]/` route inherits the sidebar layout automatically via Next.js nesting. The sidebar highlights "Tenants" when viewing a tenant detail. The tenant detail page's back button navigates to `/admin/dashboard/tenants`.

### Data Flow

**Layout-level fetch with React Context:**
- `layout.tsx` (server component) fetches `/api/admin/data` once on navigation.
- Passes the full data payload to a `DashboardContext` provider in a client layout wrapper.
- Child pages consume data from context — no duplicate fetches.
- When a child page mutates data (e.g., completes a skill request), it calls `router.refresh()` to re-run the layout's server fetch and update context (including sidebar badge counts).

**New API endpoint for sparkline data:**
- `GET /api/admin/stats/daily` — returns daily aggregates for the past 7 days + today's hourly breakdown.
- Query: `SELECT DATE(created_at) as day, COUNT(*) as messages, SUM(tokens) as tokens FROM audit_log WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY day ORDER BY day`.
- Hourly breakdown for today: same query but `DATE_TRUNC('hour', created_at)` and `created_at >= CURRENT_DATE`.
- Called only by the dashboard home page, not by section pages.

**Badge counts:**
- Derived from the layout-level data: `skillRequests.filter(s => s.status === 'pending').length` and `profiles.filter(p => p.status === 'pending').length`.
- Sidebar component reads these from `DashboardContext`.

### Styling Approach

Continue with inline React styles (matching existing codebase pattern). No CSS framework changes. Color palette stays the same:

- Primary: `#3b82f6` (blue)
- Sidebar bg: `#0f172a` (dark navy)
- Sidebar hover: `#1e293b`
- Content bg: `#f8fafc` (light gray)
- Cards: white with `#e2e8f0` border
- Alert: `#ef4444` (red), `#f59e0b` (amber)

## Testing

- Verify sidebar navigation works between all routes
- Verify badge counts update after completing a skill request or verifying a profile
- Verify sparkline data is correct (today vs. past 7 days)
- Verify sidebar expand/collapse on hover works smoothly
- Verify mobile responsiveness (sidebar collapses, stats stack vertically)
- Verify tenant detail page (`/admin/dashboard/tenant/[tenantId]`) still works within the layout

## Mobile / Accessibility

- **Mobile (< 768px):** Sidebar hidden by default. Hamburger icon in top bar toggles a full-height overlay sidebar. Stat cards stack to 2x2 grid. Bottom tables stack vertically.
- **Keyboard navigation:** Sidebar items are focusable (`tabIndex`, `role="navigation"`). Arrow keys move between items. Enter activates.
- **Touch devices:** Sidebar expand triggered by tap (not hover). Tap outside closes it.

## Migration

- The current monolithic `client.tsx` will be broken into separate page components
- One new API endpoint: `GET /api/admin/stats/daily` for sparkline data
- No database changes required
- Deploy: rebuild oauth-portal, restart `babji-oauth` via PM2
