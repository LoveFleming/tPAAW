import { resolve } from "path";

/**
 * Get the tAgent project root path.
 * Works regardless of whether running via tsx, node, or pnpm.
 */
export function getProjectRoot(): string {
  // From packages/db/ (cwd when run via pnpm), ../../ = root
  // From root (fallback), . = root
  const fromCwd = resolve(process.cwd(), "../../");
  return fromCwd;
}

export function getDbPath(dbName: string = "tagent.sqlite"): string {
  return resolve(getProjectRoot(), "data/db", dbName);
}
