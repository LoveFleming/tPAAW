# Route Handlers - Detailed Patterns & Export Contract

This reference covers Next.js 16 Route Handler patterns and — critically — the
**export contract** that every `route.ts` must satisfy. The companion template
`templates/route-handler-api.ts` gathers 10 worked examples; this document
explains how to read, copy, and verify them. For basic usage, see the main
`SKILL.md` § Route Handlers.

---

## The Export Contract (read this before copying anything)

A single `app/api/[...]/route.ts` file may export **only HTTP method names**,
and **each method at most once**:

```text
GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
```

| Violation | Symptom |
|---|---|
| Export a non-method name (e.g. `export async function login`) | Next.js ignores it → endpoint returns **405 Method Not Allowed** |
| Export the same method twice (e.g. two `GET` exports) | **Compile-time failure** — duplicate export |
| Export helpers/types from route.ts | Ignored or compile error; helpers must live in a separate module |

> **Real-world case (TASK-166)**: the template once exported 13 handlers where
> 9 used non-method names (`login`, `getCurrentUser`, `createPost`, …) and `GET`
> appeared twice. The whole file failed to compile and, where it did compile,
> copied handlers silently 405'd. Fixed in commit `3bae7275`; the template now
> demonstrates the correct convention and the test suite locks it in.

### How the template satisfies the contract while showing 10 examples

Each example in `templates/route-handler-api.ts` belongs to a **different**
route file (see the `File:` comment above every example). Because the template
itself must stay a valid, compilable `route.ts`, **only the first handler of a
given method carries `export`**:

- Exported in the template: `GET`, `POST` (Example 1), `PATCH`, `DELETE`
  (Example 2), `OPTIONS` (Example 8).
- Shown as plain functions: `getPostById`, `searchPosts`, `login`,
  `getCurrentUser`, `sseStream`, `handleUpload`, `errorProneRoute`,
  `rateLimitedRoute`, plus the second `GET` in Example 8 (CORS).

**When you copy one of those into your own route file**: add the `export`
keyword and name it with the HTTP method noted in its comment (e.g. copy
`login` into `app/api/auth/login/route.ts` and rename/export it as `POST`).

---

## Handler Pattern Catalog

| # | Pattern | Method(s) | Route file | Key API |
|---|---|---|---|---|
| 1 | Basic CRUD | GET, POST | `app/api/posts/route.ts` | `NextResponse.json()`, `r.ok` check, 400/201/502 |
| 2 | Dynamic routes | GET, PATCH, DELETE | `app/api/posts/[id]/route.ts` | `await params` (Promise in Next.js 16), 404 |
| 3 | Search / query params | GET | `app/api/search/route.ts` | `new URL(request.url).searchParams`, `URLSearchParams` encoding, numeric validation |
| 4 | Auth with cookies | POST, GET | `app/api/auth/login`, `app/api/auth/me` | `await cookies()`, `response.cookies.set()` with httpOnly/secure/sameSite, 401 |
| 5 | Webhook (signature verified) | POST | `app/api/webhooks/stripe/route.ts` | raw body via `await request.text()`, HMAC signature check, 400/401 |
| 6 | Streaming (SSE) | GET | `app/api/stream/route.ts` | `ReadableStream`, `TextEncoder`, `data: …\n\n` framing |
| 7 | File upload | POST | `app/api/upload/route.ts` | `await request.formData()`, filename sanitization (`basename`), size cap |
| 8 | CORS | GET + OPTIONS | `app/api/public/route.ts` | explicit origin allowlist, preflight `OPTIONS`, `Access-Control-Allow-*` headers |
| 9 | Error handling | GET | `app/api/flaky/route.ts` | try/catch → 500, upstream `r.ok` check → 502, structured `{ error }` body |
| 10 | Rate limiting | GET | `app/api/limited/route.ts` | in-memory Map store, prune expired entries, 429 + `Retry-After` |

### Status-code conventions used across the template

- `200` success (default), `201` created
- `400` invalid input (missing fields, bad JSON, failed validation)
- `401` unauthenticated (missing/expired token), `403` unauthorized
- `404` resource not found, `405` method not exported (see Export Contract)
- `429` rate limited (with `Retry-After`)
- `500` unexpected error, `502` upstream API failure

---

## Copying Examples Correctly

1. Find the `File:` comment above the example — it names the destination route
   file (e.g. `app/api/posts/[id]/route.ts`).
2. Copy **only that handler** (plus its needed imports) into the destination.
3. Rename the function to the HTTP method and add `export`:

```typescript
// ❌ Copied verbatim from the template — will 405
async function login(request: Request) { … }

// ✅ Correct: method name + export, in app/api/auth/login/route.ts
export async function POST(request: Request) { … }
```

4. If you need helpers, put them in a plain module (`lib/…ts`) and import —
   never export them from `route.ts`.
5. Never place two handlers for the same method in one file; split into
   separate route files as the template's `File:` comments indicate.

---

## Verifying with the Test Suite

The template is a **teaching asset, not runtime code**, so the PAAW repository
locks it with a dedicated template-verification test:

```bash
npx vitest run tests/unit/route-handler-api-template.test.mjs
```

The suite (46 tests) enforces the contract in three layers:

1. **Static contract scan** — asserts the template only exports legal HTTP
   method names, each exactly once; awaits `params`/`cookies()`/`headers()`;
   and keeps the behaviors the template claims (validation, `r.ok` checks,
   rate-limit pruning). Regression-locks every defect QA found in the
   TASK-166 round: reintroduce a non-method export or a duplicate `GET` and
   the suite fails.
2. **Behavioral verification** — minimal executable recreations of the
   demonstrated semantics (200/201/400/401/404/429/500 paths) with a stubbed
   upstream `fetch`.
3. **Real compile check** — compiles the whole template with the project's
   TypeScript compiler (strict, noEmit, `next/server` + `next/headers` type
   stubs), and snapshots the exact set of top-level exports via AST — so any
   drift in exported symbols fails loudly.

When you modify the template (or copy patterns into a real app), re-run this
suite in the PAAW repo to confirm the contract still holds.

---

## Related

- `SKILL.md` § Route Handlers — basic usage and async params
- `templates/route-handler-api.ts` — the 10 worked examples
- `references/error-catalog.md` § Error 19 — diagnosing 405 / duplicate-export
  failures caused by invalid route.ts exports
- `references/server-actions-patterns.md` — mutations that don't need a route
  handler at all (prefer Server Actions for form-driven writes)
