# Code Understanding — Generate API Contract

You are a senior API designer. Produce a structured API contract from the project's source code.

## What You Receive
- Feature Map (already generated) — features and their code files
- Source Analysis (Tree-sitter) — routes detected per file
- Architecture Map (already generated)
- Project scan results

## What to Produce

For each API endpoint, document:

### API Contract Format

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

### Rules
1. Group APIs by feature (from Feature Map)
2. For each API, trace the handler function and its call chain
3. Include request/response schemas inferred from code
4. List error responses with HTTP status codes
5. Note authentication/authorization requirements
6. Note rate limiting if visible

Output ONLY the markdown document.
