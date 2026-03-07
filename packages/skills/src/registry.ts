import type { SkillDefinition } from "@babji/types";

/**
 * Hardcoded skill definitions. Each definition describes what the LLM
 * can do with a connected service, and is converted to AI SDK tool
 * definitions at runtime.
 */
const gmailSkill: SkillDefinition = {
  name: "gmail",
  displayName: "Gmail",
  description: "Read, send, and manage emails via Gmail.",
  requiresAuth: {
    provider: "gmail",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  },
  actions: [
    {
      name: "list_emails",
      description: "List recent emails, optionally filtered by a search query.",
      parameters: {
        query: {
          type: "string",
          required: false,
          description: "Gmail search query (e.g. 'is:unread', 'from:alice@example.com')",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum number of emails to return (1-50, default 10)",
        },
      },
    },
    {
      name: "read_email",
      description: "Read the full content of an email by its message ID.",
      parameters: {
        message_id: {
          type: "string",
          required: true,
          description: "The Gmail message ID to read",
        },
      },
    },
    {
      name: "send_email",
      description: "Send an email to a recipient.",
      parameters: {
        to: {
          type: "string",
          required: true,
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          required: true,
          description: "Email subject line",
        },
        body: {
          type: "string",
          required: true,
          description: "Email body text",
        },
      },
    },
    {
      name: "archive_emails",
      description: "Archive emails by removing them from the inbox.",
      parameters: {
        message_ids: {
          type: "array",
          required: true,
          description: "List of Gmail message IDs to archive",
          items: { type: "string" },
        },
      },
    },
    {
      name: "block_sender",
      description: "Block a sender so their emails go to trash.",
      parameters: {
        email: {
          type: "string",
          required: true,
          description: "Email address to block",
        },
      },
    },
    {
      name: "unsubscribe",
      description: "Find unsubscribe information for a given email.",
      parameters: {
        message_id: {
          type: "string",
          required: true,
          description: "The Gmail message ID to find unsubscribe info for",
        },
      },
    },
  ],
  creditsPerAction: 1,
};

const calendarSkill: SkillDefinition = {
  name: "google_calendar",
  displayName: "Google Calendar",
  description: "Manage calendar events, check availability, and schedule meetings.",
  requiresAuth: {
    provider: "google_calendar",
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  },
  actions: [
    {
      name: "list_events",
      description: "List upcoming calendar events within a date range.",
      parameters: {
        calendar_id: {
          type: "string",
          required: false,
          description: "Calendar ID (defaults to 'primary')",
        },
        time_min: {
          type: "string",
          required: false,
          description: "Start of time range in ISO 8601 format",
        },
        time_max: {
          type: "string",
          required: false,
          description: "End of time range in ISO 8601 format",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum number of events to return (1-50, default 10)",
        },
      },
    },
    {
      name: "create_event",
      description: "Create a new calendar event.",
      parameters: {
        summary: {
          type: "string",
          required: true,
          description: "Event title",
        },
        start: {
          type: "string",
          required: true,
          description: "Start time in ISO 8601 format (e.g. 2026-03-08T10:00:00+05:30)",
        },
        end: {
          type: "string",
          required: true,
          description: "End time in ISO 8601 format (e.g. 2026-03-08T11:00:00+05:30)",
        },
        description: {
          type: "string",
          required: false,
          description: "Event description",
        },
        location: {
          type: "string",
          required: false,
          description: "Event location",
        },
        attendees: {
          type: "array",
          required: false,
          description: "List of attendee email addresses",
          items: { type: "string" },
        },
        calendar_id: {
          type: "string",
          required: false,
          description: "Calendar ID (defaults to 'primary')",
        },
      },
    },
    {
      name: "update_event",
      description: "Update an existing calendar event.",
      parameters: {
        event_id: {
          type: "string",
          required: true,
          description: "The event ID to update",
        },
        summary: {
          type: "string",
          required: false,
          description: "New event title",
        },
        start: {
          type: "string",
          required: false,
          description: "New start time in ISO 8601 format",
        },
        end: {
          type: "string",
          required: false,
          description: "New end time in ISO 8601 format",
        },
        description: {
          type: "string",
          required: false,
          description: "New event description",
        },
        location: {
          type: "string",
          required: false,
          description: "New event location",
        },
        calendar_id: {
          type: "string",
          required: false,
          description: "Calendar ID (defaults to 'primary')",
        },
      },
    },
    {
      name: "find_free_slots",
      description: "Find available/busy time slots across calendars.",
      parameters: {
        time_min: {
          type: "string",
          required: true,
          description: "Start of time range in ISO 8601 format",
        },
        time_max: {
          type: "string",
          required: true,
          description: "End of time range in ISO 8601 format",
        },
        calendar_ids: {
          type: "array",
          required: false,
          description: "List of calendar IDs to check (defaults to ['primary'])",
          items: { type: "string" },
        },
      },
    },
  ],
  creditsPerAction: 1,
};

const googleAdsSkill: SkillDefinition = {
  name: "google_ads",
  displayName: "Google Ads",
  description: "Manage Google Ads campaigns, view performance reports, control budgets, and get audience insights.",
  requiresAuth: {
    provider: "google_ads",
    scopes: [
      "https://www.googleapis.com/auth/adwords",
    ],
  },
  actions: [
    {
      name: "list_campaigns",
      description: "List all campaigns in the account with status and budget.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum campaigns to return (1-100, default 20)",
        },
      },
    },
    {
      name: "get_campaign_report",
      description: "Get performance metrics (impressions, clicks, cost, conversions, CTR) for a campaign over a date range.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
        start_date: {
          type: "string",
          required: true,
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          required: true,
          description: "End date in YYYY-MM-DD format",
        },
      },
    },
    {
      name: "get_ad_group_report",
      description: "Get performance breakdown by ad group within a campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
        start_date: {
          type: "string",
          required: true,
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          required: true,
          description: "End date in YYYY-MM-DD format",
        },
      },
    },
    {
      name: "get_keyword_report",
      description: "Get keyword performance and search term data for a campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
        start_date: {
          type: "string",
          required: true,
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          required: true,
          description: "End date in YYYY-MM-DD format",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum keywords to return (1-100, default 50)",
        },
      },
    },
    {
      name: "update_budget",
      description: "Update the daily budget for a campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
        budget_amount_micros: {
          type: "number",
          required: true,
          description: "New daily budget in micros (e.g., 5000000 = $5.00)",
        },
      },
    },
    {
      name: "pause_campaign",
      description: "Pause a running campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
      },
    },
    {
      name: "enable_campaign",
      description: "Re-enable a paused campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
      },
    },
    {
      name: "get_audience_insights",
      description: "Get audience demographics (gender, age, device) and performance breakdown for a campaign.",
      parameters: {
        customer_id: {
          type: "string",
          required: true,
          description: "Google Ads customer ID (without dashes)",
        },
        campaign_id: {
          type: "string",
          required: true,
          description: "Campaign ID (numeric)",
        },
        start_date: {
          type: "string",
          required: true,
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          required: true,
          description: "End date in YYYY-MM-DD format",
        },
      },
    },
  ],
  creditsPerAction: 1,
};

const googleAnalyticsSkill: SkillDefinition = {
  name: "google_analytics",
  displayName: "Google Analytics",
  description: "View website traffic, audience demographics, conversions, acquisition channels, and real-time data from Google Analytics 4.",
  requiresAuth: {
    provider: "google_analytics",
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/analytics.manage.users.readonly",
    ],
  },
  actions: [
    {
      name: "list_accounts",
      description: "List all Google Analytics accounts and their GA4 properties.",
      parameters: {},
    },
    {
      name: "get_traffic_overview",
      description: "Get overall traffic metrics — sessions, users, page views, bounce rate, avg session duration.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID (numeric, e.g. '123456789')",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative like '28daysAgo'). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
      },
    },
    {
      name: "get_traffic_sources",
      description: "Get traffic breakdown by source/medium (organic, paid, social, direct, referral).",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum sources to return (1-50, default 20)",
        },
      },
    },
    {
      name: "get_top_pages",
      description: "Get most visited pages with page views, time on page, and bounce rate.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum pages to return (1-50, default 20)",
        },
      },
    },
    {
      name: "get_conversions",
      description: "Get conversion events with counts and values over a date range.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
        event_names: {
          type: "array",
          required: false,
          description: "Filter to specific conversion event names. If omitted, returns all events",
          items: { type: "string" },
        },
      },
    },
    {
      name: "get_audience_demographics",
      description: "Get user breakdown by country, city, and device category.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
      },
    },
    {
      name: "get_realtime_report",
      description: "Get real-time data — active users right now, top pages, and traffic sources.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
      },
    },
    {
      name: "get_acquisition_report",
      description: "Get new vs returning users, acquisition channels, and first user source/medium.",
      parameters: {
        property_id: {
          type: "string",
          required: true,
          description: "GA4 property ID",
        },
        start_date: {
          type: "string",
          required: false,
          description: "Start date (YYYY-MM-DD or relative). Defaults to 28daysAgo",
        },
        end_date: {
          type: "string",
          required: false,
          description: "End date (YYYY-MM-DD or 'today'). Defaults to today",
        },
        max_results: {
          type: "number",
          required: false,
          description: "Maximum channels to return (1-50, default 20)",
        },
      },
    },
  ],
  creditsPerAction: 1,
};

const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill];

/**
 * Load all registered skill definitions.
 */
export function loadSkillDefinitions(): SkillDefinition[] {
  return allSkills;
}
