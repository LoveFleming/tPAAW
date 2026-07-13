# PAAW

> A web-based coding assistant that integrates AI-powered code understanding, security scanning, and change intelligence into a single workspace for developers.

## Quick Links
- [Architecture Map](ARCHITECTURE.md)
- [Feature Map](features/FEATURES.json)
- [API Contract](specs/api-contract.md)
- [Error Codes](specs/error-codes.md)
- [Coding Standards](standards/coding-style.md)
- [Code Intelligence](code-intelligence/summary.json)
- [Security Scan](security/scan-results.json)

## Tech Stack
- Language: JavaScript (Node.js), TypeScript
- Framework: React (frontend), Express.js (backend)
- Runtime: Node.js (v18+)
- Database: None (file-based storage)
- Key Libraries: Tree-sitter (source parsing), Semgrep (SAST), LLM provider (OpenAI, GLM, etc.)
- Build: Vite or Webpack (inferred)

## Architecture Overview
PAAW is a monolithic web application with a single deployable unit. The frontend (React) and backend (Express.js) are served from the same Node.js process. The system is organized into vertical slices: Code Understanding, Security Scanning, Feature Mapping, Change Intelligence, and AI Provider abstraction. The backend orchestrates external tools (Tree-sitter, Semgrep) and LLM APIs via a custom provider module. Data is stored in temporary files under the `temp/` directory. The architecture follows a layered pattern with presentation, API, business logic, and data layers.

## Features
- **Code Understanding** – Analyzes source code using Tree-sitter and LLM to generate architecture maps, feature maps, and API contracts.
- **Security Scanning** – Integrates Semgrep as a built-in SAST scanner to detect vulnerabilities and display results in a dedicated UI panel.
- **Feature Map Generation** – Uses LLM prompts to create a feature map from Tree-sitter scan results.
- **Change Intelligence** – Analyzes git diffs to provide change impact analysis and summaries.
- **AI Settings** – Configurable LLM provider, model, temperature, and retry logic.
- **Project Management** – Open and manage projects for analysis.

## Getting Started
### Prerequisites
- Node.js v18+ and npm
- (Optional) Semgrep CLI installed for security scanning
- API key for an LLM provider (e.g., OpenAI, GLM)

### Installation
1. Clone the repository.
2. Run `npm install` in the project root.
3. Configure environment variables (e.g., `LLM_API_KEY`, `LLM_PROVIDER`).

### Running
```bash
npm run dev
```
The application will start on `http://localhost:3000`.

### Testing
```bash
npm test
```

## Project Structure
```
paaw/
├── src/
│   ├── client/          # React frontend
│   │   ├── components/  # UI components (Toolbar, SecurityPanel, etc.)
│   │   ├── pages/       # Page components (CodingApp, SecurityTab)
│   │   └── store/       # State management (React Context)
│   ├── server/          # Express backend
│   │   ├── routes/      # API route handlers
│   │   ├── services/    # Business logic (CodeUnderstanding, Security, FeatureMap)
│   │   ├── providers/   # LLM provider abstraction (provider.mjs)
│   │   └── middleware/  # Error handling, logging, auth
│   └── models/          # Data models (Project, Analysis, Vulnerability)
├── temp/                # Temporary files (JSON payloads, logs, scan results)
├── specs/               # API contracts, error codes
├── runbooks/            # Runbooks for error codes
├── standards/           # Coding standards
├── ARCHITECTURE.md
└── PROJECT.md
```

## Development
### Coding Standards
- Use standard JavaScript/TypeScript best practices.
- Follow the existing code style (e.g., Prettier, ESLint).
- Document all public APIs and services.

### How to Add a New Feature
1. Identify the feature vertical (e.g., Security, Code Understanding).
2. Create a new route in `src/server/routes/`.
3. Implement the service in `src/server/services/`.
4. Add UI components in `src/client/components/`.
5. Register the new route in the main app.
6. Add corresponding tests.

### How to Add a New API Endpoint
1. Add a new route handler in `src/server/routes/`.
2. Define the request/response schema in the API contract.
3. Implement business logic in a service.
4. Handle errors using the error code registry.
5. Update the API contract document.

### How to Run Tests
- Unit tests: `npm test`
- Integration tests: `npm run test:integration`
- Security scan tests: `npm run test:security`

## Operations
### Error Codes
All error codes are documented in `specs/error-codes.md`. Each code has a runbook in `runbooks/` for troubleshooting.

### Runbooks
Runbooks provide step-by-step debugging and resolution instructions for common errors. See `runbooks/cu-001.md`, `runbooks/sem-001.md`, etc.

### Monitoring
- Check server logs for errors and retries.
- Monitor LLM API usage and response times.
- Review Semgrep scan results for recurring vulnerabilities.

## Recent Changes
- **feat:** Reorder CU flow + add Test Intelligence & Change Intelligence
- **feat:** Code Intelligence + Knowledge Package for AI agent handover
- **feat:** Security tab UI for Coding app — Semgrep results panel
- **feat:** integrate Semgrep as built-in SAST scanner for Coding app
- **feat:** add Java support to Tree-sitter parser
- **feat:** Tree-sitter source analysis for Code Understanding feature-map
- **fix:** provider.mjs syntax error — if block missing closing brace
- **feat:** Code Understanding prompts visible in AI Settings UI
- **feat:** feature-map produces more features + larger context
- **debug:** add FeatureMap fetch debug logs + error display
- **style:** Coding toolbar text-xs + remove font-semibold
- **fix:** cannot set headers after they are sent to the client
- **fix:** auto-retry when LLM returns empty/whitespace/invisible content
- **fix:** reduce LLM retry counts + notify frontend during retries
- **fix:** Feature Map step_done sent even when JSON parse fails
- **feat:** auto-open Features tab after Code Understanding completes
- **fix:** remove all hardcoded 'glm-5.1' model fallbacks — use resolveDefaultModel()
- **feat:** auto-trigger Code Understanding on first project open
- **fix:** remove HTTP request headers log from provider.mjs
- **fix:** Windows feature-map scan — Unix 'find' doesn't exist on Windows