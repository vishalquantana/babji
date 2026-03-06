import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
} from "baileys";
import { Boom } from "@hapi/boom";
import type { ChannelAdapter } from "./types.js";
import type { BabjiMessage, OutboundMessage } from "@babji/types";
import { MessageNormalizer } from "../message-normalizer.js";
import { TenantResolver } from "../tenant-resolver.js";
import type { Database } from "@babji/db";

export class WhatsAppAdapter implements ChannelAdapter {
  name = "whatsapp";
  private socket: WASocket | null = null;
  private messageHandler: ((msg: BabjiMessage) => Promise<void>) | null = null;
  private authDir: string;

  constructor(
    private tenantResolver: TenantResolver,
    private db: Database,
    authDir = "./data/whatsapp-auth"
  ) {
    this.authDir = authDir;
  }

  onMessage(handler: (message: BabjiMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          console.log("WhatsApp disconnected, reconnecting...");
          this.start();
        } else {
          console.log("WhatsApp logged out. Please re-scan QR code.");
        }
      } else if (connection === "open") {
        console.log("WhatsApp connected.");
      }
    });

    this.socket.ev.on(
      "messages.upsert",
      async ({ messages }: BaileysEventMap["messages.upsert"]) => {
        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const phone = (msg.key.remoteJid || "")
            .replace("@s.whatsapp.net", "")
            .replace("@g.us", "");

          const tenant = await this.tenantResolver.resolveByPhone(phone);
          const tenantId = tenant?.id || "onboarding:" + phone;

          const normalized = MessageNormalizer.fromWhatsApp(msg, tenantId);
          if (this.messageHandler) {
            await this.messageHandler(normalized);
          }
        }
      }
    );
  }

  async stop(): Promise<void> {
    this.socket?.end(undefined);
    this.socket = null;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp not connected");
    const jid = message.recipient + "@s.whatsapp.net";
    await this.socket.sendMessage(jid, { text: message.text });
  }
}
