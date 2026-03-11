import { eq, and } from "drizzle-orm";
import type { Database } from "@babji/db";
import { schema } from "@babji/db";
import type { TokenVault } from "@babji/crypto";
import { logger } from "./logger.js";

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  cloud_id?: string;
}

interface RefreshResult {
  accessToken: string;
  status: "valid" | "refreshed" | "expired";
  cloudId?: string;
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
    return { accessToken: tokenData.access_token, status: "valid", cloudId: tokenData.cloud_id };
  }

  // Token expired or about to expire — try to refresh
  if (!tokenData.refresh_token) {
    logger.warn({ tenantId, provider }, "Token expired and no refresh_token available");
    return { accessToken: tokenData.access_token, status: "expired", cloudId: tokenData.cloud_id };
  }

  // Provider-specific OAuth credentials and token endpoint
  const isAtlassian = provider === "jira";
  const clientId = isAtlassian ? process.env.ATLASSIAN_CLIENT_ID : process.env.GOOGLE_CLIENT_ID;
  const clientSecret = isAtlassian ? process.env.ATLASSIAN_CLIENT_SECRET : process.env.GOOGLE_CLIENT_SECRET;
  const tokenUrl = isAtlassian
    ? "https://auth.atlassian.com/oauth/token"
    : "https://oauth2.googleapis.com/token";

  if (!clientId || !clientSecret) {
    logger.error({ provider }, "Client ID or Client Secret not configured for token refresh");
    return { accessToken: tokenData.access_token, status: "expired", cloudId: tokenData.cloud_id };
  }

  try {
    const response = await fetch(tokenUrl, {
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
      return { accessToken: tokenData.access_token, status: "expired", cloudId: tokenData.cloud_id };
    }

    const refreshed = await response.json() as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    const newExpiresAt = Date.now() + refreshed.expires_in * 1000;

    // Update the vault with the new access token (keep existing refresh_token and cloud_id)
    await vault.store(tenantId, provider, {
      access_token: refreshed.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: newExpiresAt,
      ...(tokenData.cloud_id ? { cloud_id: tokenData.cloud_id } : {}),
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

    return { accessToken: refreshed.access_token, status: "refreshed", cloudId: tokenData.cloud_id };
  } catch (err) {
    logger.error({ err, tenantId, provider }, "Token refresh request failed");
    return { accessToken: tokenData.access_token, status: "expired", cloudId: tokenData.cloud_id };
  }
}
