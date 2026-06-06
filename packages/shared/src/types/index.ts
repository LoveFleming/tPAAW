/**
 * tAgent Shared Types
 */

// ── Run Status ──────────────────────────────────────────

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type RunnerType = "prompt" | "data" | "api" | "script";
export type ExecutionMode = "sync" | "async";
export type ConversationType = "chat" | "skill-lab" | "app-lab";

// ── Skill Runner Context ────────────────────────────────

export interface RunContext {
  runId: string;
  skillId: string;
  userId: string;
  source: {
    type: "crew-ui" | "app" | "workflow" | "cron";
    workflowId?: string;
    nodeId?: string;
    cronJobId?: string;
  };
  secrets: Record<string, string>;
}

// ── Skill Runner Result ─────────────────────────────────

export interface RunResult {
  runId: string;
  status: RunStatus;
  output?: Record<string, any>;
  error?: string;
  durationMs: number;
}

// ── Workflow Node State ─────────────────────────────────

export interface WorkflowNodeState {
  id: string;
  skillId: string;
  status: RunStatus;
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  durationMs?: number;
}

// ── Context Engine ──────────────────────────────────────

export interface UserProfile {
  userId: string;
  name: string;
  language: string;
  timezone: string;
  preferences: Record<string, any>;
  frequentIntents: Array<{ intent: string; count: number; lastUsed: string }>;
  frequentSkills: Array<{ skillId: string; weeklyAvg: number }>;
  communicationStyle?: string;
  updatedAt: string;
}

export interface ContextBundle {
  profile: Partial<UserProfile>;
  recentMessages: Array<{ role: string; content: string }>;
  activeTasks: Array<{ id: string; description: string; status: string }>;
  relevantMemories: Array<{ content: string; score: number }>;
  availableSkills: Array<{ id: string; name: string; description: string }>;
  currentPage?: string;
}

// ── Data Model (for data runner) ────────────────────────

export interface DataModelField {
  name: string;
  type: "string" | "number" | "boolean" | "email" | "phone" | "enum" | "text" | "tags" | "date";
  required?: boolean;
  default?: any;
  enum?: string[];
  searchable?: boolean;
  filterable?: boolean;
  description?: string;
}

export interface DataModel {
  id: string;
  fields: DataModelField[];
  timestamps?: boolean;    // auto add createdAt, updatedAt
  softDelete?: boolean;    // use deletedAt instead of real delete
}

export type DataOperation = "create" | "read" | "update" | "delete" | "search" | "aggregate" | "export";
