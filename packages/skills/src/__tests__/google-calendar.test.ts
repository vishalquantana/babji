import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock googleapis ----
const mockEventsList = vi.fn();
const mockEventsInsert = vi.fn();
const mockEventsPatch = vi.fn();
const mockFreebusyQuery = vi.fn();

vi.mock("googleapis", () => {
  const calendarClient = {
    events: {
      list: (...args: unknown[]) => mockEventsList(...args),
      insert: (...args: unknown[]) => mockEventsInsert(...args),
      patch: (...args: unknown[]) => mockEventsPatch(...args),
    },
    freebusy: {
      query: (...args: unknown[]) => mockFreebusyQuery(...args),
    },
  };

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      calendar: vi.fn(() => calendarClient),
    },
  };
});

import { GoogleCalendarHandler } from "../google-calendar/index.js";

describe("GoogleCalendarHandler", () => {
  let handler: GoogleCalendarHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new GoogleCalendarHandler("fake-token");
  });

  // -------- list_events --------

  describe("list_events", () => {
    it("returns formatted event list", async () => {
      mockEventsList.mockResolvedValue({
        data: {
          items: [
            {
              id: "evt1",
              summary: "Team Standup",
              start: { dateTime: "2025-01-15T09:00:00Z" },
              end: { dateTime: "2025-01-15T09:30:00Z" },
              location: "Room A",
              description: "Daily standup",
              attendees: [
                { email: "alice@test.com", responseStatus: "accepted" },
              ],
            },
          ],
        },
      });

      const result = (await handler.execute("list_events", {
        max_results: 5,
      })) as { events: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.events[0]).toEqual({
        id: "evt1",
        summary: "Team Standup",
        start: "2025-01-15T09:00:00Z",
        end: "2025-01-15T09:30:00Z",
        location: "Room A",
        description: "Daily standup",
        attendees: [{ email: "alice@test.com", responseStatus: "accepted" }],
      });
    });

    it("clamps maxResults to 50", async () => {
      mockEventsList.mockResolvedValue({ data: { items: [] } });

      await handler.execute("list_events", { max_results: 999 });

      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 50 })
      );
    });

    it("clamps maxResults minimum to 1", async () => {
      mockEventsList.mockResolvedValue({ data: { items: [] } });

      await handler.execute("list_events", { max_results: -5 });

      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 1 })
      );
    });

    it("uses primary calendar by default", async () => {
      mockEventsList.mockResolvedValue({ data: { items: [] } });

      await handler.execute("list_events", {});

      expect(mockEventsList).toHaveBeenCalledWith(
        expect.objectContaining({ calendarId: "primary" })
      );
    });

    it("wraps API errors with sanitized message", async () => {
      mockEventsList.mockRejectedValue(new Error("quota exceeded"));

      await expect(handler.execute("list_events", {})).rejects.toThrow(
        "GoogleCalendar list_events failed: quota exceeded"
      );
    });
  });

  // -------- create_event --------

  describe("create_event", () => {
    it("creates event with required fields", async () => {
      mockEventsInsert.mockResolvedValue({
        data: { id: "new-evt-1", htmlLink: "https://calendar.google.com/event?eid=abc" },
      });

      const result = (await handler.execute("create_event", {
        summary: "Lunch Meeting",
        start: "2025-01-15T12:00:00Z",
        end: "2025-01-15T13:00:00Z",
      })) as { created: boolean; eventId: string; htmlLink: string };

      expect(result.created).toBe(true);
      expect(result.eventId).toBe("new-evt-1");
      expect(result.htmlLink).toBe("https://calendar.google.com/event?eid=abc");
    });

    it("creates event with attendees", async () => {
      mockEventsInsert.mockResolvedValue({
        data: { id: "new-evt-2", htmlLink: "https://calendar.google.com/event?eid=def" },
      });

      await handler.execute("create_event", {
        summary: "Meeting",
        start: "2025-01-15T14:00:00Z",
        end: "2025-01-15T15:00:00Z",
        attendees: ["alice@test.com", "bob@test.com"],
      });

      expect(mockEventsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            attendees: [{ email: "alice@test.com" }, { email: "bob@test.com" }],
          }),
        })
      );
    });

    it("requires summary parameter", async () => {
      await expect(
        handler.execute("create_event", { start: "2025-01-15T12:00:00Z", end: "2025-01-15T13:00:00Z" })
      ).rejects.toThrow("Missing required parameter: summary for create_event");
    });

    it("requires start parameter", async () => {
      await expect(
        handler.execute("create_event", { summary: "Test", end: "2025-01-15T13:00:00Z" })
      ).rejects.toThrow("Missing required parameter: start for create_event");
    });

    it("requires end parameter", async () => {
      await expect(
        handler.execute("create_event", { summary: "Test", start: "2025-01-15T12:00:00Z" })
      ).rejects.toThrow("Missing required parameter: end for create_event");
    });

    it("wraps API errors with sanitized message", async () => {
      mockEventsInsert.mockRejectedValue(new Error("invalid time"));

      await expect(
        handler.execute("create_event", {
          summary: "Test",
          start: "bad",
          end: "bad",
        })
      ).rejects.toThrow("GoogleCalendar create_event failed: invalid time");
    });
  });

  // -------- update_event --------

  describe("update_event", () => {
    it("patches event with provided fields", async () => {
      mockEventsPatch.mockResolvedValue({
        data: { id: "evt1", summary: "Updated Meeting" },
      });

      const result = (await handler.execute("update_event", {
        event_id: "evt1",
        summary: "Updated Meeting",
      })) as { updated: boolean; eventId: string; summary: string };

      expect(result.updated).toBe(true);
      expect(result.eventId).toBe("evt1");
      expect(result.summary).toBe("Updated Meeting");

      expect(mockEventsPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "evt1",
          calendarId: "primary",
          requestBody: { summary: "Updated Meeting" },
        })
      );
    });

    it("requires event_id parameter", async () => {
      await expect(
        handler.execute("update_event", { summary: "Test" })
      ).rejects.toThrow("Missing required parameter: event_id for update_event");
    });

    it("wraps API errors with sanitized message", async () => {
      mockEventsPatch.mockRejectedValue(new Error("not found"));

      await expect(
        handler.execute("update_event", { event_id: "bad" })
      ).rejects.toThrow("GoogleCalendar update_event failed: not found");
    });
  });

  // -------- find_free_slots --------

  describe("find_free_slots", () => {
    it("returns busy slots from freebusy query", async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: {
          calendars: {
            primary: {
              busy: [
                { start: "2025-01-15T09:00:00Z", end: "2025-01-15T10:00:00Z" },
                { start: "2025-01-15T14:00:00Z", end: "2025-01-15T15:00:00Z" },
              ],
            },
          },
        },
      });

      const result = (await handler.execute("find_free_slots", {
        time_min: "2025-01-15T00:00:00Z",
        time_max: "2025-01-15T23:59:59Z",
      })) as { busySlots: Record<string, Array<{ start: string; end: string }>> };

      expect(result.busySlots.primary).toHaveLength(2);
      expect(result.busySlots.primary[0]).toEqual({
        start: "2025-01-15T09:00:00Z",
        end: "2025-01-15T10:00:00Z",
      });
    });

    it("requires time_min parameter", async () => {
      await expect(
        handler.execute("find_free_slots", { time_max: "2025-01-15T23:59:59Z" })
      ).rejects.toThrow("Missing required parameter: time_min for find_free_slots");
    });

    it("requires time_max parameter", async () => {
      await expect(
        handler.execute("find_free_slots", { time_min: "2025-01-15T00:00:00Z" })
      ).rejects.toThrow("Missing required parameter: time_max for find_free_slots");
    });

    it("wraps API errors with sanitized message", async () => {
      mockFreebusyQuery.mockRejectedValue(new Error("calendar not found"));

      await expect(
        handler.execute("find_free_slots", {
          time_min: "2025-01-15T00:00:00Z",
          time_max: "2025-01-15T23:59:59Z",
        })
      ).rejects.toThrow("GoogleCalendar find_free_slots failed: calendar not found");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown GoogleCalendar action: nonexistent_action");
  });
});
