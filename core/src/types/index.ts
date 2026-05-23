export type AppCategory = "Assets" | "Execution" | "Monitoring" | "Investigation" | "Settings";
export type Risk = "safe" | "guarded" | "external";

export type PortalApp = {
    id: string;
    title: string;
    category: AppCategory;
    description: string;
    tags: string[];
    risk: Risk;
};

export type SkillEngine = "qwen" | "deterministic" | "cline";

export interface RequiredInput {
    id: string;
    label: string;
    description: string;
    placeholder: string;
    required: boolean;
    multiline?: boolean;
    rows?: number;
    group?: string;  // 分組顯示
}

export type CliEngine = "qwen" | "claude" | "opencode";

export interface CrewSkill {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    prompt: string;
    knowledge?: string[];
    requiredInputs?: RequiredInput[];
    cli?: CliEngine;
    model?: string;
    approvalMode?: string;
}

export interface ChatConfig {
    greeting?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    cli?: string;
    approvalMode?: string;
}

export type Skill = {
    id: string;
    title: string;
    codename: string;
    imageUrl: string;
    skillName?: string;
    skills: CrewSkill[];
    risk: Risk;
    description: string;
    rolePrompt: string;
    chatConfig?: ChatConfig;
};

export function buildSystemPrompt(crew: Skill, selectedSkillIds?: string[], formData?: Record<string, string>, paths?: { aiocRoot: string; projectRoot: string }): string {
    const parts: string[] = [crew.rolePrompt];

    // Inject base paths so CLI knows where to find AIOC resources and project files
    if (paths) {
        parts.push(`\n## 環境路徑\n- **AIOC Base**: ${paths.aiocRoot}（factories、conversations 都在這裡）\n- **Project Codebase**: ${paths.projectRoot}（AI CLI 的工作目錄，使用者的專案原始碼）\n\n讀取 AIOC 資源時使用 AIOC Base 路徑下的 factories/ 目錄。`);
    }

    const skillsToLoad = crew.skills.filter(
        s => selectedSkillIds ? selectedSkillIds.includes(s.id) : s.enabled
    );

    for (const skill of skillsToLoad) {
        parts.push(`\n## Skill: ${skill.name}\n${skill.prompt}`);
    }

    // Inject form data if provided
    if (formData && Object.keys(formData).length > 0) {
        parts.push('\n## 操作員提供的規格資料');
        for (const [key, value] of Object.entries(formData)) {
            if (value.trim()) {
                parts.push(`### ${key}\n${value}`);
            }
        }
    }

    return parts.join('\n\n');
}

export type RunStatus = "queued" | "running" | "success" | "failed";

export type Run = {
    id: string;
    title: string;
    createdAt: string;
    status: RunStatus;
    risk: Risk;
    engine: SkillEngine;
    logs: string[];
    aiJsonLines?: unknown[];
};

export type FlowSpec = {
    id: string;
    name: string;
    description: string;
    dsl: string;
    nodes: Array<{ id: string; kind: "node" | "gate"; title: string; notes?: string }>;
};

export type Runbook = {
    id: string;
    title: string;
    errorCodePrefix: string;
    updatedAt: string;
    summary: string;
};

export type NodeConfig = {
    id: string;
    nodeType: string;
    owner: string;
    version: string;
    schemaSnippet: string;
};

export type IncidentBundle = {
    id: string;
    createdAt: string;
    source: string;
    severity: "P1" | "P2" | "P3";
    summary: string;
};

export type DataContract = {
    id: string;
    service: string;
    consumer: string;
    schema: string;
    sla: string;
    status: "active" | "deprecated" | "draft";
};

// Orchestrator Types
export interface FlowStep {
    stepId: string;
    nodeId: string;
    purpose: string;
    input: string;
    output: string;
    onError: string;
}

export interface DecisionRule {
    ruleId: string;
    description: string;
    when: string;
    then: string;
    errorCode?: string;
}

export interface ErrorPolicy {
    kind: string;
    policy: string;
}

export interface ErrorCodeDef {
    code: string;
    category: "BIZ" | "EXT" | "SYS";
    description: string;
}

export interface MetricDef {
    name: string;
    description: string;
    type: string;
}

export interface EventDef {
    name: string;
    trigger: string;
}

export interface NodeContract {
    nodeId: string;
    description: string;
    inputSchema: any;
    outputSchema: any;
}

export interface TestTargets {
    happyPath: string[];
    rejectCases: string[];
    errorCases: string[];
    contractValidation: string[];
}

export interface Orchestrator {
    id: string;
    name: string;
    domain: string;
    apiPath: string;
    apiId: string;
    version: string;
    status: "active" | "draft" | "deprecated";
    owner: string;
    lastUpdated: string;
    tags: string[];

    summary: string;
    userStoryMarkdown: string;

    apiSpec: {
        endpoint: string;
        purpose: string;
        requestSchema: any;
        responseSchema: any;
        requestExample: any;
        responseExample: any;
    };

    orchestratorSpecMarkdown: string;
    flowSteps: FlowStep[];
    decisionRules: DecisionRule[];
    
    errorPolicy: ErrorPolicy[];
    errorCodes: ErrorCodeDef[];
    
    observability: {
        metrics: MetricDef[];
        logFields: string[];
        events: EventDef[];
    };
    
    nodeContracts: NodeContract[];
    runbookMarkdown: string;
    testTargets: TestTargets;
}
