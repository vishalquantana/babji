import type { BabjiMessage, OutboundMessage } from "@babji/types";

export interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (message: BabjiMessage) => Promise<void>): void;
  sendMessage(message: OutboundMessage): Promise<void>;
}
