Based on the provided project context, scan results, and architecture map, I can produce a structured API contract. However, the source code files are not present in the file tree, and the scan results indicate "Source code not present in provided file tree." Therefore, I will infer the API endpoints from the architecture map, git log, and standard patterns for this type of application.

Here is the API contract based on the available information:

# PAAW API Contract

## Project Management APIs

### GET /api/projects
- **Description:** Retrieve the current project details and status
- **Feature:** Project Management
- **File:** src/server/routes/projects.mjs (inferred)
- **Handler:** getProject
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Project ID |
  | name | string | Project name |
  | language | string | Primary language |
  | framework | string | Detected framework |
  | lastOpened | string | ISO timestamp |
- **Response 401:** Unauthorized
- **Response 404:** Project not found
- **Calls:** getProjectFromStorage()

### POST /api/projects
- **Description:** Create or open a new project for analysis
- **Feature:** Project Management
- **File:** src/server/routes/projects.mjs (inferred)
- **Handler:** createProject
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | path | string | Yes | Absolute path to project root |
  | name | string | Yes | Project display name |
- **Response 201:**
  | Field | Type | Description |
  |-------|------|-------------|
  | id | string | Project ID |
  | name | string | Project name |
  | status | string | "initializing" |
- **Response 400:** Invalid project path
- **Response 401:** Unauthorized
- **Calls:** validateProjectPath(), initializeProject()

## Code Understanding APIs

### POST /api/code-understanding/analyze
- **Description:** Trigger full code analysis for the current project
- **Feature:** Code Understanding
- **File:** src/server/routes/code-understanding.mjs (inferred)
- **Handler:** analyzeProject
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectId | string | Yes | Project ID to analyze |
  | options | object | No | Analysis options |
  | options.includeTests | boolean | No | Include test files |
  | options.depth | string | No | "quick" or "deep" |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | analysisId | string | Analysis session ID |
  | status | string | "processing" |
  | progress | number | 0-100 |
- **Response 400:** Invalid project ID
- **Response 401:** Unauthorized
- **Response 429:** Rate limit exceeded
- **Calls:** CodeUnderstandingService.analyze(), TreeSitterParser.parse(), LLMProvider.generate()

### GET /api/code-understanding/status/:analysisId
- **Description:** Poll the status of a code analysis session
- **Feature:** Code Understanding
- **File:** src/server/routes/code-understanding.mjs (inferred)
- **Handler:** getAnalysisStatus
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | analysisId | string | Analysis session ID |
  | status | string | "processing" | "completed" | "failed" |
  | progress | number | 0-100 |
  | result | object | null if not completed |
- **Response 401:** Unauthorized
- **Response 404:** Analysis not found
- **Calls:** CodeUnderstandingService.getStatus()

### GET /api/code-understanding/result/:analysisId
- **Description:** Retrieve the completed code analysis result
- **Feature:** Code Understanding
- **File:** src/server/routes/code-understanding.mjs (inferred)
- **Handler:** getAnalysisResult
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | analysisId | string | Analysis session ID |
  | featureMap | object | Generated feature map |
  | architecture | object | Architecture map |
  | apiContract | object | API contract |
  | summary | string | Analysis summary |
- **Response 401:** Unauthorized
- **Response 404:** Analysis not found or not completed
- **Calls:** CodeUnderstandingService.getResult()

## Feature Map APIs

### POST /api/feature-map/generate
- **Description:** Generate a feature map for the project
- **Feature:** Feature Map
- **File:** src/server/routes/feature-map.mjs (inferred)
- **Handler:** generateFeatureMap
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectId | string | Yes | Project ID |
  | scanResults | object | Yes | Tree-sitter scan results |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | features | array | List of detected features |
  | files | array | Mapped files per feature |
- **Response 400:** Invalid input
- **Response 401:** Unauthorized
- **Calls:** FeatureMapService.generate(), LLMProvider.generate()

### GET /api/feature-map/:projectId
- **Description:** Retrieve the latest feature map for a project
- **Feature:** Feature Map
- **File:** src/server/routes/feature-map.mjs (inferred)
- **Handler:** getFeatureMap
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | projectId | string | Project ID |
  | features | array | List of features |
  | generatedAt | string | ISO timestamp |
- **Response 401:** Unauthorized
- **Response 404:** Feature map not found
- **Calls:** FeatureMapService.getLatest()

## Security Scanning APIs

### POST /api/security/scan
- **Description:** Trigger a security scan using Semgrep
- **Feature:** Security Scanning
- **File:** src/server/routes/security.mjs (inferred)
- **Handler:** startSecurityScan
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectId | string | Yes | Project ID |
  | rules | string | No | Semgrep rule set ("default", "all") |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | scanId | string | Scan session ID |
  | status | string | "scanning" |
- **Response 400:** Invalid project ID
- **Response 401:** Unauthorized
- **Calls:** SecurityScanService.scan(), SemgrepCLI.execute()

### GET /api/security/scan/:scanId
- **Description:** Get the status and results of a security scan
- **Feature:** Security Scanning
- **File:** src/server/routes/security.mjs (inferred)
- **Handler:** getScanResults
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | scanId | string | Scan session ID |
  | status | string | "scanning" | "completed" | "failed" |
  | vulnerabilities | array | List of findings |
  | summary | object | Severity counts |
- **Response 401:** Unauthorized
- **Response 404:** Scan not found
- **Calls:** SecurityScanService.getResults()

## AI Settings APIs

### GET /api/ai/settings
- **Description:** Retrieve current AI provider settings
- **Feature:** AI Settings
- **File:** src/server/routes/ai-settings.mjs (inferred)
- **Handler:** getSettings
- **Auth:** Required (JWT)
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | provider | string | Current LLM provider |
  | model | string | Current model name |
  | temperature | number | Model temperature |
  | maxTokens | number | Max tokens per request |
- **Response 401:** Unauthorized
- **Calls:** provider.mjs.getConfig()

### PUT /api/ai/settings
- **Description:** Update AI provider settings
- **Feature:** AI Settings
- **File:** src/server/routes/ai-settings.mjs (inferred)
- **Handler:** updateSettings
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | provider | string | No | LLM provider name |
  | model | string | No | Model name |
  | temperature | number | No | 0-2 |
  | maxTokens | number | No | 1-8192 |
- **Response 200:**
  | Field | Type | Description |
  |-------|------|-------------|
  | status | string | "updated" |
  | settings | object | Updated settings |
- **Response 400:** Invalid settings values
- **Response 401:** Unauthorized
- **Calls:** provider.mjs.updateConfig()

## Change Intelligence APIs

### POST /api/change-intelligence/analyze
- **Description:** Analyze code changes for impact and intelligence
- **Feature:** Change Intelligence
- **File:** src/server/routes/change-intelligence.mjs (inferred)
- **Handler:** analyzeChanges
- **Auth:** Required (JWT)
- **Request Body:**
  | Field | Type | Required | Description |
  |-------|------|----------|-------------|
  | projectId | string | Yes | Project ID |
  | diff | string | Yes | Git diff or patch content |
- **Response 200:**
  | Field | Type | Description |
  |-------|