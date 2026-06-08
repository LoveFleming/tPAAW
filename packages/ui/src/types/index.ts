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

export type CliEngine = "qwen" | "claude" | "opencode";

/**
 * UserInput — 操作員在啟動 Skill 前要填的表單欄位
 * 定義在 skills/input-prompt/{id}/SKILL.md 的 frontmatter 裡
 */
export interface UserInput {
    id: string;
    label: string;
    description: string;
    placeholder: string;
    required: boolean;
    type?: "text" | "textarea" | "select" | "number";
    multiline?: boolean;
    rows?: number;
    group?: string;
    options?: string[];
}

/**
 * SkillDefinition — 技能
 * 
 * 兩種 kind：
 *   input-prompt    → 定義「操作員填什麼 + prompt 怎麼寫」，放在 skills/input-prompt/
 *   physical-skill  → 打包好的實體 skill（zip 解開），放在 skills/physical-skill/
 * 
 * 三個核心欄位：
 *   skillPrompt        → 具體任務指令（告訴 AI 做什麼、怎麼做）
 *   useSkills          → 引用其他 input-prompt skill
 *   usePhysicalSkills  → 引用 physical-skill（CLI runtime 載入執行）
 *   userInputs         → 操作員要填的表單欄位
 */
export interface SkillDefinition {
    id: string;
    kind: "input-prompt" | "physical-skill";
    name: string;
    description: string;
    version?: string;
    category?: string;
    /** 具體任務指令 */
    skillPrompt: string;
    /** 引用其他 input-prompt skill */
    useSkills: string[];
    /** 引用 physical-skill（CLI runtime 載入執行） */
    usePhysicalSkills: string[];
    /** 操作員要填的表單 */
    userInputs: UserInput[];
    /** SKILL.md 完整內容 */
    fullContent?: string;
    /** 是否有 app.html（可作為報表/App 顯示） */
    hasApp?: boolean;
}

export interface ChatConfig {
    greeting?: string;
    maxTokens?: number;
    temperature?: number;
    cli?: CliEngine;
    model?: string;
    approvalMode?: string;
}

/**
 * Crew — AI 員工
 *
 * 員工只存 skill IDs（引用共享技能池）
 * CLI、Model、Approval Mode 歸員工管
 */
export interface Crew {
    id: string;
    title: string;
    codename: string;
    imageUrl: string;
    rolePrompt: string;
    description: string;
    risk: Risk;
    /** 引用的技能 IDs（對應 skills/input-prompt/{id}/SKILL.md） */
    skillIds: string[];
    chatConfig?: ChatConfig;
    // --- Legacy compat ---
    /** @deprecated use skillIds */
    skills?: any[];
    /** @deprecated */
    skillName?: string;
}

/**
 * 把 crew JSON 和 skill definitions 組合，產出 system prompt
 */
export function buildSystemPrompt(
    crew: Crew,
    skillDefinitions: Map<string, SkillDefinition>,
    selectedSkillIds: string[],
    formData?: Record<string, string>,
    paths?: { paawRoot: string; projectRoot: string; factoryId?: string },
    workspaces?: string[]
): string {
    // 角色永遠由員工決定
    const parts: string[] = [crew.rolePrompt];

    // Inject base paths
    if (paths) {
        const factoryPath = `${paths.paawRoot}/crews`;
        parts.push(`\n## 環境路徑\n- **PAAW Base**: ${paths.paawRoot}\n  - Input-Prompt Skills: ${paths.paawRoot}/skills/input-prompt/\n  - Physical Skills: ${paths.paawRoot}/skills/physical-skill/\n  - Factory: ${factoryPath}\n- **Working Base**: ${paths.projectRoot}${workspaces && workspaces.length > 0 ? `\n\n## Workspace 目錄\n${workspaces.map(d => `- ${d}`).join("\n")}` : ""}\n\n所有路徑皆可讀寫。根據任務需求在對應路徑操作。`);
    }

    for (const skillId of selectedSkillIds) {
        const skillDef = skillDefinitions.get(skillId);
        if (!skillDef) continue;

        // ── 1. skillPrompt ──
        if (skillDef.skillPrompt) {
            parts.push(`\n## Skill: ${skillDef.name}\n${skillDef.skillPrompt}`);
        }

        // ── 2. useSkills — 注入檔案路徑讓 CLI 讀取 ──
        if (skillDef.useSkills.length > 0 && paths) {
            const skillPaths = skillDef.useSkills.map(id => `- ${paths.paawRoot}/skills/input-prompt/${id}/SKILL.md`);
            parts.push(`\n### 參考技能\n請先讀取以下技能檔案：\n${skillPaths.join("\n")}`);
        }

        // ── 2b. usePhysicalSkills — 注入 physical skill 路徑 ──
        if (skillDef.usePhysicalSkills?.length > 0 && paths) {
            const psPaths = skillDef.usePhysicalSkills.map(id => `- ${paths.paawRoot}/skills/physical-skill/${id}/`);
            parts.push(`\n### 實體技能\n請載入以下實體技能目錄：\n${psPaths.join("\n")}`);
        }
    }

    // ── 3. userInputs — 操作員提供的資料 ──
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

/**
 * Migrate legacy crew JSON to new schema
 */
export function migrateCrew(crew: any): Crew {
    const skillIds: string[] = [];
    
    // Extract skill IDs from old embedded skills array
    if (Array.isArray(crew.skills)) {
        for (const s of crew.skills) {
            const sid = s.id || s.skillId;
            if (sid && !skillIds.includes(sid)) {
                skillIds.push(sid);
            }
        }
    }
    // Also check skillName
    if (crew.skillName && !skillIds.includes(crew.skillName)) {
        skillIds.push(crew.skillName);
    }

    return {
        id: crew.id || "",
        title: crew.title || "",
        codename: crew.codename || "",
        imageUrl: crew.imageUrl || "",
        rolePrompt: crew.rolePrompt || "",
        description: crew.description || "",
        risk: crew.risk || "safe",
        skillIds: crew.skillIds || skillIds,
        chatConfig: crew.chatConfig,
        // Keep legacy for round-trip
        skills: crew.skills,
        skillName: crew.skillName,
    };
}

// Legacy type alias
export type Skill = Crew;
export type CrewSkill = any;

// --- Below types are unchanged ---

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
