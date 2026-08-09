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
    PORT=3006 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data

# git: the agent clones and pushes. ripgrep: Claude Code's search tool.
# ca-certificates: TLS to github.com and the Anthropic API.
# gosu: drops root in the entrypoint (see docker-entrypoint.sh).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep curl tini gosu \
 && rm -rf /var/lib/apt/lists/*

# The agent itself.
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

# The standalone output already traces better-sqlite3 and its compiled addon,
# built against this same base image.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/workspaces /data/claude-home \
 && chown -R node:node /data /app \
 && git config --system --add safe.directory '*'

VOLUME ["/data"]
EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3006/api/health || exit 1

# tini reaps the `claude` and `git` children the app spawns. The entrypoint
# fixes /data ownership, then hands over to the unprivileged `node` user —
# Claude Code rejects --dangerously-skip-permissions when running as root.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
