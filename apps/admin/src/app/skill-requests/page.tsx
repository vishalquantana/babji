const skillRequests = [
  {
    tenant: "Ravi's Grocery",
    skillName: "inventory-check",
    context: "Customer asked about stock for 'Toor Dal 1kg'",
    status: "pending",
    requestedAt: "2025-01-15T10:22:00Z",
  },
  {
    tenant: "Kumar Electronics",
    skillName: "price-lookup",
    context: "Wholesale pricing request for Samsung A15",
    status: "pending",
    requestedAt: "2025-01-15T09:45:00Z",
  },
  {
    tenant: "Lakshmi Tailoring",
    skillName: "appointment-booking",
    context: "Customer wants to schedule blouse stitching",
    status: "approved",
    requestedAt: "2025-01-14T16:30:00Z",
  },
];

const statusStyles: Record<string, { bg: string; color: string }> = {
  pending: { bg: "#fef3c7", color: "#92400e" },
  approved: { bg: "#d1fae5", color: "#065f46" },
  rejected: { bg: "#fee2e2", color: "#991b1b" },
};

export default function SkillRequestsPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.25rem" }}>
        Skill Requests
      </h1>
      <p style={{ color: "#666", margin: "0 0 1.5rem", fontSize: "0.9rem" }}>
        Review and manage skill requests from tenants.
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
              {["Tenant", "Skill Name", "Context", "Status", "Requested At"].map(
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
            {skillRequests.map((req, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.75rem 1rem", fontWeight: 500 }}>
                  {req.tenant}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <code
                    style={{
                      backgroundColor: "#f3f4f6",
                      padding: "0.15rem 0.4rem",
                      borderRadius: 4,
                      fontSize: "0.8rem",
                    }}
                  >
                    {req.skillName}
                  </code>
                </td>
                <td
                  style={{
                    padding: "0.75rem 1rem",
                    color: "#6b7280",
                    maxWidth: 300,
                  }}
                >
                  {req.context}
                </td>
                <td style={{ padding: "0.75rem 1rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: 9999,
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      backgroundColor: statusStyles[req.status]?.bg,
                      color: statusStyles[req.status]?.color,
                    }}
                  >
                    {req.status}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 1rem", color: "#6b7280" }}>
                  {new Date(req.requestedAt).toLocaleString("en-IN", {
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
