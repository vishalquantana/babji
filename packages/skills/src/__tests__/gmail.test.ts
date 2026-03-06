import { describe, it, expect } from "vitest";
import { GmailHandler } from "../gmail/index.js";

describe("GmailHandler", () => {
  it("throws on unknown action", async () => {
    // GmailHandler requires an access token but we won't hit real APIs
    const handler = new GmailHandler("fake-token");
    await expect(
      handler.execute("nonexistent_action", {})
    ).rejects.toThrow("Unknown Gmail action: nonexistent_action");
  });
});
