import { eq, and } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { TokenVault } from "@babji/crypto";
import { logger } from "./logger.js";

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
}

interface RefreshResult {
  accessToken: string;
  status: "valid" | "refreshed" | "expired";
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

/**
 * Ensures a valid access token for a tenant + provider.
 *
 * 1. If token is not expired (with 5min buffer), return it as-is.
 * 2. If expired but refresh_token exists, refresh it via Google's token endpoint.
 * 3. If refresh fails or no refresh_token, return status "expired".
 */
export async function ensureValidToken(
  tenantId: string,
  provider: string,
  vault: TokenVault,
  db: Database,
): Promise<RefreshResult | null> {
  const tokenData = await vault.retrieve(tenantId, provider) as StoredToken | null;

  if (!tokenData?.access_token) {
    return null;
  }

  // Check if token is still valid (with buffer)
  const now = Date.now();
  if (tokenData.expires_at && tokenData.expires_at > now + REFRESH_BUFFER_MS) {
    return { accessToken: tokenData.access_token, status: "valid" };
  }

  // Token expired or about to expire — try to refresh
  if (!tokenData.refresh_token) {
    logger.warn({ tenantId, provider }, "Token expired and no refresh_token available");
    return { accessToken: tokenData.access_token, status: "expired" };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logger.error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured for token refresh");
    return { accessToken: tokenData.access_token, status: "expired" };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.warn({ tenantId, provider, status: response.status, errorBody }, "Token refresh failed");
      return { accessToken: tokenData.access_token, status: "expired" };
    }

    const refreshed = await response.json() as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    const newExpiresAt = Date.now() + refreshed.expires_in * 1000;

    // Update the vault with the new access token (keep existing refresh_token)
    await vault.store(tenantId, provider, {
      access_token: refreshed.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: newExpiresAt,
    });

    // Update the DB expiry timestamp
    await db.update(schema.serviceConnections)
      .set({ expiresAt: new Date(newExpiresAt) })
      .where(
        and(
          eq(schema.serviceConnections.tenantId, tenantId),
          eq(schema.serviceConnections.provider, provider),
        ),
      );

    logger.info({ tenantId, provider, expiresIn: refreshed.expires_in }, "Token refreshed successfully");

    return { accessToken: refreshed.access_token, status: "refreshed" };
  } catch (err) {
    logger.error({ err, tenantId, provider }, "Token refresh request failed");
    return { accessToken: tokenData.access_token, status: "expired" };
  }
}
