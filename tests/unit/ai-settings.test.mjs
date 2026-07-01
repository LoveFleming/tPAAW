/**
 * Unit tests — AI Settings Files
 *
 * Verifies that all required prompt files exist and are non-empty.
 * This catches accidental deletions or empty edits.
 */
import { describe, it, expect } from "vitest";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const PAAW_ROOT = process.env.PAAW_ROOT || join(process.cwd());
const AI_SETTINGS = join(PAAW_ROOT, "data/ai-settings");

async function readFileFrom(category, file) {
  const p = join(AI_SETTINGS, category, file);
  try {
    return await readFile(p, "utf-8");
  } catch {
    return null;
  }
}

describe("AI Settings — Required Files", () => {
  describe("Chat files (chat/)", () => {
    const required = ["identity.md", "tool-rules.md", "guardrails.md", "system-prompt.md", "reply-rules.md"];
    for (const file of required) {
      it(`should have ${file}`, async () => {
        const content = await readFileFrom("chat", file);
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(10);
      });
    }
  });

  describe("Skill Builder files (skill-builder/)", () => {
    it("should have builder-rules.md", async () => {
      const content = await readFileFrom("skill-builder", "builder-rules.md");
      expect(content).toBeTruthy();
    });

    it("should have test-rules.md", async () => {
      const content = await readFileFrom("skill-builder", "test-rules.md");
      expect(content).toBeTruthy();
    });
  });

  describe("Feature-specific files", () => {
    it("mindmap/ should have system-prompt.md", async () => {
      const content = await readFileFrom("mindmap", "system-prompt.md");
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(50);
    });

    it("notes/ should have system-prompt.md", async () => {
      const content = await readFileFrom("notes", "system-prompt.md");
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(50);
    });

    it("project/ should have identity.md and rules.md", async () => {
      const identity = await readFileFrom("project", "identity.md");
      const rules = await readFileFrom("project", "rules.md");
      expect(identity).toBeTruthy();
      expect(rules).toBeTruthy();
    });
  });

  describe("Directory structure", () => {
    it("should have expected directories", async () => {
      const expected = ["chat", "skill-builder", "crew", "mindmap", "notes", "project"];
      for (const dir of expected) {
        const exists = existsSync(join(AI_SETTINGS, dir));
        expect(exists, `Missing directory: ${dir}`).toBe(true);
      }
    });
  });
});

describe("AI Settings — Content Sanity", () => {
  it("identity.md should not contain template placeholders", async () => {
    const content = await readFileFrom("chat", "identity.md");
    if (!content) return;
    expect(content).not.toContain("TODO");
    expect(content).not.toContain("PLACEHOLDER");
  });

  it("guardrails.md should mention safety or restriction", async () => {
    const content = await readFileFrom("chat", "guardrails.md");
    if (!content) return;
    const lower = content.toLowerCase();
    expect(
      lower.includes("不") || lower.includes("禁止") || lower.includes("must not") || lower.includes("never")
    ).toBe(true);
  });
});
