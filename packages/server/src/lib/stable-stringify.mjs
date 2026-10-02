import fs from 'node:fs';
// stableStringify — deterministic JSON (sorted object keys) for cache keys / dedupe / equality
export function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v).sort().reduce((acc, key) => { acc[key] = v[key]; return acc; }, {})
    : v));
}
