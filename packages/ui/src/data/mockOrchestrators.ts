import { Orchestrator } from "../types";
import { nowIso } from "../utils";

export const ORCHESTRATORS: Orchestrator[] = [
    {
        id: "lot-tool-material-check",
        name: "Lot Tool Material Check",
        domain: "material",
        apiPath: "/api/v1/material/lot-tool-check",
        apiId: "api-lot-tool-material-check",
        version: "1.0.0",
        status: "active",
        owner: "Team Material",
        lastUpdated: nowIso(),
        tags: ["material", "lot", "check", "validation"],

        summary: "Validates if the specified material is allowed to be processed by the tool for a given lot.",

        userStoryMarkdown: `
# User Story: Lot Tool Material Check

**As a** manufacturing execution system (MES),
**I want** to conditionally check if a selected material is valid for an active lot on a specific tool chamber,
**So that** we prevent material contamination and assure tool compliance.

## Context
When loading material into a tool for process execution, the system must verify the material matches the recipe and tool constraints.
`,

        apiSpec: {
            endpoint: "POST /api/v1/material/lot-tool-check",
            purpose: "Check material-tool-lot compatibility",
            requestExample: {
                lotId: "LOT12345",
                toolId: "TOOL-ABC",
                materialId: "MAT-999"
            },
            responseExample: {
                isValid: true,
                reason: "Material matches expected recipe for tool.",
                details: {
                    toolStatus: "UP",
                    materialStatus: "RELEASED"
                }
            },
            requestSchema: {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {
                    "lotId": { "type": "string" },
                    "toolId": { "type": "string" },
                    "materialId": { "type": "string" }
                },
                "required": ["lotId", "toolId", "materialId"]
            },
            responseSchema: {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "properties": {
                    "isValid": { "type": "boolean" },
                    "reason": { "type": "string" }
                },
                "required": ["isValid"]
            }
        },

        orchestratorSpecMarkdown: `
# Orchestrator Spec: Lot Tool Material Check

This orchestrator receives a validation request and executes three consecutive data checks (Validate Request -> Query Lot -> Query Tool -> Check Material -> Build Response).

The key invariant is that if the tool is not in an "UP" state, or if the material is marked as "HOLD", the validation must fail immediately.

See the Decision Rules section for specific business error conditions.
`,

        flowSteps: [
            {
                stepId: "step-1",
                nodeId: "node-validate-request",
                purpose: "Validate incoming API payload",
                input: "API Request",
                output: "Validated Payload",
                onError: "SYS_INVALID_INPUT"
            },
            {
                stepId: "step-2",
                nodeId: "node-query-lot",
                purpose: "Fetch lot active status and recipe",
                input: "lotId",
                output: "Lot Details",
                onError: "EXT_LOT_SERVICE_ERROR"
            },
            {
                stepId: "step-3",
                nodeId: "node-query-tool",
                purpose: "Fetch tool current status",
                input: "toolId",
                output: "Tool Details",
                onError: "EXT_TOOL_SERVICE_ERROR"
            },
            {
                stepId: "step-4",
                nodeId: "node-check-material",
                purpose: "Cross-reference material against tool and lot specs",
                input: "Lot Details, Tool Details, materialId",
                output: "Validation Result",
                onError: "BIZ_MATERIAL_REJECTED"
            },
            {
                stepId: "step-5",
                nodeId: "node-build-response",
                purpose: "Format final API response",
                input: "Validation Result",
                output: "API Response",
                onError: "SYS_INTERNAL_ERROR"
            }
        ],

        decisionRules: [
            {
                ruleId: "RULE-MAT-01",
                description: "Tool must be UP",
                when: "toolStatus !== 'UP'",
                then: "Reject validation",
                errorCode: "BIZ_TOOL_NOT_UP"
            },
            {
                ruleId: "RULE-MAT-02",
                description: "Material must not be ON HOLD",
                when: "materialStatus === 'HOLD'",
                then: "Reject validation",
                errorCode: "BIZ_MATERIAL_ON_HOLD"
            }
        ],

        errorPolicy: [
            { kind: "BIZ", policy: "Return 200 OK with isValid=false and populate reason." },
            { kind: "EXT", policy: "Retry up to 3 times with exponential backoff. If failed, return 503." },
            { kind: "SYS", policy: "Log stack trace, trigger P3 alert, return 500." }
        ],

        errorCodes: [
            { code: "BIZ_TOOL_NOT_UP", category: "BIZ", description: "The specified tool is not in UP state." },
            { code: "BIZ_MATERIAL_ON_HOLD", category: "BIZ", description: "The material has been placed on hold." },
            { code: "SYS_INVALID_INPUT", category: "SYS", description: "Request payload did not match schema." },
            { code: "EXT_LOT_SERVICE_ERROR", category: "EXT", description: "Upstream lot service timeout." }
        ],

        observability: {
            metrics: [
                { name: "material_check_success", description: "Incremented on isValid=true", type: "Counter" },
                { name: "material_check_reject", description: "Incremented on isValid=false", type: "Counter" },
                { name: "tool_query_latency", description: "Latency of tool service query", type: "Timer" }
            ],
            logFields: ["lotId", "toolId", "materialId", "is_valid", "error_code"],
            events: [
                { name: "MaterialCheckFailedEvent", trigger: "When isValid=false, publish to Kafka topic." }
            ]
        },

        nodeContracts: [
            {
                nodeId: "node-query-tool",
                description: "Calls Tool Service API to get tool state",
                inputSchema: {
                    type: "object",
                    properties: { toolId: { type: "string" } }
                },
                outputSchema: {
                    type: "object",
                    properties: { toolState: { type: "string" }, alarms: { type: "array" } }
                }
            },
            {
                nodeId: "node-check-material",
                description: "Applies BIZ rules for material compatibility",
                inputSchema: {
                    type: "object",
                    properties: { materialId: { type: "string" }, requiredRecipe: { type: "string" } }
                },
                outputSchema: {
                    type: "object",
                    properties: { match: { type: "boolean" }, conflictReason: { type: "string" } }
                }
            }
        ],

        runbookMarkdown: `
# Runbook: Lot Tool Material Check (material)

## BIZ_TOOL_NOT_UP
**Symptom**: User receives validation rejection citing tool is not UP.
**Resolution**: Check MES to confirm if tool was recently downed. If it should be UP, follow up with Equipment Eng.

## EXT_LOT_SERVICE_ERROR
**Symptom**: 503 Service Unavailable during lot query.
**Resolution**: Check Datadog for 'lot-service' health. If recovering, no action needed. If persistent, escalate to Team Core.
`,

        testTargets: {
            happyPath: [
                "Valid material, tool UP, lot active -> returns isValid=true"
            ],
            rejectCases: [
                "Material HOLD -> returns BIZ_MATERIAL_ON_HOLD",
                "Tool DOWN -> returns BIZ_TOOL_NOT_UP"
            ],
            errorCases: [
                "Timeout connecting to lot-service -> returns 503 EXT_LOT_SERVICE_ERROR"
            ],
            contractValidation: [
                "Missing toolId -> returns 400 SYS_INVALID_INPUT"
            ]
        }
    },
    {
        id: "lot-tool-chamber-material-check",
        name: "Chamber Material Check",
        domain: "material",
        apiPath: "/api/v1/material/chamber-check",
        apiId: "api-lot-tool-chamber-material-check",
        version: "1.1.0",
        status: "draft",
        owner: "Team Material",
        lastUpdated: nowIso(),
        tags: ["material", "chamber"],
        summary: "Validates material for a specific tool chamber.",
        userStoryMarkdown: "Check chamber level constraints.",
        apiSpec: {
            endpoint: "POST /chamber-check",
            purpose: "Check chamber",
            requestSchema: {},
            responseSchema: {},
            requestExample: {},
            responseExample: {}
        },
        orchestratorSpecMarkdown: "Draft spec.",
        flowSteps: [],
        decisionRules: [],
        errorPolicy: [],
        errorCodes: [],
        observability: { metrics: [], logFields: [], events: [] },
        nodeContracts: [],
        runbookMarkdown: "TBD",
        testTargets: { happyPath: [], rejectCases: [], errorCases: [], contractValidation: [] }
    },
    {
        id: "lot-tool-check",
        name: "Lot Tool Basic Check",
        domain: "rw",
        apiPath: "/api/v1/rw/lot-tool-check",
        apiId: "api-lot-tool-check",
        version: "2.0.0",
        status: "active",
        owner: "Team RW",
        lastUpdated: nowIso(),
        tags: ["rw", "tool"],
        summary: "Basic tool compatibility for lot r/w operations.",
        userStoryMarkdown: "...",
        apiSpec: {
            endpoint: "POST /rw/check",
            purpose: "RW",
            requestSchema: {},
            responseSchema: {},
            requestExample: {},
            responseExample: {}
        },
        orchestratorSpecMarkdown: "...",
        flowSteps: [],
        decisionRules: [],
        errorPolicy: [],
        errorCodes: [],
        observability: { metrics: [], logFields: [], events: [] },
        nodeContracts: [],
        runbookMarkdown: "...",
        testTargets: { happyPath: [], rejectCases: [], errorCases: [], contractValidation: [] }
    }
];
