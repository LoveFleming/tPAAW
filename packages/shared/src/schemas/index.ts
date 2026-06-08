/**
 * PAAW Shared Schemas — Data Contracts
 * 
 * Every API has a TypeBox schema here. This IS the data contract.
 * Schemas include descriptions for AI context generation.
 */
import { Type, Static } from "@sinclair/typebox";

// ── Common ──────────────────────────────────────────────

export const PaginationQuery = Type.Object({
  page: Type.Number({ default: 1, minimum: 1, description: "Page number" }),
  pageSize: Type.Number({ default: 20, minimum: 1, maximum: 100, description: "Items per page" }),
});

export const PaginatedResponse = <T extends ReturnType<typeof Type.Object>>(dataSchema: T) =>
  Type.Object({
    items: Type.Array(dataSchema),
    pagination: Type.Object({
      page: Type.Number(),
      pageSize: Type.Number(),
      total: Type.Number(),
      totalPages: Type.Number(),
    }),
  });

export const ApiOkResponse = <T extends ReturnType<typeof Type.Object>>(dataSchema: T) =>
  Type.Object({
    ok: Type.Literal(true),
    data: dataSchema,
    error: Type.Null(),
    meta: Type.Object({
      apiVersion: Type.Literal("v1"),
      requestId: Type.String(),
      timestamp: Type.String(),
    }),
  });

export const ApiErrorResponse = Type.Object({
  ok: Type.Literal(false),
  data: Type.Null(),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Any()),
  }),
  meta: Type.Object({
    apiVersion: Type.Literal("v1"),
    requestId: Type.String(),
    timestamp: Type.String(),
  }),
});

// ── Skill Schemas ───────────────────────────────────────

export const SkillExecutionConfig = Type.Object({
  runner: Type.Union([
    Type.Literal("prompt", { description: "LLM + system prompt" }),
    Type.Literal("data", { description: "Automatic CRUD from data model" }),
    Type.Literal("api", { description: "HTTP request to external API" }),
    Type.Literal("script", { description: "Custom JavaScript in sandbox" }),
  ]),
  mode: Type.Union([Type.Literal("sync"), Type.Literal("async")], { default: "sync" }),
  timeout: Type.Number({ default: 30, description: "Timeout in seconds" }),
  config: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "Runner-specific config" })),
});

export const SkillInputField = Type.Object({
  type: Type.String({ description: "Field type: string, number, boolean, email, phone, enum, text, tags, array" }),
  required: Type.Optional(Type.Boolean({ default: false })),
  default: Type.Optional(Type.Any()),
  description: Type.Optional(Type.String()),
  enum: Type.Optional(Type.Array(Type.String())),
  items: Type.Optional(Type.Record(Type.String(), Type.Any())),
  searchable: Type.Optional(Type.Boolean({ description: "Include in full-text search" })),
  filterable: Type.Optional(Type.Boolean({ description: "Include in filter options" })),
});

export const SkillSample = Type.Object({
  description: Type.String({ description: "What this sample demonstrates" }),
  input: Type.Record(Type.String(), Type.Any()),
  output: Type.Record(Type.String(), Type.Any()),
});

export const SkillDefinition = Type.Object({
  id: Type.String({ description: "Unique skill identifier" }),
  name: Type.String({ description: "Human-readable name" }),
  description: Type.String({ description: "What this skill does" }),
  version: Type.String({ default: "1.0.0" }),
  
  input: Type.Object({
    type: Type.Literal("object"),
    properties: Type.Record(Type.String(), SkillInputField),
    ui: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "UI form hints for Crew UI" })),
  }),
  
  output: Type.Object({
    type: Type.Literal("object"),
    properties: Type.Record(Type.String(), Type.Any()),
  }),
  
  execution: SkillExecutionConfig,
  
  samples: Type.Optional(Type.Array(SkillSample, { description: "Example input/output pairs for AI context" })),
  
  access: Type.Object({
    visibility: Type.Union([Type.Literal("private"), Type.Literal("team"), Type.Literal("public")], { default: "private" }),
    roles: Type.Optional(Type.Array(Type.String())),
  }),
  
  tags: Type.Optional(Type.Array(Type.String())),
  meta: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

export const SkillRunRequest = Type.Object({
  input: Type.Record(Type.String(), Type.Any(), { description: "Skill input matching skill's input schema" }),
  context: Type.Optional(Type.Object({
    triggeredBy: Type.String({ description: "crew-ui | app | workflow | cron" }),
    workflowId: Type.Optional(Type.String()),
    cronJobId: Type.Optional(Type.String()),
  })),
});

export const SkillRunResponse = Type.Object({
  runId: Type.String(),
  skillId: Type.String(),
  status: Type.Union([Type.Literal("completed"), Type.Literal("running"), Type.Literal("failed"), Type.Literal("cancelled")]),
  input: Type.Record(Type.String(), Type.Any()),
  output: Type.Optional(Type.Record(Type.String(), Type.Any())),
  error: Type.Optional(Type.String()),
  durationMs: Type.Optional(Type.Number()),
  startedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
});

// ── App Schemas ─────────────────────────────────────────

export const AppSkillRef = Type.Object({
  skillId: Type.String(),
  role: Type.Union([Type.Literal("primary"), Type.Literal("secondary")]),
  alias: Type.String({ description: "Display name within the app" }),
});

export const AppDefinition = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  version: Type.String({ default: "1.0.0" }),
  
  composition: Type.Object({
    type: Type.Union([Type.Literal("single")], { description: "single = one primary skill. Future: multi, dynamic" }),
    skills: Type.Array(AppSkillRef),
  }),
  
  ui: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "UI layout and widget config" })),
  
  entry: Type.Object({
    standalone: Type.Boolean({ default: true }),
    embeddable: Type.Boolean({ default: true }),
    api: Type.Boolean({ default: true, description: "Auto-generate universal API" }),
  }),
  
  access: Type.Object({
    visibility: Type.Union([Type.Literal("private"), Type.Literal("team"), Type.Literal("public")]),
    roles: Type.Optional(Type.Array(Type.String())),
  }),
});

// ── Workflow Schemas ────────────────────────────────────

export const WorkflowNode = Type.Object({
  id: Type.String(),
  skillId: Type.String(),
  input: Type.Record(Type.String(), Type.Any(), { description: "Static input or {{ref}} template vars" }),
});

export const WorkflowDefinition = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  nodes: Type.Array(WorkflowNode),
  onError: Type.Union([Type.Literal("stop"), Type.Literal("skip"), Type.Literal("retry")], { default: "stop" }),
  trigger: Type.Optional(Type.Object({
    type: Type.Literal("cron"),
    schedule: Type.String({ description: "Cron expression in wall-clock time" }),
    tz: Type.String({ description: "IANA timezone", default: "Asia/Taipei" }),
  })),
});

export const WorkflowRunResponse = Type.Object({
  runId: Type.String(),
  workflowId: Type.String(),
  status: Type.Union([Type.Literal("completed"), Type.Literal("running"), Type.Literal("failed"), Type.Literal("cancelled")]),
  nodes: Type.Array(Type.Object({
    id: Type.String(),
    skillId: Type.String(),
    status: Type.Union([Type.Literal("completed"), Type.Literal("running"), Type.Literal("failed"), Type.Literal("pending")]),
    output: Type.Optional(Type.Record(Type.String(), Type.Any())),
    durationMs: Type.Optional(Type.Number()),
  })),
  startedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
});

// ── Cron Schemas ────────────────────────────────────────

export const CronDefinition = Type.Object({
  id: Type.String(),
  name: Type.String(),
  schedule: Type.Object({
    expr: Type.String({ description: "Cron expression in wall-clock time" }),
    tz: Type.String({ default: "Asia/Taipei" }),
  }),
  action: Type.Object({
    type: Type.Union([Type.Literal("skill"), Type.Literal("workflow")]),
    ref: Type.String({ description: "skillId or workflowId" }),
    input: Type.Optional(Type.Record(Type.String(), Type.Any())),
  }),
  enabled: Type.Boolean({ default: true }),
  notifications: Type.Optional(Type.Object({
    onSuccess: Type.Boolean({ default: false }),
    onFailure: Type.Boolean({ default: true }),
    channel: Type.String({ default: "in-app" }),
  })),
});

// ── Agent / Chat Schemas ────────────────────────────────

export const ChatMessage = Type.Object({
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("system"), Type.Literal("tool")]),
  content: Type.String(),
  contentType: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("image"), Type.Literal("file"), Type.Literal("action")])),
  intent: Type.Optional(Type.String({ description: "Detected intent: translate, search, schedule..." })),
  timestamp: Type.String(),
});

export const Conversation = Type.Object({
  id: Type.String(),
  userId: Type.String(),
  type: Type.Union([Type.Literal("chat"), Type.Literal("skill-lab"), Type.Literal("app-lab")], { default: "chat" }),
  startedAt: Type.String(),
  lastMessageAt: Type.String(),
  messageCount: Type.Number(),
  summary: Type.Optional(Type.String({ description: "AI-generated summary" })),
  tags: Type.Optional(Type.Array(Type.String())),
  status: Type.Union([Type.Literal("active"), Type.Literal("closed")]),
});

// ── Type exports ────────────────────────────────────────

export type SkillDefinition = Static<typeof SkillDefinition>;
export type SkillRunRequest = Static<typeof SkillRunRequest>;
export type SkillRunResponse = Static<typeof SkillRunResponse>;
export type AppDefinition = Static<typeof AppDefinition>;
export type WorkflowDefinition = Static<typeof WorkflowDefinition>;
export type WorkflowRunResponse = Static<typeof WorkflowRunResponse>;
export type CronDefinition = Static<typeof CronDefinition>;
export type ChatMessage = Static<typeof ChatMessage>;
export type Conversation = Static<typeof Conversation>;
