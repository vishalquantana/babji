import { NextRequest, NextResponse } from "next/server";
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
    return new NextResponse(
      `<html><body style="font-family:system-ui;max-width:480px;margin:4rem auto;text-align:center">
        <h1>Connection Failed</h1>
        <p>The connection was not completed: ${error}</p>
        <p style="color:#999">You can try again using the link from Babji.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  // TODO: Exchange code for tokens using provider.tokenUrl
  // TODO: Encrypt tokens using @babji/crypto TokenVault
  // TODO: Store connection in database
  // TODO: Notify Gateway to message user

  console.log(`OAuth callback for ${providerName}: code=${code?.slice(0, 10)}...`);

  return new NextResponse(
    `<html><body style="font-family:system-ui;max-width:480px;margin:4rem auto;text-align:center">
      <h1 style="color:#16a34a">Connected!</h1>
      <p>Your <strong>${provider.displayName}</strong> account is now connected to Babji.</p>
      <p style="color:#666">You can close this tab and return to your chat.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
