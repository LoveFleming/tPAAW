#!/usr/bin/env node
/**
 * Migrate crew JSON files from old schema to new schema.
 * 
 * Old: { prompt, enabled, knowledge, requiredInputs }
 * New: { rolePrompt, skillPrompt, useSkills, userInputs }
 * 
 * Migration rules:
 *   prompt → skillPrompt (if it starts with a role-like instruction, extract to rolePrompt)
 *   enabled → keep for compat
 *   requiredInputs → userInputs
 *   knowledge → drop (was unused)
 *   
 *   If crew has skillName and matching skill exists in skills/ dir, add to useSkills
 */

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AIOC_ROOT = resolve(__dirname, "..");
const FACTORIES_ROOT = join(AIOC_ROOT, "factories");

async function getSharedSkillIds() {
    const skillsDir = join(AIOC_ROOT, "skills");
    try {
        const dirs = await readdir(skillsDir);
        return dirs;
    } catch {
        return [];
    }
}

async function migrateCrew(filePath, sharedSkillIds) {
    const raw = await readFile(filePath, "utf-8");
    const crew = JSON.parse(raw);
    let modified = false;

    if (!crew.skills || !Array.isArray(crew.skills)) return false;

    for (const skill of crew.skills) {
        // Migrate prompt → skillPrompt
        if (skill.prompt !== undefined && skill.skillPrompt === undefined) {
            skill.skillPrompt = skill.prompt;
            modified = true;
        }

        // Ensure rolePrompt exists
        if (skill.rolePrompt === undefined) {
            skill.rolePrompt = "";
            modified = true;
        }

        // Migrate requiredInputs → userInputs
        if (skill.requiredInputs !== undefined && skill.userInputs === undefined) {
            skill.userInputs = skill.requiredInputs;
            modified = true;
        }
        if (!skill.userInputs) {
            skill.userInputs = [];
            modified = true;
        }

        // Migrate useSkills
        if (skill.useSkills === undefined) {
            skill.useSkills = [];
            // If crew has skillName that matches a shared skill, add it
            if (crew.skillName && sharedSkillIds.includes(crew.skillName)) {
                skill.useSkills.push(crew.skillName);
            }
            modified = true;
        }
    }

    if (modified) {
        await writeFile(filePath, JSON.stringify(crew, null, 4) + "\n", "utf-8");
        console.log(`  ✅ Migrated: ${filePath}`);
    } else {
        console.log(`  ⏭️  Already new schema: ${filePath}`);
    }
    return modified;
}

async function main() {
    const sharedSkillIds = await getSharedSkillIds();
    console.log(`Shared skills: ${sharedSkillIds.join(", ") || "(none)"}`);

    const factoryDirs = await readdir(FACTORIES_ROOT);
    for (const factory of factoryDirs) {
        const crewsDir = join(FACTORIES_ROOT, factory, "crews");
        try {
            const files = await readdir(crewsDir);
            for (const file of files) {
                if (!file.endsWith(".json")) continue;
                await migrateCrew(join(crewsDir, file), sharedSkillIds);
            }
        } catch {
            // no crews dir
        }
    }
    console.log("\nDone!");
}

main().catch(console.error);
