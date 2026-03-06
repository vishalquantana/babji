import { randomUUID } from "node:crypto";
import type { BabjiMessage } from "@babji/types";

export class MessageNormalizer {
  static fromWhatsApp(raw: any, tenantId: string): BabjiMessage {
    const jid = raw.key.remoteJid as string;
    const phone = jid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    return {
      id: raw.key.id || randomUUID(),
      tenantId,
      channel: "whatsapp",
      sender: phone,
      text: raw.message?.conversation || raw.message?.extendedTextMessage?.text || "",
      timestamp: new Date((raw.messageTimestamp as number) * 1000),
    };
  }

  static fromTelegram(raw: any, tenantId: string): BabjiMessage {
    return {
      id: String(raw.message_id),
      tenantId,
      channel: "telegram",
      sender: String(raw.from.id),
      text: raw.text || "",
      timestamp: new Date(raw.date * 1000),
    };
  }
}
