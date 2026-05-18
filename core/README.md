# AI Software Factory Portal — Preview Demo

A downloadable React (Vite + TypeScript + Tailwind) project that previews an **Operations Center** style portal.

## Quick start

### Using npm
```bash
npm install
npm run dev
```

### Using yarn
```bash
yarn
yarn dev
```

### Using pnpm
```bash
pnpm install
pnpm dev
```

Open: http://localhost:5173

## What this demo includes
- Operations Center Home: factory status, current runs, today's incidents, suggested next steps
- Asset apps: Orchestrator Viewer / Runbook Library / Node Config Registry / Low-code Node Storybook
- Execution apps: Skill Center / Gates & Lints (Q1–Q4)
- Monitoring app: Report Generator
- Investigation app: Incident Investigator
- Settings: Policies & Audit

## Safety posture (preview)
- External actions are blocked by default (Outbound Gate is manual).
- Skills are simulated in-memory (no real CLI execution).

## Next step (when you connect factoryd)
Replace the in-memory mocks with:
- REST API: /api/status, /api/skills, /api/runs...
- SSE: /api/events for streaming logs/status updates
