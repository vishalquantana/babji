import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Babji - Connect Service",
  description: "Connect your services to Babji",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem", backgroundColor: "#fafafa" }}>
        {children}
      </body>
    </html>
  );
}
