```markdown
# PAAW Coding Standards

## 1. Coding Rules

### 1.1 Naming Conventions
- **Files**: Use `kebab-case` for all files (e.g., `code-understanding-service.mjs`, `security-tab.jsx`).
- **Functions**: `camelCase` for function names (e.g., `fetchFeatureMap`, `validateInput`).
- **Classes**: `PascalCase` (e.g., `CodeUnderstandingService`, `SecurityScanner`).
- **Variables**: `camelCase` for local variables and parameters. Constants in `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`).
- **React Components**: `PascalCase` (e.g., `SecurityTab`, `FeatureMapView`).
- **Private members**: Prefix with underscore `_` for internal methods (e.g., `_parseTree`, `_retry`).

### 1.2 File Organization
- **Frontend**:  
  `src/client/`  
  - `components/` – Reusable UI components (e.g., `Toolbar.jsx`, `ResultPanel.jsx`)  
  - `pages/` – Top-level page components (e.g., `CodingApp.jsx`, `SecurityTab.jsx`)  
  - `store/` – React Context providers and state hooks (e.g., `ProjectContext.js`, `useAISettings.js`)  
  - `styles/` – CSS/SCSS modules (if any)  
- **Backend**:  
  `src/server/`  
  - `routes/` – Express route handlers (e.g., `code-understanding.js`, `security.js`)  
  - `services/` – Business logic (e.g., `CodeUnderstandingService.mjs`, `SecurityScanService.mjs`)  
  - `providers/` – External integrations (e.g., `provider.mjs`, `semgrepRunner.mjs`)  
  - `middleware/` – Express middleware (e.g., `errorHandler.mjs`, `logger.mjs`)  
  - `models/` – Data models/schemas (e.g., `Project.mjs`, `Vulnerability.mjs`)  
- **Shared**:  
  `src/shared/` for constants, utilities, and types used by both frontend and backend.

### 1.3 Import Ordering
Within each file, group imports in the following order, separated by a blank line:
1. Node.js built-in modules (e.g., `fs`, `path`, `http`)
2. Third-party packages (e.g., `express`, `react`, `tree-sitter`)
3. Internal modules (aliases `@/server/...`, `@/client/...`)
4. Relative imports (e.g., `./utils`, `../providers/`)

Within each group, sort alphabetically.

### 1.4 Export Patterns
- **Named exports** for functions, constants, and utility modules (preferred).
- **Default exports** only for **React components** and **page-level modules**.
- **Re-export with barrel files** (`index.js` or `index.mjs`) for a directory.

Example:
```javascript
// utils/helpers.mjs
export const formatDate = (date) => { ... };
export const parseError = (err) => { ... };

// components/Toolbar.jsx
export default function Toolbar() { ... }
```

## 2. Architecture Rules

### 2.1 Layer Dependencies
Strict unidirectional dependency flow:
```
Presentation (src/client/)
   ↓ API calls
API Layer (src/server/routes/)
   ↓
Business Logic Layer (src/server/services/)
   ↓
Data Layer (src/server/providers/, external APIs, file system)
```
- **Never** allow a route handler to directly call a provider or access the file system. Always delegate to a service.
- **Never** allow a service to import from routes or presentation.
- **Never** allow a component to import from backend services directly (use API calls only).

### 2.2 Module Boundaries
- **No cross-package imports** without explicit justification. Each module (e.g., `code-understanding`, `security`) should be self-contained.
- Shared utilities go into `src/shared/` and must have no dependencies on specific modules.
- Feature-specific models and helpers live inside the feature’s service directory.

### 2.3 Separation of Concerns
- **Routes** (API layer): Only parse request, validate input, call a service, and format response. No business logic.
- **Services** (Business Logic): Orchestrate calls to providers, apply domain rules, handle errors.
- **Providers** (External integrations): Wrap external tools (LLM, Semgrep, file system) with retry, logging, and error translation.
- **Presentation**: Only handle UI state, user interactions, and API calls via fetch/axios. No direct file access or business logic.

## 3. Pattern Guidelines

### 3.1 Error Handling
- **Always use try/catch** in async functions, especially in services and routes.
- **Throw custom error classes** with a numeric `code` and a human-readable `message` (e.g., `ProviderError`, `ValidationError`).
- **Route-level error handling**: Use a centralized error middleware to catch errors and return a consistent JSON response:
  ```json
  { "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Missing required field" } }
  ```
- **External calls**: Wrap in try/catch and translate network errors to domain errors. Log the full error server-side, send only sanitized message to client.

### 3.2 Async Patterns
- **Use `async/await`** consistently. Avoid `.then()` / `.catch()` chains.
- **Propagate errors** by throwing; do not silently swallow errors.
- **Concurrency**: For independent parallel tasks, use `Promise.allSettled()` (not `Promise.all`) to avoid one failure breaking the whole group.
- **Retry logic**: Already implemented in `provider.mjs` – reuse for all external API calls. Retry with exponential backoff and max retries (e.g., 3).

### 3.3 State Management
- **Global state**: Use React Context for project-level data (e.g., current project, AI settings, scan results). Create a separate context per domain (e.g., `ProjectContext`, `SecurityContext`).
- **Local state**: Use `useState` / `useReducer` for component-specific UI state.
- **Avoid prop drilling**: Use Context or custom hooks for shared state.
- **Side effects**: Use `useEffect` for API calls and subscription cleanups.

### 3.4 API Response Format Conventions
All API endpoints must return JSON with a consistent envelope:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 100 }  // optional for paginated endpoints
}
```
On error:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```
**HTTP status codes**: Use standard codes (200, 201, 400, 401, 403, 404, 500). Do not return 200 for errors.

### 3.5 Testing Patterns
- **Unit tests**: Jest for services and utilities. Mock external providers (e.g., LLM, Semgrep).
- **Integration tests**: Supertest for API routes. Test end-to-end with mocked services.
- **Component tests**: React Testing Library for UI components. Test rendering and user interactions.
- **File naming**: Test files should be named `*.test.mjs` (or `*.test.jsx`) and placed next to the source file.
- **Coverage**: All critical paths must have at least one test. Focus on error handling, edge cases, and happy paths.

## 4. Quality Checklist

- [ ] **No hardcoded secrets** – API keys, tokens, passwords must be in environment variables (`.env` file) or a secure vault.
- [ ] **Error handling for all external calls** – Every network request, file read/write, or external tool invocation must be wrapped in try/catch with proper error propagation.
- [ ] **Input validation on all API endpoints** – Use middleware (e.g., `express-validator`) or manual validation for all request parameters, body, and query strings.
- [ ] **Consistent naming** – Follow the conventions in section 1.1. Run linting (ESLint) with a ruleset enforcing these.
- [ ] **No circular dependencies** – Use `madge` or similar tool to detect cycles. Refactor by extracting shared modules.
- [ ] **Tests cover critical paths** – At minimum: login/auth flow, main API endpoints, error responses, and edge cases (e.g., empty payload, invalid input).

---
*Last updated: 2025-04-07*
```