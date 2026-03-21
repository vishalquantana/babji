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
