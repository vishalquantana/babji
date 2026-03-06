import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The Teacher's Desk - Babji Admin",
  description: "Admin dashboard for the Babji platform",
};

const navLinks = [
  { href: "/", label: "Tenants" },
  { href: "/skill-requests", label: "Skill Requests" },
  { href: "/analytics", label: "Analytics" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          display: "flex",
          minHeight: "100vh",
          backgroundColor: "#fafafa",
        }}
      >
        <aside
          style={{
            width: 240,
            backgroundColor: "#1a1a2e",
            color: "#fff",
            padding: "1.5rem 0",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: "0 1.5rem 1.5rem",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              marginBottom: "1rem",
            }}
          >
            <h1 style={{ fontSize: "1.1rem", margin: 0, fontWeight: 700 }}>
              The Teacher&apos;s Desk
            </h1>
            <p
              style={{
                fontSize: "0.75rem",
                margin: "0.25rem 0 0",
                opacity: 0.6,
              }}
            >
              Babji Admin
            </p>
          </div>
          <nav>
            <style>{`
              .admin-nav-link {
                display: block;
                padding: 0.6rem 1.5rem;
                color: #fff;
                text-decoration: none;
                font-size: 0.9rem;
                transition: background 0.15s;
              }
              .admin-nav-link:hover {
                background-color: rgba(255,255,255,0.08);
              }
            `}</style>
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="admin-nav-link"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </aside>
        <main style={{ flex: 1, padding: "2rem", overflowY: "auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
