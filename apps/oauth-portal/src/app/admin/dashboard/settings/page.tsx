"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "../../../../components/admin/DashboardContext";

export default function SettingsPage() {
  const { data } = useDashboard();
  const router = useRouter();
  const [dailyFreeInput, setDailyFreeInput] = useState<string>(
    String(data.settings?.defaultDailyFreeCredits ?? 100)
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  async function handleSaveSettings() {
    const value = Number(dailyFreeInput);
    if (!Number.isInteger(value) || value < 0) {
      alert("Please enter a non-negative integer");
      return;
    }
    setSavingSettings(true);
    setSettingsSaved(false);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultDailyFreeCredits: value }),
      });
      if (!res.ok) throw new Error("Failed");
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
      router.refresh();
    } catch {
      alert("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Settings</h1>
      <div
        style={{
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          padding: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: 8 }}>
            Default daily free credits:
          </label>
          <input
            type="number"
            value={dailyFreeInput}
            onChange={(e) => setDailyFreeInput(e.target.value)}
            style={{
              width: 100,
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button
            onClick={handleSaveSettings}
            disabled={savingSettings}
            style={{
              background: savingSettings ? "#9ca3af" : "#2563eb",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              cursor: savingSettings ? "not-allowed" : "pointer",
              fontWeight: 500,
            }}
          >
            {savingSettings ? "Saving..." : "Save"}
          </button>
          {settingsSaved && (
            <span style={{ color: "#10b981", fontWeight: 500 }}>Saved</span>
          )}
        </div>
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          This value is used when resetting daily free credits for all tenants (unless a per-tenant
          override is set).
        </p>
      </div>
    </div>
  );
}
