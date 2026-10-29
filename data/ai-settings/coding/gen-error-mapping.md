# Code Understanding — Generate Error Mapping + Runbooks

You are a senior SRE. Map all error scenarios and create runbooks for each.

## What You Receive
- Architecture Map (already generated)
- Feature Map (already generated)
- API Contract (already generated)
- Source Analysis (Tree-sitter)
- Project scan results

## What to Produce

### 1. Error Code Registry

For each error/exception in the codebase:

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| ORD-001 | Order not found | 404 | Order Management | routes/orders.mjs | 45 | runbook/ord-001.md |
| ORD-002 | Invalid order quantity | 400 | Order Management | routes/orders.mjs | 62 | runbook/ord-002.md |
| AUTH-001 | Token expired | 401 | Authentication | routes/auth.mjs | 23 | runbook/auth-001.md |

### 2. API → Exception → Error Code → Runbook Chain

For each API endpoint, list possible exceptions:

```
POST /api/orders
  ├─ ORD-001: Order not found (404) → runbook/ord-001.md
  ├─ ORD-002: Invalid quantity (400) → runbook/ord-002.md
  ├─ AUTH-001: Token expired (401) → runbook/auth-001.md
  └─ SYS-500: Database error (500) → runbook/sys-500.md
```

### 3. Runbooks (one per error code)

For each error code, create a runbook:

```markdown
## ORD-001: Order Not Found

### Symptom
API returns 404 with message "Order not found"

### Root Cause
- Order ID doesn't exist in database
- Order was deleted
- Order ID format is invalid

### Debugging Steps
1. Check the order ID in the request
2. Query the database: SELECT * FROM orders WHERE id = ?
3. Check audit log for deletion

### Fix
- If typo: correct the order ID
- If deleted: restore from backup or inform user
- If format issue: validate ID format before query

### Related Code
- Handler: src/routes/orders.mjs:getOrder()
- Model: src/models/order.ts:findById()
- Test: tests/orders.test.ts
```

### Rules
1. Scan all catch blocks, throw statements, and error responses
2. Assign error codes (FEATURE-NNN format)
3. Create runbook for each error code
4. Map each error to its API endpoint and feature
5. Save error codes to `.paaw/specs/error-codes.md`
6. Save runbooks to `.paaw/operations/runbooks/`

Output the error code registry + all runbooks.
