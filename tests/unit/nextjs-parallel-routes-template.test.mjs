/**
 * Unit tests — Next.js 16 Parallel Routes skill template (F20261016-004)
 *
 * Target (read-only fixture, NOT imported):
 *   data/skills/physical-skill/nextjs-backend-best-practices/templates/parallel-routes-with-default.tsx
 *
 * This is a *teaching template*, not runnable app code: it has no Next.js runtime
 * installed in this repo, it deliberately packs 6+ examples (each owning its own
 * `export default`) into one file, and it declares parallel-route slots that only
 * exist as a directory convention (`app/@modal/default.tsx`). Importing it would
 * fail; mocking the whole Next.js App Router runtime would test the mocks, not the
 * template. So — exactly like the sibling tests for F20261016-001 / F20261016-003 —
 * we verify the template as a *contract*: it must demonstrate the correct Next.js 16
 * parallel-route patterns, comprehensively, and must NOT present wrong patterns as
 * positive examples. That "authoritative, copy-pasteable reference" property IS the
 * template's product behaviour.
 *
 * QA review (qr-20261017-000819-hsib, TASK-047 gate 1) returned ❌ FAIL with
 * 2 critical + 5 major + 3 minor findings. Those defects are NOT fixed yet and
 * fixing them is Developer (Priya) scope, NOT this test task. They are recorded
 * below as explicit `it.todo(...)` entries so the suite stays green while every
 * gap remains visible and traceable. When Developer fixes one, promote it to a
 * real assertion. Tests that assert *current correct behaviour* are green; tests
 * for *known-open defects* are todos — no assertion was weakened to hide a bug.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(
  __dirname,
  "../../data/skills/physical-skill/nextjs-backend-best-practices/templates/parallel-routes-with-default.tsx"
);

let raw;
let codeOnly; // raw with /* block comment */ and // line comments stripped

beforeAll(() => {
  raw = readFileSync(TEMPLATE_PATH, "utf8");
  // Strip block comments first, then line comments → live (non-commented) source only.
  codeOnly = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
});

describe("parallel routes template — file exists and is well-formed", () => {
  it("reads the template file", () => {
    expect(raw.length).toBeGreaterThan(0);
  });

  it("has the teaching header about Parallel Routes + required default.js", () => {
    expect(raw).toMatch(/Next\.js 16 - Parallel Routes with Required default\.js/);
  });

  it("documents the breaking change (default files now required)", () => {
    expect(raw).toMatch(/REQUIRED/);
    expect(raw).toMatch(/BREAKING CHANGE/);
  });

  it("shows the app/ directory structure with @slot folders", () => {
    expect(raw).toMatch(/app\//);
    expect(raw).toMatch(/@modal\//);
  });
});

describe("core contract — every @slot demonstrates a default fallback", () => {
  // The template's whole point: parallel-route slots MUST ship a default.tsx.
  it("declares the modal slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ModalDefault/);
  });

  it("declares the analytics slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+AnalyticsDefault/);
  });

  it("declares the notifications slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+NotificationsDefault/);
  });

  it("declares the activity slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ActivityDefault/);
  });

  it("declares the reviews slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+ReviewsDefault/);
  });

  it("declares the recommendations slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+RecommendationsDefault/);
  });

  it("declares the auth slot default component (async, cookie-gated)", () => {
    expect(codeOnly).toMatch(/export\s+default\s+async\s+function\s+AuthDefault/);
  });

  it("declares the banner slot default component", () => {
    expect(codeOnly).toMatch(/export\s+default\s+function\s+BannerDefault/);
  });

  it("marks each default.tsx as REQUIRED in the accompanying comments", () => {
    const requiredMarkers = raw.match(/default\.tsx\s*\(REQUIRED\)/g) || [];
    // one per slot shown: modal, analytics, notifications, activity, reviews,
    // recommendations, auth, banner
    expect(requiredMarkers.length).toBeGreaterThanOrEqual(8);
  });
});

describe("slot layout contracts — layouts receive the named slots as props", () => {
  it("root layout (Example 1) receives children + modal slot", () => {
    expect(codeOnly).toMatch(
      /function\s+RootLayout\(\s*\{\s*children,\s*modal,?\s*\}/
    );
  });

  it("dashboard layout (Example 2) receives children + analytics + notifications + activity", () => {
    expect(codeOnly).toMatch(
      /function\s+DashboardLayout\(\s*\{\s*children,\s*analytics,\s*notifications,\s*activity,?\s*\}/
    );
  });

  it("product layout (Example 3) receives children + reviews + recommendations", () => {
    expect(codeOnly).toMatch(
      /function\s+ProductLayout\(\s*\{\s*children,\s*reviews,\s*recommendations,?\s*\}/
    );
  });

  it("banner layout (Example 5) receives children + banner", () => {
    expect(codeOnly).toMatch(/function\s+Layout\(\s*\{\s*children,\s*banner,?\s*\}/);
  });

  it("types every slot prop as React.ReactNode", () => {
    // spot-check a representative set of declared slot props
    for (const slot of ["modal", "analytics", "notifications", "activity", "reviews", "recommendations", "banner"]) {
      expect(codeOnly).toMatch(new RegExp(`${slot}:\\s*React\\.ReactNode`));
    }
  });

  it("renders the slots inside the layout JSX (modal before main; analytics inside main)", () => {
    expect(codeOnly).toMatch(/\{modal\}/);
    expect(codeOnly).toMatch(/\{children\}/);
    expect(codeOnly).toMatch(/\{analytics\}/);
  });
});

describe("default fallback behaviour is demonstrated (the four documented patterns)", () => {
  it("Pattern 1 — null default (no UI shown)", () => {
    expect(codeOnly).toMatch(/export\s+function\s+DefaultNull\(\)\s*\{\s*return\s+null/);
  });

  it("Pattern 2 — skeleton default", () => {
    expect(codeOnly).toMatch(/export\s+function\s+DefaultSkeleton\(\)/);
    expect(codeOnly).toMatch(/skeleton-line/);
  });

  it("Pattern 3 — fallback message default", () => {
    expect(codeOnly).toMatch(/export\s+function\s+DefaultFallback\(\)/);
    expect(codeOnly).toMatch(/Content not available/);
  });

  it("Pattern 4 — redirect default", () => {
    expect(codeOnly).toMatch(/export\s+function\s+DefaultRedirect\(\)\s*\{\s*redirect\(/);
  });

  it("the most common slot default returns null (modal + banner)", () => {
    expect(codeOnly).toMatch(/function\s+ModalDefault\(\)\s*\{\s*return\s+null/);
    expect(codeOnly).toMatch(/function\s+BannerDefault\(\)\s*\{\s*return\s+null/);
  });

  it("documents what default.tsx may return (null / skeleton / redirect / fallback)", () => {
    expect(raw).toMatch(/What should default\.tsx return\?/);
    expect(raw).toMatch(/return null/);
    expect(raw).toMatch(/redirect\(\)/);
  });
});

describe("Next.js 16 async params contract inside slots", () => {
  it("reviews slot page types params as Promise and awaits it", () => {
    expect(codeOnly).toMatch(/params:\s*Promise<\{\s*id:\s*string\s*\}>/);
    expect(codeOnly).toMatch(/const\s*\{\s*id\s*\}\s*=\s*await\s+params/);
  });

  it("auth slot default awaits cookies() from next/headers", () => {
    expect(codeOnly).toMatch(/await\s+cookies\(\)/);
    expect(codeOnly).toMatch(/from\s+['"]next\/headers['"]/);
  });

  it("auth gate redirects to /login when unauthenticated", () => {
    expect(codeOnly).toMatch(/redirect\(['"]\/login['"]\)/);
    expect(codeOnly).toMatch(/from\s+['"]next\/navigation['"]/);
  });
});

describe("coverage — all exported teaching examples are present", () => {
  const examples = [
    "RootLayout",
    "LoginModal",
    "HomePage",
    "DashboardLayout",
    "AnalyticsOverview",
    "ProductLayout",
    "ProductReviews",
    "ProfilePage",
    "Layout",
    "SaleBanner",
    "AnalyticsLoading",
    "NotificationsLoading",
    "AnalyticsError",
  ];
  for (const name of examples) {
    it(`exports ${name}`, () => {
      expect(codeOnly).toMatch(new RegExp(`export\\s+(default\\s+)?(async\\s+)?function\\s+${name}`));
    });
  }
});

describe("loading.tsx and error.tsx variants are demonstrated", () => {
  it("shows a loading.tsx for the analytics slot", () => {
    expect(raw).toMatch(/@analytics\/loading\.tsx/);
    expect(codeOnly).toMatch(/function\s+AnalyticsLoading\(\)/);
  });

  it("shows a loading.tsx for the notifications slot", () => {
    expect(raw).toMatch(/@notifications\/loading\.tsx/);
    expect(codeOnly).toMatch(/function\s+NotificationsLoading\(\)/);
  });

  it("shows an error.tsx boundary with error + reset props", () => {
    expect(raw).toMatch(/@analytics\/error\.tsx/);
    expect(codeOnly).toMatch(/error:\s*Error/);
    expect(codeOnly).toMatch(/reset:\s*\(\)\s*=>\s*void/);
  });

  it("error boundary is interactive — reset wired to a button onClick", () => {
    expect(codeOnly).toMatch(/onClick=\{reset\}/);
  });
});

describe("migration guide facts are documented (Next.js 15 → 16)", () => {
  it("contrasts BEFORE (Next.js 15) vs AFTER (Next.js 16)", () => {
    expect(raw).toMatch(/BEFORE \(Next\.js 15\)/);
    expect(raw).toMatch(/AFTER \(Next\.js 16\)/);
  });

  it("explains WHY default files became required", () => {
    expect(raw).toMatch(/Why the change\?/);
  });

  it("summarises the 5 parallel-route rules (incl. default.tsx requirement)", () => {
    expect(raw).toMatch(/MUST include default\.tsx for each @folder/);
    expect(raw).toMatch(/Use @folder convention for parallel slots/);
  });
});

describe("QA review gate 1 — open defects tracked as todos (Developer scope, not this task)", () => {
  // Source: qr-20261017-000819-hsib (qa review, verdict FAIL, all issues open).
  // These MUST stay visible: they are the reason the template is not yet a fully
  // trustworthy "authoritative reference". Promote each todo to a real assertion
  // once Developer fixes it.
  it.todo(
    "[QA critical] L3-6 header + L337-360 migration guide state default.tsx is needed during SOFT navigation — official docs say it is needed on HARD navigation (full-page load) when the slot's active state cannot be recovered. Trigger condition is inverted."
  );
  it.todo(
    "[QA critical] 'use client' (Example 7, ~L303) sits mid-file, not at the top — in a real .tsx it would not take effect / would wrongly turn earlier server components into a client boundary. Not copy-pasteable as-is."
  );
  it.todo(
    "[QA major] imports placed mid-file: L267-268 (next/headers, next/navigation) and L390 (next/navigation imported a second time). Violates ESM conventions; copy-paste breaks compilation."
  );
  it.todo(
    "[QA major] filename vs body mismatch: file is .tsx but header/structure/migration guide repeatedly say default.js (L3, L11, L14, L337, L347, L352)."
  );
  it.todo(
    "[QA major] missing children implicit-slot coverage: official docs require a default.tsx for the `children` slot too, otherwise refresh yields a 404 — not demonstrated anywhere."
  );
  it.todo(
    "[QA major] params/type inconsistency: Example 3 ProductLayout omits params; Example 4 ProfilePage does not type/await params and fetches with a possibly-undefined userId."
  );
  it.todo(
    "[QA major] no minimal runnable skeleton: no @slot layout.tsx (Example 1 only shows root layout) and no full @slot directory tree."
  );
  it.todo(
    "[QA minor] fetch calls (Example 2 ~L172, Example 3 ~L231) do not check r.ok / handle non-2xx or network errors."
  );
  it.todo(
    "[QA minor] naming/organisation: Example 5 `Layout` vs Example 1 `RootLayout` both claim 'File: app/layout.tsx'; Common Patterns helpers (DefaultNull/Skeleton/Fallback/Redirect) are named exports, but a real default.tsx needs a default export."
  );
  it.todo(
    "[QA minor] header lacks an example index (Example 1..7 → file path) for a 400+ line file."
  );
});
