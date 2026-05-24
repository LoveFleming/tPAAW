#!/usr/bin/env node
// Migrate fabric-service crew skills to new schema
// 1. Extract embedded skills from crew JSON → create skills/{id}/SKILL.md
// 2. Convert crew JSON to new schema (skillIds instead of skills[])

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const AIOC_ROOT = resolve("/Users/steward/App/aieoc");
const CREWS_DIR = join(AIOC_ROOT, "factories/fabric-service/crews");
const SKILLS_DIR = join(AIOC_ROOT, "skills");
const fs = await import("fs");
const files = fs.readdirSync(CREWS_DIR).filter(f => f.endsWith(".json"));

for (const file of files) {
    const filePath = join(CREWS_DIR, file);
    const crew = JSON.parse(readFileSync(filePath, "utf-8"));
    const skillIds = [];
    
    for (const skill of (crew.skills || [])) {
        const sid = skill.id;
        skillIds.push(sid);
        
        // Build SKILL.md
        const lines = ["---"];
        lines.push(`id: ${sid}`);
        lines.push(`name: ${skill.name || sid}`);
        lines.push(`version: 1.0.0`);
        lines.push(`description: ${(skill.description || "").replace(/"/g, '\\"')}`);
        if (skill.useSkills?.length) {
            lines.push("useSkills:");
            skill.useSkills.forEach(s => lines.push(`  - ${s}`));
        }
        const inputs = skill.userInputs || skill.requiredInputs || [];
        if (inputs.length > 0) {
            lines.push("userInputs:");
            for (const inp of inputs) {
                lines.push(`  - id: ${inp.id}`);
                lines.push(`    label: ${inp.label || ""}`);
                lines.push(`    description: ${(inp.description || "").replace(/"/g, '\\"')}`);
                lines.push(`    placeholder: "${(inp.placeholder || "").replace(/\n/g, "\\n")}"`);
                lines.push(`    required: ${inp.required ?? false}`);
                if (inp.type) lines.push(`    type: ${inp.type}`);
                if (inp.multiline) lines.push(`    multiline: true`);
                if (inp.rows) lines.push(`    rows: ${inp.rows}`);
            }
        }
        lines.push("---");
        lines.push("");
        
        const prompt = skill.skillPrompt || skill.prompt || "";
        if (prompt) {
            lines.push(prompt);
        } else {
            lines.push(`# ${skill.name || sid}`);
            lines.push("");
            lines.push("## 目的");
            lines.push("");
            lines.push("## 執行步驟");
            lines.push("");
            lines.push("## 產出");
        }
        
        // Write SKILL.md
        const skillDir = join(SKILLS_DIR, sid);
        if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
        const skillPath = join(skillDir, "SKILL.md");
        if (!existsSync(skillPath)) {
            writeFileSync(skillPath, lines.join("\n"), "utf-8");
            console.log(`  Created: skills/${sid}/SKILL.md`);
        } else {
            console.log(`  Exists:  skills/${sid}/SKILL.md (skipped)`);
        }
    }
    
    // Also check skillName
    if (crew.skillName && !skillIds.includes(crew.skillName)) {
        skillIds.push(crew.skillName);
    }
    
    // Build new crew JSON
    const newCrew = {
        id: crew.id,
        title: crew.title,
        codename: crew.codename,
        imageUrl: crew.imageUrl,
        rolePrompt: crew.rolePrompt,
        skillIds: skillIds,
        risk: crew.risk || "safe",
        description: crew.description,
        chatConfig: {
            ...crew.chatConfig,
            cli: crew.chatConfig?.cli || "qwen",
            model: crew.chatConfig?.model || "moonshotai/kimi-k2.5",
            approvalMode: crew.chatConfig?.approvalMode || "yolo",
        },
    };
    
    writeFileSync(filePath, JSON.stringify(newCrew, null, 4) + "\n", "utf-8");
    console.log(`Migrated: ${file} → skillIds: [${skillIds.join(", ")}]`);
}

console.log("\nDone!");
