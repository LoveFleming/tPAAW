/**
 * Unit tests — Skill File Format
 *
 * Tests that parseSkillFrontmatter works and SKILL.md files are valid.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";
import { readdir, stat } from "fs/promises";
import { existsSync } from "fs";

const PAAW_ROOT = process.env.PAAW_ROOT || join(process.cwd());

// Inline copy of parseSkillFrontmatter (same logic as context-engine.mjs)
function parseSkillFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return { frontmatter: {}, body: content };
  const frontmatter = {};
  for (const line of fmMatch[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const body = content.slice(fmMatch[0].length);
  return { frontmatter, body };
}

// Find all SKILL.md files
async function findSkillFiles() {
  const skillsRoot = join(PAAW_ROOT, "data/skills");
  const results = [];
  if (!existsSync(skillsRoot)) return results;

  for (const category of await readdir(skillsRoot).catch(() => [])) {
    const catDir = join(skillsRoot, category);
    const catStat = await stat(catDir);
    if (!catStat.isDirectory()) continue;

    for (const slug of await readdir(catDir).catch(() => [])) {
      const skillDir = join(catDir, slug);
      if (!(await stat(skillDir).catch(() => ({ isDirectory: () => false }))).isDirectory?.()) continue;

      // Check both package/SKILL.md and direct SKILL.md
      const paths = [
        join(skillDir, "package/SKILL.md"),
        join(skillDir, "SKILL.md"),
      ];
      for (const p of paths) {
        if (existsSync(p)) {
          results.push({ path: p, category, slug });
        }
      }
    }
  }
  return results;
}

describe("Skill File Format", () => {
  describe("parseSkillFrontmatter()", () => {
    it("should parse valid frontmatter", () => {
      const content = `---
name: Test Skill
description: A test
---
# Body content`;
      const { frontmatter, body } = parseSkillFrontmatter(content);
      expect(frontmatter.name).toBe("Test Skill");
      expect(frontmatter.description).toBe("A test");
      expect(body.trim()).toBe("# Body content");
    });

    it("should handle missing frontmatter", () => {
      const content = "# Just a body";
      const { frontmatter, body } = parseSkillFrontmatter(content);
      expect(frontmatter).toEqual({});
      expect(body).toBe(content);
    });

    it("should handle empty frontmatter values", () => {
      const content = `---
name:
---\nbody`;
      const { frontmatter } = parseSkillFrontmatter(content);
      expect(frontmatter.name).toBe("");
    });
  });

  describe("Existing SKILL.md files", () => {
    it("all SKILL.md files should be valid", async () => {
      const files = await findSkillFiles();
      if (files.length === 0) {
        console.log("No SKILL.md files found — skipping");
        return;
      }

      for (const { path, slug } of files) {
        const content = await readFile(path, "utf-8");
        expect(content.length, `${slug} should not be empty`).toBeGreaterThan(0);

        // Try parsing frontmatter
        const { frontmatter, body } = parseSkillFrontmatter(content);
        // Body should have some content
        expect(body.trim().length, `${slug} body should not be empty`).toBeGreaterThan(10);
      }
    });
  });
});
