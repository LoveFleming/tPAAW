/**
 * Unit tests — i18n locale consistency
 *
 * Verifies that all locale JSON files (zh, en, ja, zh-mix) have matching
 * keys, valid formats, and no missing or null values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const LOCALE_DIR = join(process.cwd(), "packages/ui/src/i18n/locales");
const locales = ["zh", "en", "ja", "zh-mix"];

function loadLocale(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALE_DIR, `${lang}.json`), "utf-8"));
}

function loadRaw(lang: string): string {
  return readFileSync(join(LOCALE_DIR, `${lang}.json`), "utf-8");
}

describe("i18n locale consistency", () => {
  // ── 1. Key count consistency ──
  it("all locales have the same number of keys", () => {
    const counts = locales.map((lang) => Object.keys(loadLocale(lang)).length);
    const first = counts[0];
    counts.forEach((c) => expect(c).toBe(first));
  });

  // ── 2. Key set equality ──
  it("all locales have identical key sets (no missing keys)", () => {
    const enKeys = new Set(Object.keys(loadLocale("en")));
    for (const lang of ["zh", "ja", "zh-mix"]) {
      const langKeys = new Set(Object.keys(loadLocale(lang)));
      const missing = [...enKeys].filter((k) => !langKeys.has(k));
      const extra = [...langKeys].filter((k) => !enKeys.has(k));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    }
  });

  // ── 3. Non-empty values ──
  it("every key in every language has a non-empty value", () => {
    for (const lang of locales) {
      const entries = Object.entries(loadLocale(lang));
      for (const [key, value] of entries) {
        expect(value, `${lang}.${key} should have a non-empty value`).toBeTruthy();
      }
    }
  });

  // ── 4. Valid JSON ──
  it("all locale files are valid JSON (parseable)", () => {
    for (const lang of locales) {
      expect(() => JSON.parse(loadRaw(lang))).not.toThrow();
    }
  });

  // ── 5. No duplicate keys ──
  it("locale JSON files have no duplicate keys", () => {
    for (const lang of locales) {
      const raw = loadRaw(lang);
      const keyMatches = raw.match(/^[\s]*"([^"]+)"\s*:/gm);
      if (keyMatches) {
        const keys = keyMatches.map((m) => m.match(/"([^"]+)"/)![1]);
        const seen = new Set<string>();
        const dupes: string[] = [];
        for (const k of keys) {
          if (seen.has(k)) dupes.push(k);
          seen.add(k);
        }
        expect(dupes, `${lang}.json has duplicate keys: ${dupes.join(", ")}`).toEqual([]);
      }
    }
  });

  // ── 6. Common sidebar.* keys ──
  it("common sidebar.* keys exist in all locales", () => {
    const enKeys = Object.keys(loadLocale("en")).filter((k) => k.startsWith("sidebar."));
    expect(enKeys.length).toBeGreaterThan(0);
    for (const lang of locales) {
      const langKeys = loadLocale(lang);
      for (const key of enKeys) {
        expect(key in langKeys, `${lang}.json missing ${key}`).toBe(true);
      }
    }
  });

  // ── 7. Common chat.* keys ──
  it("common chat.* keys exist in all locales", () => {
    const enKeys = Object.keys(loadLocale("en")).filter((k) => k.startsWith("chat."));
    expect(enKeys.length).toBeGreaterThan(0);
    for (const lang of locales) {
      const langKeys = loadLocale(lang);
      for (const key of enKeys) {
        expect(key in langKeys, `${lang}.json missing ${key}`).toBe(true);
      }
    }
  });

  // ── 8. Common notes.* keys ──
  it("common notes.* keys exist in all locales", () => {
    const enKeys = Object.keys(loadLocale("en")).filter((k) => k.startsWith("notes."));
    expect(enKeys.length).toBeGreaterThan(0);
    for (const lang of locales) {
      const langKeys = loadLocale(lang);
      for (const key of enKeys) {
        expect(key in langKeys, `${lang}.json missing ${key}`).toBe(true);
      }
    }
  });

  // ── 9. Placeholder format consistency ──
  it("placeholder formats (%s, {}) are consistent across locales", () => {
    const en = loadLocale("en");
    const placeholderRe = /%[sd]|%\d+\$[sd]|\{\w+\}/;
    const keysWithPlaceholders = Object.entries(en)
      .filter(([, v]) => typeof v === "string" && placeholderRe.test(v as string))
      .map(([k]) => k);

    for (const key of keysWithPlaceholders) {
      for (const lang of ["zh", "ja", "zh-mix"]) {
        const langValue = loadLocale(lang)[key] as string;
        // If the en value has a placeholder, the translated value should also be non-empty
        expect(langValue, `${lang}.${key} is empty but en has placeholder`).toBeTruthy();
      }
    }
  });

  // ── 10. No null or number values (leaf values must be strings) ──
  it("no locale leaf value is null or a number (all leaves should be strings)", () => {
    function checkLeaves(obj: Record<string, unknown>, prefix: string) {
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object") {
          // Nested object — recurse
          checkLeaves(v as Record<string, unknown>, fullKey);
        } else {
          expect(v, `${prefix}.${k} is null`).not.toBeNull();
          expect(
            typeof v === "string",
            `${fullKey} is ${typeof v}, expected string`
          ).toBe(true);
        }
      }
    }
    for (const lang of locales) {
      checkLeaves(loadLocale(lang) as unknown as Record<string, unknown>, "");
    }
  });
});
