export interface ProviderConfig {
  displayName: string;
  description: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

export const providers: Record<string, ProviderConfig> = {
  gmail: {
    displayName: "Gmail",
    description: "Read, send, and manage your emails",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify"],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  google_calendar: {
    displayName: "Google Calendar",
    description: "View and manage your calendar events",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  google_ads: {
    displayName: "Google Ads",
    description: "Manage campaigns, view reports, and control budgets",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  google_analytics: {
    displayName: "Google Analytics",
    description: "View website traffic, audience, and conversion data",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/analytics.manage.users.readonly",
    ],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  meta: {
    displayName: "Meta (Facebook & Instagram)",
    description: "Manage your Facebook Pages and Instagram",
    clientIdEnv: "META_CLIENT_ID",
    clientSecretEnv: "META_CLIENT_SECRET",
    scopes: ["pages_manage_posts", "instagram_basic", "instagram_content_publish"],
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
  },
  linkedin: {
    displayName: "LinkedIn",
    description: "Post and manage your LinkedIn presence",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: ["openid", "profile", "w_member_social"],
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  },
  x: {
    displayName: "X (Twitter)",
    description: "Post and manage your X account",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    scopes: ["tweet.read", "tweet.write", "users.read"],
    authUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
  },
  jira: {
    displayName: "Jira",
    description: "Read, create, and manage Jira issues",
    clientIdEnv: "ATLASSIAN_CLIENT_ID",
    clientSecretEnv: "ATLASSIAN_CLIENT_SECRET",
    scopes: [
      "read:jira-work",
      "write:jira-work",
      "read:jira-user",
      "read:servicedesk-request",
      "write:servicedesk-request",
      "offline_access",
    ],
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
  },
};

export function getProvider(name: string): ProviderConfig | undefined {
  return providers[name];
}
