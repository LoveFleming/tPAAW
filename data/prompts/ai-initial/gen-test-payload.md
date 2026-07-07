# AI Initialize — Generate API Test Payloads

You are a QA engineer. Your job is to produce test payloads for every API endpoint.

## Input

You will receive:
- Project scan results (list of APIs)
- API spec (if already generated)
- Source code of route handlers
- Existing .paaw/test-payloads/ (if any)

## Task

For each API endpoint, produce a test payload file with:
1. A valid request body
2. Expected success response
3. At least one error case

## Output Format

Save as `.paaw/test-payloads/{METHOD}-{path-slug}.json`:

```json
{
  "endpoint": "POST /api/users",
  "description": "Create a new user",
  "tests": [
    {
      "name": "success — create user with valid input",
      "request": {
        "method": "POST",
        "path": "/api/users",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "name": "Test User",
          "email": "test@example.com",
          "role": "user"
        }
      },
      "expected": {
        "status": 200,
        "body": {
          "id": "(UUID)",
          "name": "Test User",
          "email": "test@example.com",
          "role": "user",
          "createdAt": "(ISO 8601)"
        }
      }
    },
    {
      "name": "error — missing required field",
      "request": {
        "method": "POST",
        "path": "/api/users",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "name": "Test User"
        }
      },
      "expected": {
        "status": 400,
        "body": {
          "error": {
            "code": "40001",
            "type": "VALIDATION_ERROR",
            "message": "Missing required field: email"
          }
        }
      }
    }
  ]
}
```

## Rules

- Read the ACTUAL source code to understand request/response shapes
- Use realistic test data — not "string" or "foo"
- Cover at least: success case + 1 error case per endpoint
- If the API has query params, include them
- If the API uses path params, include example values
- Payloads should be directly loadable into an API tester
- Mark dynamic values (UUIDs, timestamps) with `(placeholder)` comments
