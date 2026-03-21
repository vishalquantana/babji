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
