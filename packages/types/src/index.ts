// === Channel Types ===

export type Channel = "whatsapp" | "telegram" | "app";

export interface BabjiMessage {
  id: string;
  tenantId: string;
  channel: Channel;
  sender: string;
  text: string;
  media?: MediaAttachment;
  timestamp: Date;
  replyTo?: string;
}

export interface MediaAttachment {
  type: "image" | "video" | "audio" | "document";
  url: string;
  mimeType: string;
  fileName?: string;
}

export interface OutboundMessage {
  tenantId: string;
  channel: Channel;
  recipient: string;
  text: string;
  media?: MediaAttachment;
  buttons?: MessageButton[];
}

export interface MessageButton {
  label: string;
  url?: string;
  callbackData?: string;
}

// === Tenant Types ===

export interface Tenant {
  id: string;
  name: string;
  phone?: string;
  telegramUserId?: string;
  plan: "free" | "prepaid" | "pro";
  timezone: string;
  createdAt: Date;
  lastActiveAt: Date;
}

// === Credit Types ===

export interface CreditBalance {
  tenantId: string;
  dailyFree: number;
  prepaid: number;
  proMonthly: number;
  total: number;
}

export type TransactionType =
  | "daily_grant"
  | "action_debit"
  | "prepaid_purchase"
  | "pro_monthly_grant"
  | "pro_monthly_reset";

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: TransactionType;
  amount: number;
  description: string;
  timestamp: Date;
}

// === Skill Types ===

export interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  requiresAuth?: {
    provider: string;
    scopes: string[];
  };
  actions: SkillAction[];
  creditsPerAction: number;
}

export interface SkillAction {
  name: string;
  description: string;
  parameters: Record<string, SkillParameter>;
}

export interface SkillParameter {
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export type SkillRequestStatus = "pending" | "in_progress" | "completed" | "rejected";

export interface SkillRequest {
  id: string;
  tenantId: string;
  skillName: string;
  context: string;
  status: SkillRequestStatus;
  assignedTo?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

// === Connection Types ===

export interface ServiceConnection {
  id: string;
  tenantId: string;
  provider: string;
  scopes: string[];
  tokenRef: string;
  expiresAt: Date;
  createdAt: Date;
}

// === Agent Types ===

export interface AgentContext {
  tenant: Tenant;
  memory: string;
  soul: string;
  connections: ServiceConnection[];
  skills: SkillDefinition[];
  sessionHistory: SessionMessage[];
}

export interface SessionMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  timestamp: Date;
}

export interface ToolCall {
  id: string;
  skillName: string;
  actionName: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  result: unknown;
  error?: string;
}

// === Heartbeat Types ===

export interface HeartbeatConfig {
  tenantId: string;
  intervalMinutes: number;
  activeHoursStart: number;
  activeHoursEnd: number;
  timezone: string;
  instructions: string;
}

export type HeartbeatResult = "ok" | "notification_sent";
