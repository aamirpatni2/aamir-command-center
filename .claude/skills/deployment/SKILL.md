---
name: deployment
description: Deploy or prepare deployment (Docker image, CI, migrations, env, managed Postgres with pgvector, Redis).
---
# Deployment
1. `NODE_ENV=production` refuses placeholder secrets and mocks (see `packages/config`).
2. Enable `vector` + `citext` on the managed database as admin once, then `pnpm db:migrate` on every deploy before starting the API.
3. API and worker share one image with two commands. Web is a static build.
4. Cookies are `Secure` in production; set `WEB_ORIGINS` to the real dashboard origin and serve over HTTPS.
5. Never run `db:seed` in production. Back up Postgres daily.
