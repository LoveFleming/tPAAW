# ────────────────────────────────────────────────────────
# PAAW — Personal AI Assistant Workspace
# Complete sandbox image: PAAW server + CLI tools + data
# ────────────────────────────────────────────────────────

FROM node:22-slim

# ── System deps ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl jq ca-certificates python3 bash \
    # node-pty native build deps
    make g++ python3-dev \
    && rm -rf /var/lib/apt/lists/*

# ── CLI tools (install globally) ──
# These run INSIDE the sandbox — if they break, just rebuild
RUN npm install -g \
    @anthropic-ai/claude-code \
    @qwen-code/qwen-code \
    opencode \
    2>/dev/null || true

WORKDIR /paaw

# ── Copy package files first (for cached npm install) ──
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/context/package.json packages/context/

RUN npm install --production 2>/dev/null || npm install

# ── Copy source ──
COPY packages/ packages/

# ── Build UI ──
RUN npm run build -w @paaw/ui 2>/dev/null || true

# ── Data directory (mounted as volume in production) ──
RUN mkdir -p /paaw/data
VOLUME /paaw/data

# ── Ports ──
EXPOSE 4097 4098

# ── Environment ──
ENV PAAW_ROOT=/paaw \
    PAAW_PORT=4097 \
    PAAW_WS_PORT=4098 \
    NODE_ENV=production

# ── Health check ──
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:4097/api/health || exit 1

# ── Start PAAW ──
CMD ["node", "packages/server/src/paaw-server.mjs"]
