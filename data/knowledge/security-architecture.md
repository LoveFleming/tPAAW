# PAAW Security Architecture

## Overview

PAAW runs entirely inside a Docker sandbox. A lightweight **Bridge** service on the host handles backup, sync, tool proxy, and container management.

```
Host
┌────────────────────────────┐
│  paaw-bridge (:4100)        │   Outside sandbox (safe zone)
│  • Auto backup (cron)       │   • skills/, apps/, workflows/ backed up every 30 min
│  • Sync gate (human review) │   • diff → approve → save to host
│  • Tool proxy (API keys)    │   • keys never enter sandbox
│  • Container management     │   • restart / rebuild / status
└──────────┬─────────────────┘
           │ Docker volume
┌──────────▼─────────────────┐
│  paaw (:4097, :4098)        │   Inside sandbox (danger zone)
│  PAAW server + UI           │   • CLI can do whatever it wants
│  CLI (qwen/claude/opencode) │   • data/ is ephemeral — backups are safe
│  data/ (skills, apps, etc.) │   • rebuild = clean slate
└────────────────────────────┘
```

## Quick Start

### Development (no Docker)

```bash
npm run dev          # PAAW only (all in one process)
npm run dev:bridge   # Bridge service only (for testing)
```

### Production (Docker)

```bash
# 1. Configure
cp .env.example .env
# Edit .env as needed

# 2. Build & start
docker compose up -d

# 3. Open browser
open http://localhost:4097

# 4. Check bridge status
curl http://localhost:4100/health
```

## Bridge API

### Backup

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/backup` | Trigger manual backup |
| `GET`  | `/api/backup` | List all backups |
| `POST` | `/api/backup/restore/:id` | Restore backup to container |

### Sync (Review Gate)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sync/request` | Create sync request (diff sandbox vs backup) |
| `GET`  | `/api/sync/pending` | List pending sync requests |
| `GET`  | `/api/sync/diff/:id` | Get detailed diff for review |
| `POST` | `/api/sync/approve/:id` | Approve — save changes to backup |
| `POST` | `/api/sync/reject/:id` | Reject — discard |

### Tool Proxy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tool/proxy` | Proxy external API call (injects auth) |
| `GET`  | `/api/tool/tokens` | List registered hosts (no keys) |

### Update

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/update/status` | Container status |
| `POST` | `/api/update/restart` | Restart container |
| `POST` | `/api/update/rebuild` | Rebuild image + recreate |

## Backup Strategy

| Data | Auto-backup | Manual sync |
|------|-------------|-------------|
| skills/ | every 30 min | review diff → approve |
| apps/ | every 30 min | review diff → approve |
| workflows/ | every 30 min | review diff → approve |
| crews/ | every 30 min | — |
| system/ | every 30 min | — |
| config/ | every 30 min | — |
| db/ | every 30 min | — |

- Last 20 backups retained automatically
- CLI can destroy anything inside sandbox — backups are always safe
- `docker compose down -v` = nuclear reset, backups survive on host

## Files

```
Dockerfile                        # PAAW sandbox image
docker-compose.yml                # paaw + bridge orchestration
.env.example                      # Config template
packages/server/src/lib/bridge/
└── paaw-bridge.mjs               # Bridge service (backup/sync/tool/update)
```
