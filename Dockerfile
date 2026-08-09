# syntax=docker/dockerfile:1

# ---------- deps ----------
# better-sqlite3 has no prebuilt binary for every platform, so keep a toolchain
# available in this stage only.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

# git: the agent clones and pushes. ripgrep: Claude Code's search tool.
# ca-certificates: TLS to github.com and the Anthropic API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep curl tini \
 && rm -rf /var/lib/apt/lists/*

# The agent itself.
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

# The standalone output already traces better-sqlite3 and its compiled addon,
# built against this same base image.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

RUN mkdir -p /data/workspaces /data/claude-home \
 && git config --system --add safe.directory '*'

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# tini reaps the `claude` and `git` children the app spawns.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
