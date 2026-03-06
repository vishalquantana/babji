import { notFound } from "next/navigation";
import { getProvider } from "@/lib/providers";

interface Props {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function ConnectPage({ params, searchParams }: Props) {
  const { provider: providerName } = await params;
  const { t: token } = await searchParams;
  const provider = getProvider(providerName);

  if (!provider) {
    notFound();
  }

  if (!token) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
        <h1>Invalid Link</h1>
        <p>This connection link is missing a token. Please use the link provided by Babji in your chat.</p>
      </div>
    );
  }

  // Build the OAuth authorization URL
  const clientId = process.env[provider.clientIdEnv] ?? "";
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3100"}/api/callback/${providerName}`;
  const state = encodeURIComponent(JSON.stringify({ token, provider: providerName }));

  const authUrl = new URL(provider.authUrl);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", provider.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  if (provider.authUrl.includes("google")) {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
  }

  return (
    <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>Connect {provider.displayName}</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Babji would like to access your <strong>{provider.displayName}</strong> account
        to {provider.description.toLowerCase()}.
      </p>
      <div style={{ margin: "2rem 0", padding: "1rem", background: "#fff", borderRadius: 8, border: "1px solid #ddd" }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>Babji will be able to:</p>
        <p style={{ color: "#666", fontSize: 14 }}>{provider.description}</p>
      </div>
      <a
        href={authUrl.toString()}
        style={{
          display: "inline-block",
          padding: "12px 32px",
          background: "#2563eb",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 16,
        }}
      >
        Connect {provider.displayName}
      </a>
      <p style={{ marginTop: "2rem", fontSize: 13, color: "#999" }}>
        You can disconnect at any time by telling Babji.
      </p>
    </div>
  );
}
