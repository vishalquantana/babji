import { google } from "googleapis";
import type { SkillHandler } from "@babji/agent";

export class GoogleCalendarHandler implements SkillHandler {
  private calendar;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async execute(actionName: string, params: Record<string, unknown>): Promise<unknown> {
    switch (actionName) {
      case "list_events":
        return this.listEvents(params);
      case "create_event":
        this.requireParam(params, "summary", actionName);
        this.requireParam(params, "start", actionName);
        this.requireParam(params, "end", actionName);
        return this.createEvent(params);
      case "update_event":
        this.requireParam(params, "event_id", actionName);
        return this.updateEvent(params);
      case "find_free_slots":
        this.requireParam(params, "time_min", actionName);
        this.requireParam(params, "time_max", actionName);
        return this.findFreeSlots(params);
      default:
        throw new Error(`Unknown GoogleCalendar action: ${actionName}`);
    }
  }

  private requireParam(
    params: Record<string, unknown>,
    name: string,
    action: string
  ): void {
    if (params[name] === undefined || params[name] === null || params[name] === "") {
      throw new Error(`Missing required parameter: ${name} for ${action}`);
    }
  }

  private wrapApiError(action: string, err: unknown): never {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`GoogleCalendar ${action} failed: ${message}`);
  }

  private async listEvents(params: Record<string, unknown>) {
    const calendarId = (params.calendar_id as string) || "primary";
    const maxResults = Math.min(Math.max((params.max_results as number) || 10, 1), 50);

    try {
      const res = await this.calendar.events.list({
        calendarId,
        timeMin: (params.time_min as string) || new Date().toISOString(),
        timeMax: params.time_max as string | undefined,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = (res.data.items || []).map((event) => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        description: event.description,
        attendees: event.attendees?.map((a) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        })),
      }));

      return { events, count: events.length };
    } catch (err) {
      this.wrapApiError("list_events", err);
    }
  }

  private async createEvent(params: Record<string, unknown>) {
    const calendarId = (params.calendar_id as string) || "primary";
    const attendees = params.attendees as string[] | undefined;

    try {
      const res = await this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: params.summary as string,
          description: params.description as string | undefined,
          location: params.location as string | undefined,
          start: { dateTime: params.start as string },
          end: { dateTime: params.end as string },
          attendees: attendees?.map((email) => ({ email })),
        },
      });

      return {
        created: true,
        eventId: res.data.id,
        htmlLink: res.data.htmlLink,
      };
    } catch (err) {
      this.wrapApiError("create_event", err);
    }
  }

  private async updateEvent(params: Record<string, unknown>) {
    const calendarId = (params.calendar_id as string) || "primary";
    const eventId = params.event_id as string;

    // Build patch body with only provided fields
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: Record<string, any> = {};
    if (params.summary !== undefined) requestBody.summary = params.summary;
    if (params.description !== undefined) requestBody.description = params.description;
    if (params.location !== undefined) requestBody.location = params.location;
    if (params.start !== undefined) requestBody.start = { dateTime: params.start as string };
    if (params.end !== undefined) requestBody.end = { dateTime: params.end as string };

    try {
      const res = await this.calendar.events.patch({
        calendarId,
        eventId,
        requestBody,
      });

      return {
        updated: true,
        eventId: res.data.id,
        summary: res.data.summary,
      };
    } catch (err) {
      this.wrapApiError("update_event", err);
    }
  }

  private async findFreeSlots(params: Record<string, unknown>) {
    const calendarIds = (params.calendar_ids as string[]) || ["primary"];

    try {
      const res = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: params.time_min as string,
          timeMax: params.time_max as string,
          items: calendarIds.map((id) => ({ id })),
        },
      });

      const calendars = res.data.calendars || {};
      const busySlots: Record<string, Array<{ start: string; end: string }>> = {};

      for (const [calId, cal] of Object.entries(calendars)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        busySlots[calId] = ((cal as any).busy || []).map((slot: any) => ({
          start: slot.start,
          end: slot.end,
        }));
      }

      return { busySlots };
    } catch (err) {
      this.wrapApiError("find_free_slots", err);
    }
  }
}
