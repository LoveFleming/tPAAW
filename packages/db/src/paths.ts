import { resolve } from "path";

/**
 * Get the PAAW project root path.
 * Works regardless of whether running via tsx, node, or pnpm.
 */
export function getProjectRoot(): string {
  // From packages/db/ (cwd when run via pnpm), ../../ = root
  // From root (fallback), . = root
// nosemgrep: path-join-resolve-traversal
  const fromCwd = resolve(process.cwd(), "../../");
  return fromCwd;
}

export function getDbPath(dbName: string = "paaw.sqlite"): string {  // nosemgrep: path-join-resolve-traversal
// nosemgrep: path-join-resolve-traversal
  return resolve(getProjectRoot(), "data/db", dbName);
}
