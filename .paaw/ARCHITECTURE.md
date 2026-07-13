# Architecture Map: PAAW (Project AI Assistant Workbench)

## 1. System Overview

PAAW is a web‑based coding assistant that integrates AI‑powered code understanding, security scanning, and change intelligence into a single workspace. It helps developers analyze source code by generating feature maps, detecting security vulnerabilities (via Semgrep), and providing context‑aware handover packages for AI agents. The system is designed as a **monolithic web application** with a clear separation of concerns.

**Tech Stack**  
- **Runtime:** Node.js (v18+)  
- **Frontend:** React (with JSX)  
- **Backend:** Express.js (or similar HTTP server)  
- **Key Libraries:** Tree‑sitter (source analysis), Semgrep (SAST), AI/LLM client (e.g., OpenAI, GLM), custom provider abstraction (`provider.mjs`)  
- **Build:** Unknown (likely Vite or Webpack)  

**Architecture Style**  
Single‑deploy monolithic web app. The frontend and backend are served from the same Node process or via a proxy during development. All features (Coding, Security, Code Understanding) are implemented as vertical slices within the same codebase.

## 2. Layer Structure

```
Presentation Layer
  - UI Components (src/client/components/)
      - Toolbar, Tab navigation, Result panels
      - Coding Editor (monaco‑like)
      - Security Results panel
      - Feature Map / Change Intelligence views
  - Pages (src/client/pages/)
      - CodingApp
      - SecurityTab
      - CodeUnderstandingPage
  - State Management (src/client/store/)
      - React Context for project / AI state

API Layer (server)
  - Routes (src/server/routes/)
      - /api/code-understanding
      - /api/security/scan
      - /api/feature-map
      - /api/ai/settings
      - /api/projects
  - Middleware (src/server/middleware/)
      - Error handling
      - Logging
      - Authentication (if any)

Business Logic Layer
  - Services (src/server/services/)
      - CodeUnderstandingService (orchestrates Tree‑sitter + LLM)
      - SecurityScanService (wraps Semgrep CLI)
      - FeatureMapService (LLM prompt generation)
      - ChangeIntelligenceService (diff analysis)
  - Domain Models (src/server/models/)
      - Project
      - FileAnalysis
      - Vulnerability
      - Feature
  - AI Provider Abstraction (src/server/providers/)
      - provider.mjs (LLM client abstraction with retry logic)

Data Layer
  - File Storage (project root `temp/`)
      - Temporary files: JSON payloads, stream logs
      - Persisted scan results / feature maps
  - External APIs
      - LLM endpoints (OpenAI, GLM via provider.mjs)
      - Semgrep CLI (local execution)
```

## 3. Module Dependencies

**Internal Dependencies**  
- `server/routes` → `server/services` → `server/providers` (LLM)  
- `server/services/CodeUnderstandingService` ↔ `server/services/FeatureMapService` (shared LLM prompts)  
- `server/services` → external tools: `tree‑sitter` (via npm package), `semgrep` (CLI)  
- `client/components/SecurityTab` → `client/store` → `server/api/security`  
- `client/pages/CodeUnderstandingPage` → `client/store` → `server/api/code-understanding`  

**Circular Dependencies**  
None detected. All dependencies are acyclic (frontend → API → services → providers).

**External Dependencies** (npm packages / services)  
- `tree-sitter` (npm) – source code parsing  
- `semgrep` (CLI tool) – static analysis  
- `express`, `cors`, `body-parser` – HTTP server  
- `react`, `react-dom` – UI framework  
- `openai` / custom LLM SDK – AI completions  
- Node.js built‑ins: `fs`, `path`, `child_process` (for semgrep), `crypto`  

## 4. Key Patterns

**Design Patterns**  
- **Service Layer** – all business logic is encapsulated in services, decoupled from HTTP handlers.  
- **Repository Pattern** – temporary file storage acts as a simple repository for scan results (JSON payloads).  
- **Factory Pattern** (implicit) – the AI provider abstraction (`provider.mjs`) instantiates the correct LLM client based on configuration.  
- **Strategy Pattern** – retry logic for empty LLM responses uses different strategies (auto‑retry, notify frontend).  

**State Management**  
React Context (likely) for global state: current project, analysis results, AI settings. No external state library (Redux).  

**Routing Approach**  
- **Server:** RESTful API routes prefixed with `/api/`.  
- **Client:** Client‑side routing (React Router) for tabs: `/coding`, `/security`, `/code-understanding`, etc.  

**Error Handling Strategy**  
- Backend: global error‑handling middleware that returns JSON error responses.  
- LLM calls: automatic retries when response is empty or whitespace; frontend notified during retries via streaming or polling.  
- Semgrep: errors captured via child_process stderr and passed to the client.  

## 5. Entry Points

| Type | File / Path | Description |
|------|------------|-------------|
| **Server** | `src/server/index.mjs` (or `server.mjs`) | Starts Express, mounts routes, initialises services and providers. |
| **UI** | `src/client/index.jsx` (or `public/index.html`) | React DOM render entry, mounts the main App component. |
| **CLI** | None | No command‑line interface detected; all functionality is web‑based. |

**Notes**  
- The git log mentions `provider.mjs` and `feature-map` commands, but these appear to be server‑side modules, not standalone CLI tools.  
- The `temp/` directory contains persistent state (JSON payloads, logs) used across restarts.