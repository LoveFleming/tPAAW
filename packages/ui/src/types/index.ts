export type AppCategory = "Assets" | "Execution" | "Monitoring" | "Investigation" | "Settings";
export type Risk = "safe" | "guarded" | "external";




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
 *   usePhysicalSkills  → 引用 physical-skill（Agent runtime 載入執行）
 *   userInputs         → 操作員要填的表單欄位
 */
export interface SkillDefinition {
    id: string;
    kind: "input-prompt" | "physical-skill";
    name: string;
    description: string;
    version?: string;
    category?: string;
    /** 具體任務指令（已废弃，保留兼容） */
    skillPrompt: string;
    /** SKILL.md 絕對路徑，AI 按需讀取 */
    skillPath?: string;
    /** 引用其他 input-prompt skill */
    useSkills: string[];
    /** 引用 physical-skill（Agent runtime 載入執行） */
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
    engine?: string; // "paaw-agent"
    // model and approvalMode removed — model is handled by PAAW default/fallback or ModelSelector
    // approvalMode is handled at the app/workspace level, not per-crew
}

/**
 * Crew — AI 員工
 *
 * 員工只存 skill IDs（引用共享技能池）
 * Engine、Model、Approval Mode 歸員工管
 */
export interface Crew {
    id: string;
    title: string;
    codename: string;
    imageUrl: string;
    rolePrompt: string;
    description: string;
    /** 專業範圍 — textarea 自由格式 */
    expertise?: string;
    /** 護欄規則 — textarea 自由格式 */
    guardrails?: {
        redirectRules?: string;
        refuseTopics?: string;
    };
    /** 引用的技能 IDs（對應 skills/input-prompt/{id}/SKILL.md） */
    skillIds: string[];
    chatConfig?: ChatConfig;
    // --- Legacy compat (kept for old JSON round-trip, no longer used) ---
    /** @deprecated */
    risk?: Risk;
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
    paths?: { paawRoot: string; projectRoot: string; workspaces?: string[]; skillRules?: string },
    workspaces?: string[],
    skillRules?: string
): string {
    const parts: string[] = [crew.rolePrompt];

    // Inject base paths
    if (paths) {
        const root = paths.paawRoot || '/';  // fallback to root if empty
        let pathLines = `## 環境路徑\n- **Root Base**: ${root}\n  - Physical Skills: ${root}/data/skills/physical-skill/`;
        if (workspaces && workspaces.length > 0) {
            pathLines += `\n\n## Workspaces 目錄\n${workspaces.map(d => `- ${d}`).join("\n")}`;
        }
        parts.push(pathLines);
    }

    // Skill rules from AI settings
    if (skillRules) {
        parts.push(skillRules);
    }

    for (const skillId of selectedSkillIds) {
        const skillDef = skillDefinitions.get(skillId);
        if (!skillDef) continue;

        if (paths) {
            const root = paths.paawRoot || '/';
            const skillPath = `${root}/data/skills/physical-skill/${skillId}/SKILL.md`;
            parts.push(`請使用 ${skillDef.name}\nskill path : ${skillPath}`);
        }
    }

    // userInputs
    if (formData && Object.keys(formData).length > 0) {
        parts.push('## 操作員提供的規格資料');
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
        expertise: crew.expertise || "",
        guardrails: crew.guardrails,
        skillIds: crew.skillIds || skillIds,
        chatConfig: crew.chatConfig,
        // Keep legacy for round-trip
        skills: crew.skills,
        skillName: crew.skillName,
    };
}

// Legacy type alias
export type Skill = Crew;

// --- Below types are unchanged ---




export type Runbook = {
    id: string;
    title: string;
    errorCodePrefix: string;
    updatedAt: string;
    summary: string;
};




// Orchestrator Types








