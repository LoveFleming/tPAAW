# Architecture Map — PAAW (Personal AI Agent Workbench)

## 1. System Overview

PAAW is a code understanding and analysis platform that integrates AI-driven intelligence tools with security scanning to help developers analyze, understand, and improve their codebases. The system provides a workflow-based approach to code comprehension, featuring multiple analysis steps (Code Understanding, Test Intelligence, Change Intelligence) orchestrated through an agent loop, with results surfaced in a dashboard UI.

The tech stack consists of **JavaScript/Node.js** runtime with a **React** frontend and **Express** backend (inferred). Key libraries include **Tree-sitter** for source code parsing, **Semgrep** for SAST security scanning, and custom AI integration modules. The architecture follows a **monolithic** style with modular internal components, organized as a single application with clearly separated concerns.

## 2. Layer Structure

```
Presentation Layer
  - Dashboard UI (EMDashboard component)
  - Security Tab UI (SecurityTab component)
  - AI Settings UI (ai-settings/ directory)
  - Toolbar components (shared UI elements)

API Layer
  - Provider Module (provider.mjs) — server-side API endpoints
  - Middleware (inferred, for request handling)
  - Agent Loop API (orchestrates intelligence tools)

Business Logic Layer
  - Code Understanding (CU) — workflow management, status persistence
  - Code Intelligence — source analysis and feature extraction
  - Test Intelligence — test file analysis and generation
  - Change Intelligence — code change impact analysis
  - Knowledge Package Generator — AI handover context creation
  - Feature Map — produces structured feature maps from source analysis

Data Layer
  - File-based Persistence (cu-status.json) — CU workflow state
  - Temp File Storage (./temp/ directory) — payloads, streams, logs
  - External API Integration (Semgrep, AI services)
  - Tree-sitter Parser — in-memory source code analysis
```

## 3. Module Dependencies

### Key Dependency Relationships

| Module | Depends On | Type |
|--------|-----------|------|
| Code Understanding (CU) | Tree-sitter Parser, Feature Map, Test Intelligence, Change Intelligence | Internal |
| Agent Loop | Code Intelligence, Test Intelligence, Change Intelligence | Internal |
| Dashboard (EMDashboard) | Code Understanding, Security Tab | Internal |
| Security Tab | Semgrep Integration | Internal |
| Knowledge Package | Code Intelligence | Internal |
| Feature Map | Tree-sitter Parser | Internal |
| Semgrep Integration | (none) | External tool |
| Provider Module | (none) | Internal |

### Circular Dependencies
- **None detected** — the dependency graph appears acyclic.

### External Dependencies
- **Semgrep** — external SAST scanner (installed separately, with friendly install prompt)
- **Tree-sitter** — source code parsing library (npm package)
- **AI Services** — external AI/LLM APIs for intelligence features
- **Node.js runtime** — core runtime dependency

## 4. Key Patterns

### Design Patterns
- **Workflow/Step Pattern** — Code Understanding uses a multi-step workflow with status persistence (10-step CU flow)
- **Repository Pattern** — File-based persistence for CU status (cu-status.json)
- **Observer/Event Pattern** — Agent Loop orchestrates multiple intelligence tools
- **Plugin Architecture** — Semgrep integration as a pluggable scanner
- **MVC (Model-View-Controller)** — Inferred from React frontend + Express backend structure

### State Management
- **File-based persistence** for workflow state (cu-status.json)
- **In-memory state** for runtime analysis (Tree-sitter parsing)
- **UI state** managed within React components (EMDashboard, SecurityTab)

### Routing Approach
- **Server-side routing** via Express (inferred from provider.mjs)
- **Client-side routing** within React application (inferred from dashboard structure)

### Error Handling Strategy
- **Graceful degradation** — Security tab shows install prompt instead of 503 error when Semgrep is not configured
- **Syntax error recovery** — Provider module handles syntax errors (e.g., missing closing brace)
- **Status persistence** — CU step status persists across sessions via file storage

## 5. Entry Points

### Server Entry Point
- **provider.mjs** — Main server module handling API requests and provider logic

### UI Entry Point
- **EMDashboard** — Main dashboard component for the Coding application
- **SecurityTab** — Security results panel within the dashboard

### CLI Entry Points
- **cu_refresh** — Tool for incremental CU updates (command-line tool)
- **semgrep-runner** — CLI for running Semgrep scans (ESM-compatible)

### Other Entry Points
- **Agent Loop** — Automated orchestration of intelligence tools
- **Feature Map** — Source analysis feature extraction tool