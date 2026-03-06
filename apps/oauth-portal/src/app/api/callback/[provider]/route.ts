import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getProvider } from "@/lib/providers";

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

  // TODO: Exchange code for tokens using provider.tokenUrl
  // TODO: Encrypt tokens using @babji/crypto TokenVault
  // TODO: Store connection in database
  // TODO: Notify Gateway to message user
  // TODO: Verify state parameter with HMAC signature to prevent CSRF

  redirect(`/connect/result?status=success&provider=${encodeURIComponent(providerName)}`);
}
