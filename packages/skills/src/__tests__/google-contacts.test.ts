import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock googleapis ----
const mockSearchContacts = vi.fn();
const mockCreateContact = vi.fn();
const mockGetContact = vi.fn();
const mockUpdateContact = vi.fn();

vi.mock("googleapis", () => {
  const peopleClient = {
    people: {
      searchContacts: (...args: unknown[]) => mockSearchContacts(...args),
      createContact: (...args: unknown[]) => mockCreateContact(...args),
      get: (...args: unknown[]) => mockGetContact(...args),
      updateContact: (...args: unknown[]) => mockUpdateContact(...args),
    },
  };

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
        })),
      },
      people: vi.fn(() => peopleClient),
    },
  };
});

import { GoogleContactsHandler } from "../google-contacts/index.js";

describe("GoogleContactsHandler", () => {
  let handler: GoogleContactsHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new GoogleContactsHandler("fake-token");
  });

  // -------- search_contacts --------

  describe("search_contacts", () => {
    it("returns formatted contact results", async () => {
      mockSearchContacts.mockResolvedValue({
        data: {
          results: [
            {
              person: {
                resourceName: "people/c123",
                names: [{ displayName: "Alice Smith", givenName: "Alice", familyName: "Smith" }],
                emailAddresses: [{ value: "alice@test.com" }],
                phoneNumbers: [{ value: "+1234567890" }],
                organizations: [{ name: "Acme Corp" }],
              },
            },
          ],
        },
      });

      const result = (await handler.execute("search_contacts", {
        query: "Alice",
      })) as { contacts: Array<Record<string, unknown>>; count: number };

      expect(result.count).toBe(1);
      expect(result.contacts[0]).toEqual({
        resourceName: "people/c123",
        name: "Alice Smith",
        givenName: "Alice",
        familyName: "Smith",
        email: "alice@test.com",
        phone: "+1234567890",
        organization: "Acme Corp",
      });
    });

    it("clamps maxResults to 50", async () => {
      mockSearchContacts.mockResolvedValue({ data: { results: [] } });

      await handler.execute("search_contacts", { query: "test", max_results: 999 });

      expect(mockSearchContacts).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 50 })
      );
    });

    it("clamps maxResults minimum to 1", async () => {
      mockSearchContacts.mockResolvedValue({ data: { results: [] } });

      await handler.execute("search_contacts", { query: "test", max_results: -5 });

      expect(mockSearchContacts).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 1 })
      );
    });

    it("requires query parameter", async () => {
      await expect(
        handler.execute("search_contacts", {})
      ).rejects.toThrow("Missing required parameter: query for search_contacts");
    });

    it("wraps API errors with sanitized message", async () => {
      mockSearchContacts.mockRejectedValue(new Error("permission denied"));

      await expect(
        handler.execute("search_contacts", { query: "test" })
      ).rejects.toThrow("GoogleContacts search_contacts failed: permission denied");
    });
  });

  // -------- create_contact --------

  describe("create_contact", () => {
    it("creates contact with all fields", async () => {
      mockCreateContact.mockResolvedValue({
        data: {
          resourceName: "people/c456",
          names: [{ displayName: "Bob Jones" }],
        },
      });

      const result = (await handler.execute("create_contact", {
        given_name: "Bob",
        family_name: "Jones",
        email: "bob@test.com",
        phone: "+0987654321",
        organization: "Tech Inc",
      })) as { created: boolean; resourceName: string; name: string };

      expect(result.created).toBe(true);
      expect(result.resourceName).toBe("people/c456");
      expect(result.name).toBe("Bob Jones");

      expect(mockCreateContact).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            names: [{ givenName: "Bob", familyName: "Jones" }],
            emailAddresses: [{ value: "bob@test.com" }],
            phoneNumbers: [{ value: "+0987654321" }],
            organizations: [{ name: "Tech Inc" }],
          }),
        })
      );
    });

    it("creates contact with only required fields", async () => {
      mockCreateContact.mockResolvedValue({
        data: {
          resourceName: "people/c789",
          names: [{ displayName: "Jane" }],
        },
      });

      const result = (await handler.execute("create_contact", {
        given_name: "Jane",
      })) as { created: boolean; resourceName: string };

      expect(result.created).toBe(true);
      expect(result.resourceName).toBe("people/c789");
    });

    it("requires given_name parameter", async () => {
      await expect(
        handler.execute("create_contact", { email: "test@test.com" })
      ).rejects.toThrow("Missing required parameter: given_name for create_contact");
    });

    it("wraps API errors with sanitized message", async () => {
      mockCreateContact.mockRejectedValue(new Error("quota reached"));

      await expect(
        handler.execute("create_contact", { given_name: "Test" })
      ).rejects.toThrow("GoogleContacts create_contact failed: quota reached");
    });
  });

  // -------- update_contact --------

  describe("update_contact", () => {
    it("updates contact with provided fields", async () => {
      mockGetContact.mockResolvedValue({
        data: {
          etag: "abc123",
          names: [{ givenName: "Old", familyName: "Name" }],
        },
      });
      mockUpdateContact.mockResolvedValue({
        data: {
          resourceName: "people/c123",
          names: [{ displayName: "New Name" }],
        },
      });

      const result = (await handler.execute("update_contact", {
        resource_name: "people/c123",
        given_name: "New",
      })) as { updated: boolean; resourceName: string; name: string };

      expect(result.updated).toBe(true);
      expect(result.resourceName).toBe("people/c123");
      expect(result.name).toBe("New Name");

      expect(mockUpdateContact).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceName: "people/c123",
          requestBody: expect.objectContaining({
            etag: "abc123",
            names: [{ givenName: "New", familyName: "Name" }],
          }),
        })
      );
    });

    it("requires resource_name parameter", async () => {
      await expect(
        handler.execute("update_contact", { given_name: "Test" })
      ).rejects.toThrow("Missing required parameter: resource_name for update_contact");
    });

    it("wraps API errors with sanitized message", async () => {
      mockGetContact.mockRejectedValue(new Error("contact not found"));

      await expect(
        handler.execute("update_contact", { resource_name: "people/c999" })
      ).rejects.toThrow("GoogleContacts update_contact failed: contact not found");
    });

    it("rejects update with no updatable fields", async () => {
      mockGetContact.mockResolvedValue({
        data: {
          etag: "abc123",
          names: [{ givenName: "Old", familyName: "Name" }],
        },
      });

      await expect(
        handler.execute("update_contact", { resource_name: "people/c123" })
      ).rejects.toThrow("At least one updatable field must be provided");
    });
  });

  // -------- unknown action --------

  it("throws on unknown action", async () => {
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown GoogleContacts action: nonexistent_action");
  });
});
