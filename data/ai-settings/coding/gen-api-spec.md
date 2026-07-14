# Code Understanding — Generate API Contract

You are a senior API designer. Produce a structured API contract from the project's source code.

## What You Receive
- Feature Map (already generated) — features and their code files
- Source Analysis (Tree-sitter) — routes detected per file
- Architecture Map (already generated)
- Project scan results

## What to Produce

Produce TWO things:

### 1. API Contract (Markdown)

For each API endpoint, document:

```markdown
## [Feature Name] APIs

### POST /api/orders
- **Description:** Create a new order
- **Feature:** Order Management
- **File:** src/routes/orders.mjs
- **Handler:** createOrder
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | productId | string | Yes | Product ID |
  | quantity | number | Yes | Order quantity |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Order ID |
  | status | string | Order status |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Calls:** validateOrder(), calculatePrice(), saveOrder()
```

### 2. API Examples (JSON)

After the markdown, output a JSON block with request/response examples for each endpoint.
This JSON will be saved as `.paaw/code-intelligence/api-examples.json` and used by the API Tester.

Wrap the JSON in ```json-examples block:

```json-examples
[
  {
    "method": "POST",
    "endpoint": "/api/orders",
    "description": "Create a new order",
    "request": {
      "headers": { "Content-Type": "application/json", "Authorization": "Bearer test-token" },
      "body": { "productId": "prod-001", "quantity": 2 }
    },
    "response": {
      "status": 200,
      "body": { "id": "ord-123", "status": "created", "productId": "prod-001", "quantity": 2 }
    }
  },
  {
    "method": "GET",
    "endpoint": "/api/orders/{id}",
    "description": "Get order by ID",
    "request": {
      "headers": { "Authorization": "Bearer test-token" },
      "params": { "id": "ord-123" }
    },
    "response": {
      "status": 200,
      "body": { "id": "ord-123", "status": "created" }
    }
  }
]
```

### Rules
1. Group APIs by feature (from Feature Map)
2. For each API, trace the handler function and its call chain
3. Include request/response schemas inferred from code
4. List error responses with HTTP status codes
5. Note authentication/authorization requirements
6. Note rate limiting if visible
7. For the JSON examples: generate at least 1 example per endpoint (happy path)
8. Use realistic test data inferred from the code (not "asdf" or "test123")
9. For path params like {id}, include the param name and a realistic example value
10. For GET endpoints with query params, include them in request.params
