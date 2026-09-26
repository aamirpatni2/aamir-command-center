# One image for the API (which also serves the dashboard), the worker and migrations.
# docker build -t aamir-command-center .
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app

# Dependencies first (cached until a package.json or the lockfile changes).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/agents/package.json packages/agents/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
# Behind a TLS-intercepting proxy, pass its CA as a build secret (never baked into the image):
#   docker build --secret id=extra_ca,src=/path/to/ca.crt .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=extra_ca \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build:web
# Drop build/test tooling (Vite, Vitest, Playwright, TypeScript…) from the runtime image:
# reinstall production dependencies only, offline from the store the first install filled.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    rm -rf node_modules apps/*/node_modules packages/*/node_modules && \
    pnpm install --prod --frozen-lockfile --offline --ignore-scripts

FROM node:22-slim AS runtime
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist API_HOST=0.0.0.0 API_PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data/uploads /app/data/exports && chown -R node:node /app/data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Default: the API. The worker and migrations override the command (see deploy/docker-compose.yml).
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
