/**
 * Unit tests — Next.js 16 "use cache" directive skill template (F20261016-003)
 *
 * Target (read-only fixture, NOT imported):
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/cache-component-use-cache.tsx
 *
 * This is a *teaching template*, not runnable app code: it depends on the
 * Next.js runtime (next/cache, next/headers) and deliberately packs several
 * examples (each with its own `export default`) into one file, so importing it
 * would fail. We therefore verify the template as a *contract*: it must
 * demonstrate the correct Next.js 16 caching patterns and must NOT present
 * obsolete / misleading patterns as positive examples.
 *
 * These assertions lock in the QA fixes for TASK-046 (qr-20261017-000502-irzh):
 *   C1  — "use cache" placed inside each function body (not file-level), so
 *         examples that claim "NOT cached" are genuinely not cached.
 *   M2  — fetch() is NOT cached by default (opt-in since Next.js 15).
 *   M3  — generateStaticParams is not cache-tagged; dangerouslySetInnerHTML
 *         carries an XSS/sanitize warning.
 *   m1  — Example 4 cross-file narrative matches placement.
 *   m4  — cacheTag()/cacheLife() are demonstrated.
 * NOTE on M1: QA flagged revalidateTag(tag, profile) as a misuse, but the
 * official Next.js 16 docs make the two-argument form the *required* signature
 * (single-argument is deprecated). The template keeps the correct 2-arg form,
 * so these tests assert the 2-arg usage is present and documented.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(
  __dirname,
  "../../data/skills/physical-skill/nextjs-backend-best-practices/templates/cache-component-use-cache.tsx"
);

let raw;
let codeOnly; // raw with block + line comments stripped → live source only

beforeAll(() => {
  raw = readFileSync(TEMPLATE_PATH, "utf8");
  codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
});

describe("use cache template — file exists and is well-formed", () => {
  it("reads the template file", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("has the teaching header describing the directive", () => {
    expect(raw).toMatch(/Next\.js 16 - Cache Components with "use cache"/);
    expect(raw).toMatch(/Explicit opt-in caching with "use cache"/);
  });
});

describe("C1 — 'use cache' lives inside function/component bodies", () => {
  it("every 'use cache' directive is immediately followed by an indented line (i.e. inside a block, not at column 0)", () => {
    const lines = codeOnly.split("\n");
    const directiveLines = lines.filter((l) => l.trim() === "'use cache'");
    expect(directiveLines.length).toBeGreaterThan(0);
    // A file-level directive sits at column 0; an in-body directive is indented.
    // The regex `/^\s+'use cache'\s*$/` tolerates trailing spaces left behind after stripping inline
    // comments (e.g. `'use cache' // Cache only this function...`).
    for (const l of directiveLines) {
      expect(l).toMatch(/^\s+'use cache'\s*$/);
    }
  });

  it("no file-level (column 0) 'use cache' directive remains in live code", () => {
    expect(codeOnly).not.toMatch(/^'use cache'/m);
  });

  it("the cached component declares 'use cache' as its first statement", () => {
    expect(codeOnly).toMatch(
      /export async function CachedProductList\(\)\s*\{\s*'use cache'/
    );
  });

  it("Example 5 caches only getPopularPosts (directive inside that function)", () => {
    expect(codeOnly).toMatch(
      /export async function getPopularPosts\(\)\s*\{\s*'use cache'/
    );
    // getRealtimeMetrics must NOT be followed by a 'use cache' body
    expect(codeOnly).not.toMatch(
      /export async function getRealtimeMetrics\(\)\s*\{\s*'use cache'/
    );
  });
});

describe("M2 — fetch caching is documented as opt-in (not default)", () => {
  it("does NOT claim fetch() is cached by default", () => {
    expect(raw).not.toMatch(/fetch\(\)\s*calls:\s*Cached by default/i);
  });

  it("documents that fetch is NOT cached by default / opt-in", () => {
    expect(raw).toMatch(/NOT cached by default/i);
    expect(raw).toMatch(/OPT-IN/i);
  });

  it("mentions the cache: 'force-cache' escape hatch and the Next.js 15 change", () => {
    expect(raw).toMatch(/force-cache/);
    expect(raw).toMatch(/Next\.js 15 removed the implicit fetch cache/i);
  });
});

describe("M3 — page example & XSS guard", () => {
  it("does NOT put a file-level 'use cache' above generateStaticParams", () => {
    expect(codeOnly).not.toMatch(/'use cache'\s*\n\s*export async function generateStaticParams/);
  });

  it("warns that generateStaticParams is build-time and must not be cache-tagged", () => {
    expect(raw).toMatch(/generateStaticParams runs at BUILD time/i);
    expect(raw).toMatch(/do NOT add "use cache" here/i);
  });

  it("carries an XSS/sanitize warning next to dangerouslySetInnerHTML", () => {
    expect(raw).toMatch(/dangerouslySetInnerHTML/);
    expect(raw).toMatch(/SECURITY/);
    expect(raw).toMatch(/sanitize/i);
  });
});

describe("m1 — Example 4 cross-file narrative matches placement", () => {
  it("explains the dynamic component is shown inline but lives in its own file", () => {
    expect(raw).toMatch(/components\/dynamic-user-info\.tsx/);
    expect(raw).toMatch(/shown inline here for readability/i);
  });
});

describe("m4 — cacheTag() / cacheLife() are demonstrated", () => {
  it("imports cacheTag and cacheLife from next/cache", () => {
    expect(codeOnly).toMatch(/from\s+['"]next\/cache['"]/);
    expect(raw).toMatch(/cacheTag/);
    expect(raw).toMatch(/cacheLife/);
  });

  it("calls cacheTag('posts') inside a cached scope", () => {
    expect(codeOnly).toMatch(/cacheTag\(['"]posts['"]\)/);
  });

  it("calls cacheLife with a profile inside a cached scope", () => {
    expect(codeOnly).toMatch(/cacheLife\(['"][a-z]+['"]\)/);
  });

  it("summary documents cacheTag and cacheLife APIs", () => {
    expect(raw).toMatch(/cacheTag\('tag'\)/);
    expect(raw).toMatch(/cacheLife\(/);
  });
});

describe("M1 (documented) — revalidateTag uses the required 2-argument form", () => {
  it("calls revalidateTag with a tag AND a profile", () => {
    expect(codeOnly).toMatch(/revalidateTag\(\s*['"][\w-]+['"]\s*,\s*['"][\w-]+['"]\s*\)/);
  });

  it("documents that the 2-arg form is required and single-arg is deprecated", () => {
    expect(raw).toMatch(/TWO-argument form/i);
    expect(raw).toMatch(/single-arg form is deprecated/i);
  });
});

describe("coverage — all exported teaching examples remain present", () => {
  const exports = [
    "CachedProductList",
    "getExpensiveData",
    "ProductPage",
    "generateStaticParams",
    "getPopularPosts",
    "getRealtimeMetrics",
    "Dashboard",
    "createPost",
    "getPosts",
    "getContent",
    "MixedCachingComponent",
  ];
  for (const name of exports) {
    it(`exports ${name}`, () => {
      expect(codeOnly).toMatch(new RegExp(`export\\s+async\\s+function\\s+${name}`));
    });
  }
});

describe("Example 8 — inline 'use cache' stays inline (granular control)", () => {
  it("keeps an inline 'use cache' inside an IIFE", () => {
    expect(codeOnly).toMatch(/async function\(\)\s*\{\s*'use cache'/);
  });

  it("comments that the sibling fetch is NOT cached", () => {
    expect(raw).toMatch(/This function call is NOT cached/);
  });
});
