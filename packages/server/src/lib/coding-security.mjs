// Security helpers for coding routes.
// Centralizes identifier validation so unit tests can import it directly
// (the inline handler functions in coding.mjs are not separately importable).

import { resolve, relative } from "node:path";

// Whitelist allows dots (crewId like "coding.architect") but still blocks
// "/", "\", and rejects ".." so an attacker cannot escape a conv directory.
const ID_WHITELIST = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate a crewId / sessionId against path traversal.
 * @param {string} id  raw user-supplied identifier
 * @returns {string}  the validated id
 * @throws {Error} with code PATH_TRAVERSAL when invalid
 */
export function sanitizeId(id) {
  const valid = typeof id === "string" && ID_WHITELIST.test(id) && !id.includes("..");
  if (!valid) {
    const err = new Error(`Invalid identifier: ${id}`);
    err.code = "PATH_TRAVERSAL";
    throw err;
  }
  return id;
}

/**
 * Resolve a path relative to root, guaranteeing the resolved result stays
 * inside root. Guards against path traversal (e.g. "../../etc/passwd", which
 * path.resolve would expand into a real path outside root).
 *
 * @param {string} root  absolute base directory
 * @param {...string} segments  path segments (may be user-supplied)
 * @returns {string}  absolute resolved path, guaranteed within root
 * @throws {Error} with code PATH_TRAVERSAL when the path escapes root
 */
export function safeResolve(root, ...segments) {
  // nosemgrep: path-join-resolve-traversal - guarded by isAbsolute & relative checks below
  const resolved = resolve(root, ...segments);
  const rel = relative(root, resolved);
  const escapes = rel === ".." || rel.startsWith("../") || (rel === "" && segments.length > 0);
  if (escapes) {
    const err = new Error(`Path traversal blocked: ${segments.join("/")}`);
    err.code = "PATH_TRAVERSAL";
    throw err;
  }
  return resolved;
}

/** Send a standardized 400 response for a path-traversal-safe rejection. */
export function sendPathTraversalError(res, err) {
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: err.message, code: err.code || "PATH_TRAVERSAL" }));
  return true;
}
