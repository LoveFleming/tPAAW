/**
 * stableStringify — deterministic JSON (object keys recursively sorted, arrays keep order).
 * Use for cache keys / dedupe / equality instead of JSON.stringify.
 */
export function stableStringify(value: unknown): string | undefined {
    return JSON.stringify(value, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.keys(v as Record<string, unknown>)
                  .sort()
                  .reduce<Record<string, unknown>>((acc, key) => {
                      acc[key] = (v as Record<string, unknown>)[key]; // nosemgrep: no-stringify-keys — stable-stringify helper 本體實作
                      return acc;
                  }, {})
            : v
    );
}
