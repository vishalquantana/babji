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
      name: "rsvp_event",
      description: "Accept, decline, or mark tentative for a calendar event (RSVP).",
      parameters: {
        event_id: {
          type: "string",
          required: true,
          description: "The event ID to RSVP to",
        },
        response: {
          type: "string",
          required: true,
          description: "One of: accepted, declined, tentative",
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
      name: "list_accounts",
      description: "List all Google Ads accounts the user has access to. Call this FIRST before any other google_ads action -- it returns account IDs and names so the user can pick which account to work with. No parameters needed.",
      parameters: {},
    },
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

const checkWithTeacherSkill: SkillDefinition = {
  name: "babji",
  displayName: "Babji",
  description: "Internal actions for Babji itself.",
  actions: [
    {
      name: "check_with_teacher",
      description: "Request that the development team add a new capability. Use this when the user asks for something you cannot do with your current skills. Describe what the user wants so the team can build it.",
      parameters: {
        skill_name: {
          type: "string",
          required: true,
          description: "A short label for the requested capability (e.g. 'whatsapp_messaging', 'twitter_post', 'invoice_generator')",
        },
        context: {
          type: "string",
          required: true,
          description: "What the user asked for and why, in enough detail for the team to understand the request",
        },
      },
    },
    {
      name: "connect_service",
      description: "Generate an OAuth sign-in link for the user to connect a service. Call this whenever the user wants to connect a service or agrees to connect one. The tool returns a short URL -- include it in your reply so the user can click it.",
      parameters: {
        service_name: {
          type: "string",
          required: true,
          description: "The service to connect. One of: gmail, google_calendar, google_ads, google_analytics",
        },
      },
    },
    {
      name: "add_task",
      description: "Add a new todo or reminder for the user. Use smart defaults for remind_before: gift/purchase tasks get 5-7 days, preparation tasks 2-3 days, meetings 1 day, general deadlines 1 day. Always confirm the reminder timing with the user after creating. For recurring reminders (e.g. 'remind me every day at 9:20 AM'), use the recurrence and reminder_time parameters instead of due_date/remind_before.",
      parameters: {
        title: {
          type: "string",
          required: true,
          description: "Short description of what to do",
        },
        due_date: {
          type: "string",
          required: false,
          description: "Due date in ISO format YYYY-MM-DD. Omit for general todos with no deadline.",
        },
        remind_before: {
          type: "string",
          required: false,
          description: "How long before due_date to send a reminder. Examples: '5d' (5 days), '1w' (1 week), '3h' (3 hours). Only works if due_date is set.",
        },
        priority: {
          type: "string",
          required: false,
          description: "Priority: 'low', 'medium' (default), or 'high'",
        },
        notes: {
          type: "string",
          required: false,
          description: "Additional context or details about the task",
        },
        recurrence: {
          type: "string",
          required: false,
          description: "For recurring reminders: 'daily', 'weekdays' (Mon-Fri), 'weekly', 'monthly', or 'yearly'. When set, reminder_time is used instead of due_date/remind_before.",
        },
        reminder_time: {
          type: "string",
          required: false,
          description: "Time of day for recurring reminders in HH:MM 24-hour format (e.g. '09:20', '14:00'). Defaults to '09:00'. Only used when recurrence is set.",
        },
      },
    },
    {
      name: "list_tasks",
      description: "List the user's todos. Call this when the user asks 'what are my todos', 'what should I work on today', 'what's on my plate', or similar.",
      parameters: {
        status: {
          type: "string",
          required: false,
          description: "Filter: 'pending' (default), 'done', or 'all'",
        },
      },
    },
    {
      name: "complete_task",
      description: "Mark a todo as done.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to complete",
        },
      },
    },
    {
      name: "update_task",
      description: "Update a todo's title, due date, reminder timing, priority, or notes.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to update",
        },
        title: {
          type: "string",
          required: false,
          description: "New title",
        },
        due_date: {
          type: "string",
          required: false,
          description: "New due date in YYYY-MM-DD format",
        },
        remind_before: {
          type: "string",
          required: false,
          description: "New reminder offset, e.g. '3d', '1w'",
        },
        priority: {
          type: "string",
          required: false,
          description: "New priority: 'low', 'medium', 'high'",
        },
        notes: {
          type: "string",
          required: false,
          description: "New notes",
        },
        recurrence: {
          type: "string",
          required: false,
          description: "Change to recurring: 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'. Set to 'none' to stop recurrence.",
        },
        reminder_time: {
          type: "string",
          required: false,
          description: "New time for recurring reminder in HH:MM format (e.g. '09:20'). Only used with recurrence.",
        },
      },
    },
    {
      name: "delete_task",
      description: "Delete a todo permanently.",
      parameters: {
        task_id: {
          type: "string",
          required: true,
          description: "The UUID of the task to delete",
        },
      },
    },
  ],
  creditsPerAction: 0,
};

const peopleSkill: SkillDefinition = {
  name: "people",
  displayName: "People Research",
  description: "Research people, companies, and find contact details using LinkedIn and public data.",
  actions: [
    {
      name: "research_person",
      description: "Search for a person by name and company/domain. Returns their professional profile, work history, and LinkedIn URL.",
      parameters: {
        name: {
          type: "string",
          required: true,
          description: "Person's name (first, last, or full name)",
        },
        company_or_domain: {
          type: "string",
          required: true,
          description: "Company name or website domain to narrow the search",
        },
      },
    },
    {
      name: "lookup_profile",
      description: "Look up a LinkedIn profile directly by URL. Use when the user provides a LinkedIn link.",
      parameters: {
        linkedin_url: {
          type: "string",
          required: true,
          description: "Full LinkedIn profile URL (e.g. https://linkedin.com/in/username)",
        },
      },
    },
    {
      name: "find_email",
      description: "Find verified email addresses for a person given their name and company.",
      parameters: {
        first_name: {
          type: "string",
          required: true,
          description: "Person's first name",
        },
        last_name: {
          type: "string",
          required: true,
          description: "Person's last name",
        },
        company_name: {
          type: "string",
          required: true,
          description: "Company name where the person works",
        },
      },
    },
    {
      name: "research_company",
      description: "Look up company information from a website domain. Returns industry, size, headquarters, and description.",
      parameters: {
        domain: {
          type: "string",
          required: true,
          description: "Company website domain (e.g. quantana.com.au)",
        },
      },
    },
  ],
  creditsPerAction: 1,
};

const generalResearchSkill: SkillDefinition = {
  name: "general_research",
  displayName: "General Research",
  description: "Search the web and research any topic. Use quick_research for fast answers and deep_research for comprehensive reports.",
  actions: [
    {
      name: "quick_research",
      description: "Quick web search with grounded answers. Returns an answer with source citations. Good for factual questions, current events, quick lookups.",
      parameters: {
        query: { type: "string", required: true, description: "The search query or research question" },
        context: { type: "string", required: false, description: "Additional context to guide the search" },
      },
    },
    {
      name: "deep_research",
      description: "Start a comprehensive deep research task. Takes 5-20 minutes. Results are delivered automatically when ready. Use for market research, industry analysis, detailed topic exploration.",
      parameters: {
        query: { type: "string", required: true, description: "The research topic or question" },
        instructions: { type: "string", required: false, description: "Specific instructions for the report structure or focus areas" },
      },
    },
  ],
  creditsPerAction: 1,
};

const allSkills: SkillDefinition[] = [gmailSkill, calendarSkill, googleAdsSkill, googleAnalyticsSkill, checkWithTeacherSkill, peopleSkill, generalResearchSkill];

/**
 * Load all registered skill definitions.
 */
export function loadSkillDefinitions(): SkillDefinition[] {
  return allSkills;
}
