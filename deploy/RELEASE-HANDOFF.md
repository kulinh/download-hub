# Release / Handoff Note

## What this repo is
`download-hub` is a deploy-ready demo scaffold for a download portal with:
- Docker / Portainer runtime
- CloudPanel as reverse proxy only
- Cloudflare R2 as primary storage
- Turnstile for public download verification
- username + password + hCaptcha + session-cookie auth for admin

## Canonical production story
- Run app in Docker
- Bind app to `127.0.0.1:3000`
- Let CloudPanel terminate HTTPS and proxy to the container
- Store downloadable artifacts in R2
- Use `/admin/login` → `/admin/r2` for admin workflows

## Current limits
- Demo/sample catalog data may still exist in repo and must not be treated as production truth
- In-memory rate limiting is single-instance only
- Real production correctness still depends on env values, reverse proxy config, and valid R2/captcha credentials

## Operator-critical notes
- Prefer `.env.production.example` for production values
- Use `deploy/DOCKER-DEPLOY.md` as the primary deployment guide
- Use `deploy/PORTAINER-STACK.md` and `deploy/portainer-stack.yml` for Portainer stack deployment
- Use `deploy/MIGRATION-CHECKLIST.md` when migrating from the current local-disk/PM2 deployment
- Use `deploy/OPERATOR-CHECKLIST.md` for go-live validation

## Minimum go-live checks
- `/health` returns 200
- homepage + detail page render
- Turnstile works on public download flow
- `/admin/login` renders hCaptcha
- admin login succeeds and lands on `/admin/r2`
- R2 inventory loads
- at least one real file downloads successfully
- expired token returns 403

## Compatibility note
Legacy PM2/local-disk/X-Accel/bearer-token flows are compatibility-only, not the primary deployment model.
