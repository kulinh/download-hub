# download-hub

Node.js (Express 5, ESM, single process) download portal, repo `kulinh/download-hub`. Runs on **HKG-1** at `:3000` as systemd `download-hub.service`; public host `download.888vn.net` goes Cloudflare -> tunnel -> nginx `127.0.0.1:8090` vhost -> `:3000` (the app listens on `*:3000`, UFW blocks it publicly). Node v24 on HKG-1.

## Build and test
`npm ci && npm test` (vitest); `npm run dev` for local; `npm run check` runs `scripts/check-startup.mjs`. Config comes from environment variables (see `src/config.js`, `deploy/README.md`).

## Deploy (from HQ-01)
- `deploy/deploy.sh` builds `git archive HEAD` (so **commit first**; the HQ-01 checkout has untracked files that are never shipped), runs `npm ci`, `npm test`, `npm prune --omit=dev`, ships `app.tar.gz`, swaps `/opt/download-hub/app` on HKG-1 (previous kept as `app.prev`), restarts, health-checks `/health` and `/`, and restores `app.prev` on failure. Rollback: `deploy/deploy.sh rollback`. Never deploy onto HQ-01.
- Unit `deploy/download-hub.service` (WorkingDirectory `/opt/download-hub/app`, `ExecStart=/usr/bin/node src/server.js`, env from `/run/t43vault/download-hub/env` via `ExecStartPre=+ t43vault fetch`, the `EnvironmentFile=-` dash is required because /run is empty after reboot) and drop-in `deploy/10-user.conf` (runs as system user `dlhub`, `ProtectSystem=strict`, writable only `data/`, `src/data/`, `storage/`; `ExecStartPre=+chown` fixes ownership after root deploys).
- Data is not part of the release: it stays in `/opt/download-hub/{data,src/data,storage}` on HKG-1 (absolute paths in the env).

## Secrets and auth
- Env (incl. secrets) lives in t43vault app `download-hub` (grant hkg-1); there is no `.env` on the node. Change one key: `t43vault set download-hub KEY < value`, then `systemctl restart download-hub`.
- Admin sign-in is T43iD through a Cloudflare Access app on `/admin`, `/admin/*`, `/api/admin/*`; the Access JWT is verified with `T43ID_ACCESS_AUD` (vault). When that variable is set, password + hCaptcha sign-in is off. `ADMIN_BEARER_TOKEN` is off in production by design, so a 401 at `/api/admin` is correct.

## Traps
- Under `ProtectSystem=strict` any new writable path must be added to `ReadWritePaths` in `10-user.conf`.
- Do not run it under PM2 (dropped 2026-06-13); systemd only.
