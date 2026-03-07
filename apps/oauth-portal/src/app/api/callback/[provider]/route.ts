import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getProvider } from "@/lib/providers";
import { createDb } from "@babji/db";
import { schema } from "@babji/db";
import { TokenVault } from "@babji/crypto";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerName } = await params;
  const provider = getProvider(providerName);

  if (!provider) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const resultUrl = new URL("/connect/result", request.nextUrl.origin);
    resultUrl.searchParams.set("status", "error");
    resultUrl.searchParams.set("provider", providerName);
    resultUrl.searchParams.set("error", error);
    redirect(resultUrl.pathname + resultUrl.search);
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  // ── Parse state to get tenantId, channel, sender ──
  let tenantId: string;
  let stateChannel: string | undefined;
  let stateSender: string | undefined;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    tenantId = decoded.tenantId;
    stateChannel = decoded.channel;
    stateSender = decoded.sender;
    if (!tenantId) throw new Error("missing tenantId");
  } catch {
    return NextResponse.json({ error: "Invalid state parameter" }, { status: 400 });
  }

  // ── Exchange authorization code for tokens ──
  const clientId = process.env[provider.clientIdEnv] || "";
  const clientSecret = process.env[provider.clientSecretEnv] || "";
  const redirectUri = `${process.env.OAUTH_PORTAL_URL || request.nextUrl.origin}/api/callback/${providerName}`;

  const tokenRes = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("Token exchange failed:", tokenRes.status, errBody);
    redirect(`/connect/result?status=error&provider=${encodeURIComponent(providerName)}&error=token_exchange_failed`);
  }

  const tokens = await tokenRes.json();
  const accessToken: string = tokens.access_token;
  const refreshToken: string | undefined = tokens.refresh_token;
  const expiresIn: number = tokens.expires_in || 3600;

  // ── Encrypt and store tokens ──
  const memoryBaseDir = process.env.MEMORY_BASE_DIR || "./data/tenants";
  const encryptionKey = process.env.ENCRYPTION_KEY || "";
  const vault = new TokenVault(memoryBaseDir, encryptionKey);

  await vault.store(tenantId, providerName, {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresIn * 1000,
  });

  // ── Insert service_connections row ──
  const databaseUrl = process.env.DATABASE_URL || "postgres://babji:babji_dev@localhost:5432/babji";
  const { db, close } = createDb(databaseUrl);

  try {
    await db.insert(schema.serviceConnections).values({
      tenantId,
      provider: providerName,
      scopes: provider.scopes,
      tokenRef: `${memoryBaseDir}/${tenantId}/credentials/${providerName}.enc`,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    });
  } finally {
    await close();
  }

  // ── Notify gateway to send post-connect summary ──
  if (stateChannel && stateSender) {
    const gatewayUrl = process.env.GATEWAY_URL || "http://127.0.0.1:3000";
    try {
      await fetch(`${gatewayUrl}/api/connect-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          provider: providerName,
          channel: stateChannel,
          sender: stateSender,
        }),
      });
    } catch (err) {
      console.error("Failed to notify gateway:", err);
    }
  }

  redirect(`/connect/result?status=success&provider=${encodeURIComponent(providerName)}`);
}
