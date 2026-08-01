/**
 * Unit tests — packages/server/src/lib/dependency-context.mjs
 *
 * Covers all exported functions:
 *   - getDependencyContext()
 *   - getAffectedTests()
 *   - getImpactSummary()
 *
 * Strategy: Mock fs (readFileSync, existsSync) to provide controlled
 * Code Intelligence JSON data fixtures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fs (use vi.hoisted so mock fns are available when factory runs) ──
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));
vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// Import after mock setup
import {
  getDependencyContext,
  getAffectedTests,
  getImpactSummary,
} from "@server/lib/dependency-context.mjs";

// ── Fixtures ──
const FIXTURES = {
  callGraph: {
    callersOf: {
      "src/utils.mjs:helperFn": ["src/routes/a.mjs:doThing", "src/routes/b.mjs:otherFn"],
      "src/utils.mjs:formatDate": ["src/routes/a.mjs:render"],
      "src/other.mjs:unrelated": ["src/foo.mjs:bar"],
    },
  },
  depGraph: {
    files: {
      "src/utils.mjs": {
        importedBy: ["src/routes/a.mjs", "src/routes/b.mjs", "src/index.mjs"],
        exports: ["helperFn", "formatDate", "validateInput"],
        imports: [
          { targetFile: "src/types.mjs", names: ["UserType"] },
          { targetFile: "node:path", names: ["join"] },
        ],
      },
    },
  },
  fileMap: {
    "src/utils.mjs": { symbols: ["helperFn", "formatDate"] },
  },
  testCodeMap: {
    "src/utils.mjs": ["tests/unit/utils.test.mjs"],
    "src/routes/a.mjs": ["tests/unit/routes-a.test.mjs"],
  },
};

const CWD = "/project";

// Helper: configure mock fs to return fixture data
function setupCIMocks(fixtureKeys = ["callGraph", "depGraph", "fileMap", "testCodeMap"]) {
  const fileMap = {
    callGraph: ".paaw/code-intelligence/call-graph.json",
    depGraph: ".paaw/code-intelligence/dependency-graph.json",
    fileMap: ".paaw/code-intelligence/file-map.json",
    testCodeMap: ".paaw/code-intelligence/test-code-map.json",
  };

  mockExistsSync.mockImplementation((p) => {
    for (const key of fixtureKeys) {
      if (p.endsWith(fileMap[key])) return true;
    }
    return false;
  });

  mockReadFileSync.mockImplementation((p) => {
    for (const key of fixtureKeys) {
      if (p.endsWith(fileMap[key])) return JSON.stringify(FIXTURES[key]);
    }
    return "{}";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupCIMocks();
});

// ═══════════════════════════════════════════════════════════════
// getDependencyContext()
// ═══════════════════════════════════════════════════════════════

describe("getDependencyContext()", () => {
  it("should return empty string when no CI data exists", () => {
    mockExistsSync.mockReturnValue(false);
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toBe("");
  });

  it("should return empty string when file is not in depGraph", () => {
    const result = getDependencyContext(CWD, "src/nonexistent.mjs");
    expect(result).toBe("");
  });

  it("should include warning header for a file with dependencies", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("改動影響分析");
    expect(result).toContain("src/utils.mjs");
  });

  it("should list who imports the file (importedBy)", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("誰依賴這個檔案");
    expect(result).toContain("src/routes/a.mjs");
    expect(result).toContain("src/routes/b.mjs");
  });

  it("should list what the file exports", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("export");
    expect(result).toContain("helperFn");
    expect(result).toContain("formatDate");
  });

  it("should list function callers from callGraph", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("誰呼叫了這個檔案");
    expect(result).toContain("helperFn");
    expect(result).toContain("doThing");
  });

  it("should list internal imports (what the file depends on)", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("依賴了誰");
    expect(result).toContain("src/types.mjs");
    expect(result).toContain("UserType");
    // External modules are included as-is (current behavior)
    expect(result).toContain("node:path");
  });

  it("should list related test files", () => {
    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("相關測試檔案");
    expect(result).toContain("tests/unit/utils.test.mjs");
  });

  it("should normalize absolute paths to relative", () => {
    const result = getDependencyContext(CWD, `${CWD}/src/utils.mjs`);
    expect(result).toContain("src/utils.mjs");
    expect(result).toContain("改動影響分析");
  });

  it("should strip leading slash from file paths", () => {
    const result = getDependencyContext(CWD, "/src/utils.mjs");
    expect(result).toContain("src/utils.mjs");
  });

  it("should truncate importedBy list when exceeding 20 items", () => {
    // Create fixture with 25 importedBy entries
    const manyDeps = Array.from({ length: 25 }, (_, i) => `src/file${i}.mjs`);
    mockReadFileSync.mockImplementation((p) => {
      if (p.endsWith("dependency-graph.json")) {
        return JSON.stringify({
          files: {
            "src/utils.mjs": {
              importedBy: manyDeps,
              exports: [],
              imports: [],
            },
          },
        });
      }
      if (p.endsWith("call-graph.json")) return JSON.stringify({ callersOf: {} });
      return "{}";
    });
    mockExistsSync.mockReturnValue(true);

    const result = getDependencyContext(CWD, "src/utils.mjs");
    expect(result).toContain("還有 5 個");
  });
});

// ═══════════════════════════════════════════════════════════════
// getAffectedTests()
// ═══════════════════════════════════════════════════════════════

describe("getAffectedTests()", () => {
  it("should return test files for changed source files", () => {
    const result = getAffectedTests(CWD, ["src/utils.mjs"]);
    expect(result).toContain("tests/unit/utils.test.mjs");
  });

  it("should return empty array when no test mapping exists", () => {
    const result = getAffectedTests(CWD, ["src/unmapped.mjs"]);
    expect(result).toEqual([]);
  });

  it("should collect tests from dependents of changed file", () => {
    // If src/utils.mjs changes, tests for its importers (src/routes/a.mjs) should run too
    const result = getAffectedTests(CWD, ["src/utils.mjs"]);
    expect(result).toContain("tests/unit/utils.test.mjs");
    expect(result).toContain("tests/unit/routes-a.test.mjs");
  });

  it("should deduplicate test files", () => {
    // Both direct and dependent mapping might return the same test
    const result = getAffectedTests(CWD, ["src/utils.mjs"]);
    const uniqueResults = [...new Set(result)];
    expect(result.length).toBe(uniqueResults.length);
  });

  it("should handle multiple changed files", () => {
    const result = getAffectedTests(CWD, ["src/utils.mjs", "src/routes/a.mjs"]);
    expect(result).toContain("tests/unit/utils.test.mjs");
    expect(result).toContain("tests/unit/routes-a.test.mjs");
  });

  it("should handle empty changedFiles array", () => {
    const result = getAffectedTests(CWD, []);
    expect(result).toEqual([]);
  });

  it("should normalize absolute paths", () => {
    const result = getAffectedTests(CWD, [`${CWD}/src/utils.mjs`]);
    expect(result).toContain("tests/unit/utils.test.mjs");
  });
});

// ═══════════════════════════════════════════════════════════════
// getImpactSummary()
// ═══════════════════════════════════════════════════════════════

describe("getImpactSummary()", () => {
  it("should return an object with importedBy, callers, and testFiles", () => {
    const result = getImpactSummary(CWD, "src/utils.mjs");
    expect(result).toHaveProperty("importedBy");
    expect(result).toHaveProperty("callers");
    expect(result).toHaveProperty("testFiles");
    expect(Array.isArray(result.importedBy)).toBe(true);
    expect(Array.isArray(result.callers)).toBe(true);
    expect(Array.isArray(result.testFiles)).toBe(true);
  });

  it("should return empty arrays when file not in CI data", () => {
    const result = getImpactSummary(CWD, "src/nonexistent.mjs");
    expect(result.importedBy).toEqual([]);
    expect(result.callers).toEqual([]);
    expect(result.testFiles).toEqual([]);
  });

  it("should return importedBy list from depGraph", () => {
    const result = getImpactSummary(CWD, "src/utils.mjs");
    expect(result.importedBy).toContain("src/routes/a.mjs");
    expect(result.importedBy).toContain("src/routes/b.mjs");
    expect(result.importedBy).toContain("src/index.mjs");
  });

  it("should return callers from callGraph with function names", () => {
    const result = getImpactSummary(CWD, "src/utils.mjs");
    const helperCallers = result.callers.find(c => c.func === "helperFn");
    expect(helperCallers).toBeDefined();
    expect(helperCallers.callers).toContain("src/routes/a.mjs:doThing");
  });

  it("should return testFiles from testCodeMap", () => {
    const result = getImpactSummary(CWD, "src/utils.mjs");
    expect(result.testFiles).toContain("tests/unit/utils.test.mjs");
  });

  it("should normalize absolute paths", () => {
    const result = getImpactSummary(CWD, `${CWD}/src/utils.mjs`);
    expect(result.importedBy.length).toBeGreaterThan(0);
  });

  it("should limit callers to 5 per function", () => {
    // Create fixture with a function that has 10 callers
    const manyCallers = Array.from({ length: 10 }, (_, i) => `src/caller${i}.mjs:fn${i}`);
    mockReadFileSync.mockImplementation((p) => {
      if (p.endsWith("call-graph.json")) {
        return JSON.stringify({
          callersOf: { "src/utils.mjs:popularFn": manyCallers },
        });
      }
      if (p.endsWith("dependency-graph.json")) {
        return JSON.stringify({ files: { "src/utils.mjs": { importedBy: [], exports: [], imports: [] } } });
      }
      return "{}";
    });
    mockExistsSync.mockReturnValue(true);

    const result = getImpactSummary(CWD, "src/utils.mjs");
    const popular = result.callers.find(c => c.func === "popularFn");
    expect(popular).toBeDefined();
    expect(popular.callers.length).toBe(5);
  });
});
