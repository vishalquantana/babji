import { getProvider } from "@/lib/providers";

interface Props {
  searchParams: Promise<{ status?: string; provider?: string; error?: string }>;
}

export default async function ResultPage({ searchParams }: Props) {
  const { status, provider: providerName, error } = await searchParams;

  const provider = providerName ? getProvider(providerName) : undefined;
  const displayName = provider?.displayName ?? providerName ?? "Unknown";

  if (status === "success") {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
        <h1 style={{ color: "#16a34a" }}>Connected!</h1>
        <p>
          Your <strong>{displayName}</strong> account is now connected to Babji.
        </p>
        <p style={{ color: "#666" }}>
          You can close this tab and return to your chat.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>Connection Failed</h1>
      <p>The connection was not completed: {error ?? "unknown error"}</p>
      <p style={{ color: "#999" }}>
        You can try again using the link from Babji.
      </p>
    </div>
  );
}
