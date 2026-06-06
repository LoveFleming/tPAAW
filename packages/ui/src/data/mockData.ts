import { PortalApp, Skill, FlowSpec, Runbook, IncidentBundle, DataContract } from "../types";
import { nowIso } from "../utils";

export const APPS: PortalApp[] = [
    {
        id: "exec.skills",
        title: "AI Crew",
        category: "Execution",
        description: "Trigger crew members like codegen, lint, gates. Runs stay in dev sandbox.",
        tags: ["crew", "jobs", "queue"],
        risk: "guarded",
    },
    {
        id: "exec.gates",
        title: "Gates & Lints",
        category: "Execution",
        description: "Run deterministic quality gates: contract compile, unit+coverage, e2e, runbook lint.",
        tags: ["Q1-Q4", "deterministic"],
        risk: "safe",
    },
    {
        id: "mon.report",
        title: "Monitoring Report Generator",
        category: "Monitoring",
        description: "Generate daily/weekly health reports from incident bundles / snapshots (sandbox copy).",
        tags: ["AI report", "observability"],
        risk: "guarded",
    },
    {
        id: "inv.rca",
        title: "Incident Investigator",
        category: "Investigation",
        description: "Load an incident bundle and ask AI employees to produce RCA draft + runbook patch.",
        tags: ["incident bundle", "RCA"],
        risk: "guarded",
    },
];

const crewModules = import.meta.glob('../../../crew/*.json', { eager: true });
export const SKILLS: Skill[] = Object.values(crewModules).map((mod: any) => mod.default || mod) as Skill[];

export const FLOWS: FlowSpec[] = [
    {
        id: "flow.hold-lot",
        name: "Hold Lot Orchestrator",
        description: "Example flow: query triggers → validate → call external hold registration → record execution.",
        dsl: `BLOCK:execute
  RUN queryTriggerRule E:PROPAGATE
  FOR_EACH triggerRules
    CALL queryCandidateLot E:LOGGER

BLOCK:queryCandidateLot
  RUN queryCandidateLot E:PROPAGATE
  FOR_EACH candidateLots
    COUNTER:candidateLotCounter
    CALL validateCandidateLot E:holdLotCounter,errorLogger

BLOCK:validateCandidateLot
  RUN queryLastInstruction
  BIZ queryLastInstruction : isGreaterThanZero
  THEN CALL requestTxHoldReg : ORCH-ERR
`,
        nodes: [
            { id: "n1", kind: "node", title: "queryTriggerRule", notes: "Reads rules from ES" },
            { id: "n2", kind: "node", title: "queryCandidateLot", notes: "Fetches candidate lots" },
            { id: "n3", kind: "node", title: "validateCandidateLot", notes: "BIZ checks; emits BIZ errors" },
            { id: "g1", kind: "gate", title: "Q2 Unit + Coverage", notes: "Must pass before PR" },
            { id: "g2", kind: "gate", title: "Q4 Runbook Lint", notes: "Error-code mapping required" },
        ],
    },
    {
        id: "flow.phase-giga",
        name: "Giga API Orchestrator",
        description: "Example: resolve phase via AfterService then query phase APIs (anti-corruption layer).",
        dsl: `BLOCK:execute
  CALL afterService.resolvePhase E:PROPAGATE
  CALL phaseApi.queryByLot E:PROPAGATE
  VALIDATE response.contract
  RECORD execution
`,
        nodes: [
            { id: "n1", kind: "node", title: "afterService.resolvePhase", notes: "Anti-corruption resolver" },
            { id: "n2", kind: "node", title: "phaseApi.queryByLot", notes: "External client" },
            { id: "g1", kind: "gate", title: "Q1 Contract Compile", notes: "Schema validate" },
            { id: "g2", kind: "gate", title: "Q3 E2E", notes: "Happy path" },
        ],
    },
];

export const RUNBOOKS: Runbook[] = [
    { id: "rb.sys-http-timeout", title: "SYS_HTTP_TIMEOUT — outbound call timed out", errorCodePrefix: "SYS_HTTP_", updatedAt: nowIso(), summary: "Check endpoint health, retry policy, circuit breaker, and requestId correlation." },
    { id: "rb.biz-invalid-state", title: "BIZ_INVALID_STATE — business rule violation", errorCodePrefix: "BIZ_", updatedAt: nowIso(), summary: "Confirm input constraints, case status, and provide user-facing guidance." },
    { id: "rb.orch-external", title: "ORCH_EXTERNAL_ERROR — upstream returned error", errorCodePrefix: "ORCH_", updatedAt: nowIso(), summary: "Capture ExternalError fields, mask secrets, map to runbook, keep traceId." },
];

export const INCIDENTS: IncidentBundle[] = [
    { id: "inc-2026-02-07-001", createdAt: nowIso(), source: "observability-snapshot", severity: "P2", summary: "Phase API intermittent 502; increased latency; user reports slow query." },
    { id: "inc-2026-02-06-003", createdAt: nowIso(), source: "oncall-digest", severity: "P3", summary: "Runbook missing for new error code SYS_HTTP_TLS_HANDSHAKE." },
];

export const DATA_CONTRACTS: DataContract[] = [
    {
        id: "contract.user-profile",
        service: "UserService",
        consumer: "Frontend",
        status: "active",
        sla: "P99 < 100ms",
        schema: `type UserProfile {
  id: ID!
  email: String! @sensitive
  preferences: JSON
  role: Role!
}`,
    },
    {
        id: "contract.order-events",
        service: "OrderService",
        consumer: "Analytics",
        status: "active",
        sla: "Delivery < 5min",
        schema: `event OrderPlaced {
  orderId: UUID!
  items: [OrderItem!]!
  total: Money!
  timestamp: DateTime!
}`,
    },
    {
        id: "contract.legacy-billing",
        service: "BillingService",
        consumer: "PaymentGateway",
        status: "deprecated",
        sla: "Best Effort",
        schema: `// DEPRECATED: Use v2.Charge instead
message LegacyChargeRequest {
  required string card_token = 1;
  required int32 amount_cents = 2;
}`,
    },
];
