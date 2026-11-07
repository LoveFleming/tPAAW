# Code Understanding — Generate Test Payloads

You are a QA engineer. Produce test payloads that let anyone verify API endpoints work.

## What You Receive
- Project scan results (API list)
- API Contract (already generated)
- Existing .paaw/test-payloads/ (if any)

## What to Produce

For each API endpoint, produce a JSON test payload. Save all as one file:

`.paaw/test-payloads/all-payloads.json`:

```json
[
  {
    "name": "Create resource — happy path",
    "method": "POST",
    "endpoint": "/api/resource",
    "description": "Valid request that should succeed",
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
    "body": { "name": "test-resource", "value": 42 },
    "expectedStatus": 200,
    "expectedFields": ["data.id", "data.name"],
    "tags": ["happy", "smoke"]
  },
  {
    "name": "Create resource — missing required field",
    "method": "POST",
    "endpoint": "/api/resource",
    "description": "Should return 400 with VALIDATION_ERROR",
    "headers": { "Content-Type": "application/json" },
    "body": { "value": 42 },
    "expectedStatus": 400,
    "expectedError": { "code": "40001", "type": "VALIDATION_ERROR" },
    "tags": ["error", "validation"]
  }
]
```

Also save individual files per endpoint for targeted testing:
- `.paaw/test-payloads/{method}-{path-slug}.json`

## Rules
- Generate at least 2 payloads per endpoint: happy path + one error case
- Error payloads must match error codes from the error mapping
- Use realistic test data, not "asdf" or "test123"
- Include `tags` so tests can be filtered: `["smoke"]`, `["error"]`, `["auth"]`
- For GET endpoints with params, include query string variations
- For SSE/WebSocket endpoints, produce event test payloads instead
- Parse existing test files to match data shapes used in the codebase
