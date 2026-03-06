const stats = [
  {
    label: "Active Tenants",
    value: "42",
    color: "#3b82f6",
    bg: "#eff6ff",
  },
  {
    label: "Total Actions Today",
    value: "156",
    color: "#8b5cf6",
    bg: "#f5f3ff",
  },
  {
    label: "Pending Skill Requests",
    value: "3",
    color: "#f59e0b",
    bg: "#fffbeb",
  },
  {
    label: "Credit Usage (7d)",
    value: "1,234",
    color: "#10b981",
    bg: "#ecfdf5",
  },
];

export default function AnalyticsPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.25rem" }}>Analytics</h1>
      <p style={{ color: "#666", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        Platform-wide metrics at a glance.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "1rem",
        }}
      >
        {stats.map((stat) => (
          <div
            key={stat.label}
            style={{
              backgroundColor: "#fff",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              padding: "1.5rem",
            }}
          >
            <p
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.8rem",
                color: "#6b7280",
                fontWeight: 500,
              }}
            >
              {stat.label}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "2rem",
                fontWeight: 700,
                color: stat.color,
              }}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: "2rem",
          padding: "2rem",
          backgroundColor: "#fff",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          textAlign: "center",
          color: "#9ca3af",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.9rem" }}>
          Detailed charts and time-series analytics will be added here once the
          database integration is complete.
        </p>
      </div>
    </div>
  );
}
