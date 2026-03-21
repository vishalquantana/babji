"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDashboard } from "./DashboardContext";

interface NavItem {
  label: string;
  icon: string;
  href: string;
  badge?: "skills" | "profiles";
  activePattern?: RegExp;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", icon: "⊞", href: "/admin/dashboard" },
  { label: "Skills", icon: "⚡", href: "/admin/dashboard/skills", badge: "skills" },
  { label: "Profiles", icon: "👤", href: "/admin/dashboard/profiles", badge: "profiles" },
  {
    label: "Tenants",
    icon: "👥",
    href: "/admin/dashboard/tenants",
    activePattern: /^\/admin\/dashboard\/tenant(s|\/)/,
  },
  { label: "Connections", icon: "🔗", href: "/admin/dashboard/connections" },
  { label: "Activity", icon: "📊", href: "/admin/dashboard/activity" },
];

const SETTINGS_ITEM: NavItem = {
  label: "Settings",
  icon: "⚙️",
  href: "/admin/dashboard/settings",
};

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { pendingSkillsCount, pendingProfilesCount } = useDashboard();

  function getBadgeCount(badge?: "skills" | "profiles"): number {
    if (badge === "skills") return pendingSkillsCount;
    if (badge === "profiles") return pendingProfilesCount;
    return 0;
  }

  function getBadgeColor(badge?: "skills" | "profiles"): string {
    if (badge === "skills") return "#ef4444";
    if (badge === "profiles") return "#f59e0b";
    return "transparent";
  }

  function isActive(item: NavItem): boolean {
    if (item.activePattern) return item.activePattern.test(pathname);
    if (item.href === "/admin/dashboard") return pathname === "/admin/dashboard";
    return pathname.startsWith(item.href);
  }

  function handleKeyDown(e: React.KeyboardEvent, href: string) {
    if (e.key === "Enter") router.push(href);
  }

  const sidebarStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    height: "100vh",
    width: expanded ? 200 : 60,
    background: "#0f172a",
    display: "flex",
    flexDirection: "column",
    transition: "width 0.2s ease",
    overflow: "hidden",
    flexShrink: 0,
    zIndex: 50,
  };

  const logoStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: "16px 0",
    paddingLeft: expanded ? 20 : 0,
    justifyContent: expanded ? "flex-start" : "center",
    flexShrink: 0,
  };

  const logoLetterStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    fontSize: 18,
    flexShrink: 0,
  };

  const logoLabelStyle: React.CSSProperties = {
    marginLeft: 10,
    color: "#f1f5f9",
    fontWeight: 700,
    fontSize: 16,
    whiteSpace: "nowrap",
    opacity: expanded ? 1 : 0,
    transition: "opacity 0.15s ease",
  };

  function renderNavItem(item: NavItem) {
    const active = isActive(item);
    const count = getBadgeCount(item.badge);
    const badgeColor = getBadgeColor(item.badge);
    const showBadge = count > 0;

    const itemStyle: React.CSSProperties = {
      display: "flex",
      alignItems: "center",
      padding: "10px 0",
      paddingLeft: expanded ? 20 : 0,
      justifyContent: expanded ? "flex-start" : "center",
      cursor: "pointer",
      background: active ? "#1e293b" : "transparent",
      borderLeft: active ? "3px solid #3b82f6" : "3px solid transparent",
      color: active ? "#f1f5f9" : "#94a3b8",
      position: "relative",
      transition: "background 0.15s ease, color 0.15s ease",
      userSelect: "none",
      outline: "none",
    };

    const iconWrapperStyle: React.CSSProperties = {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 24,
      height: 24,
      fontSize: 16,
      flexShrink: 0,
    };

    const overlayBadgeStyle: React.CSSProperties = {
      position: "absolute",
      top: -5,
      right: -6,
      background: badgeColor,
      color: "#fff",
      borderRadius: 9999,
      minWidth: 14,
      height: 14,
      fontSize: 9,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 3px",
      lineHeight: 1,
    };

    const labelStyle: React.CSSProperties = {
      marginLeft: 10,
      fontSize: 14,
      whiteSpace: "nowrap",
      opacity: expanded ? 1 : 0,
      transition: "opacity 0.15s ease",
      flex: 1,
    };

    const inlineBadgeStyle: React.CSSProperties = {
      marginLeft: 8,
      background: badgeColor,
      color: "#fff",
      borderRadius: 9999,
      minWidth: 18,
      height: 18,
      fontSize: 10,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 5px",
      opacity: expanded ? 1 : 0,
      transition: "opacity 0.15s ease",
    };

    return (
      <div
        key={item.href}
        style={itemStyle}
        onClick={() => router.push(item.href)}
        onKeyDown={(e) => handleKeyDown(e, item.href)}
        tabIndex={0}
        role="link"
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
      >
        <div style={iconWrapperStyle}>
          <span>{item.icon}</span>
          {showBadge && !expanded && (
            <span style={overlayBadgeStyle} aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </div>
        <span style={labelStyle}>{item.label}</span>
        {showBadge && expanded && (
          <span style={inlineBadgeStyle} aria-label={`${count} pending`}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </div>
    );
  }

  return (
    <nav
      role="navigation"
      aria-label="Admin sidebar"
      style={sidebarStyle}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div style={logoStyle}>
        <div style={logoLetterStyle}>B</div>
        <span style={logoLabelStyle}>Babji</span>
      </div>

      {/* Main nav items */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 8 }}>
        {NAV_ITEMS.map((item) => renderNavItem(item))}
      </div>

      {/* Settings at bottom */}
      <div
        style={{
          borderTop: "1px solid #1e293b",
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        {renderNavItem(SETTINGS_ITEM)}
      </div>
    </nav>
  );
}
