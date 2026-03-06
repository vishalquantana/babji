import type { BabjiMessage, OutboundMessage } from "@babji/types";

export interface AgentClient {
  sendMessage(message: BabjiMessage): Promise<OutboundMessage>;
}

export class Router {
  constructor(private agentClient: AgentClient) {}

  async route(message: BabjiMessage): Promise<OutboundMessage> {
    return this.agentClient.sendMessage(message);
  }
}
