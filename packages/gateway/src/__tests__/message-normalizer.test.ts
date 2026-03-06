import { describe, it, expect } from "vitest";
import { MessageNormalizer } from "../message-normalizer.js";

describe("MessageNormalizer", () => {
  it("normalizes a WhatsApp message", () => {
    const raw = {
      key: { remoteJid: "1234567890@s.whatsapp.net", id: "msg-1" },
      message: { conversation: "Hello Babji" },
      messageTimestamp: 1709740800,
    };
    const normalized = MessageNormalizer.fromWhatsApp(raw, "tenant-1");
    expect(normalized.tenantId).toBe("tenant-1");
    expect(normalized.channel).toBe("whatsapp");
    expect(normalized.text).toBe("Hello Babji");
    expect(normalized.sender).toBe("1234567890");
  });

  it("normalizes a Telegram message", () => {
    const raw = {
      message_id: 42,
      from: { id: 99887766, first_name: "Test" },
      text: "Hey there",
      date: 1709740800,
    };
    const normalized = MessageNormalizer.fromTelegram(raw, "tenant-2");
    expect(normalized.tenantId).toBe("tenant-2");
    expect(normalized.channel).toBe("telegram");
    expect(normalized.text).toBe("Hey there");
    expect(normalized.sender).toBe("99887766");
  });
});
