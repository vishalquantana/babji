const tenants = [
  {
    name: "Ravi's Grocery",
    phone: "+91 98765 43210",
    plan: "pro",
    timezone: "Asia/Kolkata",
    containerStatus: "running",
    lastActiveAt: "2025-01-15T10:30:00Z",
  },
  {
    name: "Lakshmi Tailoring",
    phone: "+91 91234 56789",
    plan: "free",
    timezone: "Asia/Kolkata",
    containerStatus: "stopped",
    lastActiveAt: "2025-01-14T18:45:00Z",
  },
  {
    name: "Kumar Electronics",
    phone: "+91 87654 32100",
    plan: "pro",
    timezone: "Asia/Kolkata",
    containerStatus: "running",
    lastActiveAt: "2025-01-15T09:15:00Z",
  },
  {
    name: "Priya's Salon",
    phone: "+91 76543 21098",
    plan: "free",
    timezone: "Asia/Kolkata",
    containerStatus: "provisioning",
    lastActiveAt: "2025-01-15T11:00:00Z",
  },
];

const statusColors: Record<string, string> = {
  running: "#16a34a",
  stopped: "#dc2626",
  provisioning: "#f59e0b",
};

const planBadge: Record<string, { bg: string; color: string }> = {
  pro: { bg: "#dbeafe", color: "#1d4ed8" },
  free: { bg: "#f3f4f6", color: "#6b7280" },
};

export default function TenantsPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.25rem" }}>Tenants</h1>
      <p style={{ color: "#666", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        Overview of all registered tenants on the platform.
      </p>

      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.875rem",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
              }}
            >
              {["Name", "Phone", "Plan", "Status", "Last Active"].map(
                (header) => (
                  <th
                    key={header}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 1rem",
                      fontWeight: 600,
                      color: "#374151",
                    }}
                  >
                    {header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr
                key={tenant.phone}
                style={{ borderBottom: "1px solid #f3f4f6" }}
              >
                <td style={{ padding: "0.75rem 1rem", fontWeight: 500 }}>
                  {tenant.name}
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#6b7280" }}>
                  {tenant.phone}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: 9999,
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      backgroundColor: planBadge[tenant.plan]?.bg,
                      color: planBadge[tenant.plan]?.color,
                    }}
                  >
                    {tenant.plan}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.8rem",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor:
                          statusColors[tenant.containerStatus] ?? "#9ca3af",
                        display: "inline-block",
                      }}
                    />
                    {tenant.containerStatus}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#6b7280" }}>
                  {new Date(tenant.lastActiveAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
