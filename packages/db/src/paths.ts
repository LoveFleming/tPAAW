import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Find the PAAW project root by walking up from this module's location
 * until we find a directory that contains `packages/` (the monorepo marker).
 *
 * Using import.meta.url (not process.cwd()) makes this robust regardless of
 * the current working directory (repo root, packages/db, or any other cwd)
 * and works cross-platform.
 */
export function getProjectRoot(): string {
  let dir = __dirname;
  // Walk up at most a handful of levels to avoid an unbounded loop.
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "packages"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Fallback: two levels up from packages/db/src → repo root.
  return resolve(__dirname, "../../..");
}

export function getDbPath(dbName: string = "paaw.sqlite"): string {
  return resolve(getProjectRoot(), "data/db", dbName);
}
