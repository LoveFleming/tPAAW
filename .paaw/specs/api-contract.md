```markdown
## Code Understanding (CU) APIs

### POST /api/cu/start
- **Description:** Start a new Code Understanding workflow for a given project directory
- **Feature:** Code Understanding
- **File:** `src/routes/cu.mjs` (inferred)
- **Handler:** `startCUFlow`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectDir | string | Yes | Absolute path to the project root |
  | steps | array | No | List of steps to run (default: all) |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | workflowId | string | Unique workflow identifier |
  | status | string | `"started"` |
- **Response 400:** Invalid project directory or missing required fields
- **Response 401:** Unauthorized
- **Calls:** `initializeCU()`, `persistStatus()`, `startSteps()`

### GET /api/cu/status/:workflowId
- **Description:** Retrieve the current status and progress of a CU workflow
- **Feature:** Code Understanding
- **File:** `src/routes/cu.mjs` (inferred)
- **Handler:** `getCUStatus`
- **Auth:** Required (JWT)
- **Parameters:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | workflowId | string | Yes | Workflow ID from start |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | workflowId | string | Workflow ID |
  | currentStep | string | Current step name |
  | stepsCompleted | number | Number of completed steps |
  | totalSteps | number | Total number of steps |
  | status | string | `"running"`, `"completed"`, `"failed"` |
  | error | string | Error message if failed |
- **Response 401:** Unauthorized
- **Response 404:** Workflow not found
- **Calls:** `readCUStatus()`, `getProgress()`

### POST /api/cu/refresh
- **Description:** Refresh the CU workflow with incremental updates (cu_refresh tool)
- **Feature:** Code Understanding
- **File:** `src/routes/cu.mjs` (inferred)
- **Handler:** `cuRefresh`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | workflowId | string | Yes | Existing workflow ID |
  | changedFiles | array | Yes | List of files changed since last run |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | workflowId | string | Workflow ID |
  | status | string | `"refreshing"` |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Calls:** `updateCUStatus()`, `reanalyzeFiles()`, `persistStatus()`

## Feature Map APIs

### POST /api/feature-map
- **Description:** Generate a feature map from source code analysis using Tree-sitter
- **Feature:** Feature Map
- **File:** `src/routes/featuremap.mjs` (inferred)
- **Handler:** `generateFeatureMap`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectDir | string | Yes | Project root directory |
  | languages | array | No | Languages to parse (default: auto-detect) |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | features | array | List of feature objects |
  | analysisTime | number | Milliseconds taken |
- **Response 400:** Invalid project directory
- **Response 401:** Unauthorized
- **Calls:** `parseSource()`, `buildFeatureMap()`, `aggregateResults()`

## Security (Semgrep) APIs

### POST /api/security/scan
- **Description:** Run a Semgrep security scan on the project
- **Feature:** Security Tab
- **File:** `src/routes/security.mjs` (inferred)
- **Handler:** `runSemgrepScan`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectDir | string | Yes | Project root directory |
  | rules | array | No | Custom rule paths (default: built-in rules) |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | scanId | string | Unique scan identifier |
  | status | string | `"queued"`, `"running"`, `"completed"`, `"failed"` |
  | findings | array | List of security findings (when completed) |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Response 503:** Semgrep not installed (friendly install prompt returned)
- **Calls:** `checkSemgrepInstall()`, `executeSemgrep()`, `parseResults()`

### GET /api/security/scan/:scanId
- **Description:** Retrieve the status or results of a Semgrep scan
- **Feature:** Security Tab
- **File:** `src/routes/security.mjs` (inferred)
- **Handler:** `getScanResult`
- **Auth:** Required (JWT)
- **Parameters:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | scanId | string | Yes | Scan ID from POST scan |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | scanId | string | Scan ID |
  | status | string | `"running"`, `"completed"`, `"failed"` |
  | findings | array | List of findings (if completed) |
  | error | string | Error message if failed |
- **Response 401:** Unauthorized
- **Response 404:** Scan not found
- **Calls:** `getScanStatus()`, `formatFindings()`

## Intelligence Tools APIs

### POST /api/agent-loop
- **Description:** Trigger the agent loop to run three intelligence tools (Code, Test, Change) sequentially
- **Feature:** Agent Loop
- **File:** `src/routes/agent.mjs` (inferred)
- **Handler:** `runAgentLoop`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectDir | string | Yes | Project root directory |
  | tools | array | No | Which tools to run (default: all three) |
  | context | object | No | Additional context for the analysis |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | loopId | string | Unique loop identifier |
  | status | string | `"started"` |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Calls:** `runCodeIntelligence()`, `runTestIntelligence()`, `runChangeIntelligence()`, `aggregateResults()`

### GET /api/agent-loop/:loopId
- **Description:** Retrieve the status and results of an agent loop execution
- **Feature:** Agent Loop
- **File:** `src/routes/agent.mjs` (inferred)
- **Handler:** `getLoopResult`
- **Auth:** Required (JWT)
- **Parameters:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | loopId | string | Yes | Loop ID from POST |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | loopId | string | Loop ID |
  | status | string | `"running"`, `"completed"`, `"failed"` |
  | codeIntelligence | object | Results from Code Intelligence tool |
  | testIntelligence | object | Results from Test Intelligence tool |
  | changeIntelligence | object | Results from Change Intelligence tool |
  | error | string | Error message if failed |
- **Response 401:** Unauthorized
- **Response 404:** Loop not found
- **Calls:** `fetchToolResults()`, `mergeOutputs()`

## Knowledge Package APIs

### POST /api/knowledge-package
- **Description:** Generate a knowledge package for AI agent handover
- **Feature:** Knowledge Package
- **File:** `src/routes/knowledge.mjs` (inferred)
- **Handler:** `generateKnowledgePackage`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectDir | string | Yes | Project root directory |
  | scope | string | No | `"full"` or `"incremental"` (default: `"full"`) |
  | includeSecurity | boolean | No | Whether to include security findings (default: `true`) |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | packageId | string | Unique package identifier |
  | package | object | Knowledge package data |
  | size | number | Size in bytes |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Calls:** `getCodeIntelligence()`, `getFeatureMap()`, `getSecurityResults()`, `assemblePackage()`

## Provider (General) APIs

### POST /api/import
- **Description:** Import a file or module into the project workspace (used for loading external code)
- **Feature:** Provider Module
- **File:** `src/routes/provider.mjs` (inferred)
- **Handler:** `importModule`
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | source | string | Yes | URL or file path to import |
  | type | string | Yes | `"file"`, `"module"`, `"package"` |
  | options | object | No | Additional import options |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Imported item identifier |
  | status | string | `"imported"` |
- **Response 400:** Invalid input (e.g., backtick in template literal)
- **Response 401:** Unauthorized
- **Calls:** `validateImport()`, `parseSource()`, `saveToWorkspace()`

### GET /api/provider/status
- **Description:** Check the health and status of the provider module
- **Feature:** Provider Module
- **File:** `src/routes/provider.mjs` (inferred)
- **Handler:** `getProviderStatus`
- **Auth:** Optional (API key)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | status | string | `"ok"` |
  | version | string | Provider version |
  | uptime | number | Seconds since last restart |
- **Response 401:** Unauthorized (if API key required)
- **Calls:** `checkHealth()`

## Dashboard (EMDashboard) APIs

### GET /api/dashboard/cu-summary
- **Description:** Get a summary of the latest Code Understanding status for the dashboard
- **Feature:** Dashboard (EMDashboard)
- **File:** `src/routes/dashboard.mjs` (inferred)
- **Handler:** `getCUSummary`
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | lastWorkflow | object | Details of the most recent CU workflow |
  | securityAlerts | number | Count of open security findings |
  | intelligenceAvailable | boolean | Whether intelligence tools are ready |
- **Response 401:** Unauthorized
- **Calls:** `readCUStatus()`, `getLatestSecurityScan()`, `checkToolAvailability()`

## AI Settings APIs

### GET /api/ai-settings/prompts
- **Description:** Retrieve all AI prompts used by the system
- **Feature:** AI Settings
- **File:** `src/routes/aisettings.mjs` (inferred)
- **Handler:** `getPrompts`
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | prompts | array | List of prompt objects (name, content, domain) |
- **Response 401:** Unauthorized
- **Calls:** `loadPrompts()` (from `ai-settings/` directory)

### PUT /api/ai-settings/prompts/:promptName
- **Description:** Update a specific AI prompt
- **Feature:** AI Settings
- **File:** `src/routes/aisettings.mjs` (inferred)
- **Handler:** `updatePrompt`
- **Auth:** Required (JWT) + admin role
- **Parameters:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | promptName | string | Yes | Name of the prompt to update |
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | content | string | Yes | New prompt content |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | status | string | `"updated"` |
- **Response 400:** Invalid prompt name or content
- **Response 401:** Unauthorized
- **Response 403:** Forbidden (non-admin)
- **Calls:** `validatePrompt()`, `savePrompt()`, `reloadPrompts()`

## Rate Limiting

All endpoints are rate-limited to 100 requests per minute per user (sliding window). Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. Exceeded requests return **429 Too Many Requests**.

## Authentication

All endpoints (except `/api/provider/status` with optional API key) require a valid JWT token in the `Authorization` header: `Bearer <token>`. Tokens are issued via a separate authentication service (not documented here). Roles are `user` and `admin`; admin role is required for modifying AI prompts.
```