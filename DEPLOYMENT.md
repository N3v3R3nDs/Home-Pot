# Deployment

Production Home Pot runs at **https://poker.sexyness.app**, served by the
shared Caddy on the home server. Image is built locally (or in CI) and
published to GitHub Container Registry; Portainer pulls and runs the stack.

```
  local / CI                 GHCR                       server
┌──────────────┐         ┌─────────┐          ┌───────────────────────┐
│  docker      │  push   │ ghcr.io │  pull    │  portainer stack      │
│  buildx push │────────▶│  …/pwa  │─────────▶│  docker-compose.prod  │
└──────────────┘         └─────────┘          │  behind Caddy on :443 │
       │                                       └───────────────────────┘
       │ webhook POST
       ▼
  Portainer redeploys stack with newest :latest
```

---

## Architecture

| Component | Where | Notes |
|---|---|---|
| PWA image | `ghcr.io/n3v3r3nds/home-pot-pwa` | Built from [Dockerfile](Dockerfile). Baked at build time with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. |
| Supabase stack | Stock images (postgres, gotrue, postgrest, realtime, kong…) | No build step. Defined in [docker-compose.prod.yml](docker-compose.prod.yml). |
| Caddy | Shared reverse proxy on server at `/opt/caddy/Caddyfile` | Routes `poker.sexyness.app` → `home-pot-pwa:80` and `/rest|/auth|/realtime|/storage|/functions/*` → `home-pot-kong:8000`. |
| Portainer | UI at the server | Holds the stack definition + env vars. Webhook triggers redeploy. |
| DNS | Cloudflare | `poker.sexyness.app` CNAME → `home.kudostrainer.com`, proxied. |

All containers join the external Docker network `web` so Caddy can reach them.

---

## Secrets (set in Portainer stack env)

| Var | Source | Notes |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | Postgres superuser password. |
| `JWT_SECRET` | `openssl rand -hex 32` | Min 32 chars. Signs the two keys below. |
| `ANON_KEY` | JWT signed with `JWT_SECRET`, claim `role=anon` | Public key embedded in the PWA. |
| `SERVICE_ROLE_KEY` | JWT signed with `JWT_SECRET`, claim `role=service_role` | Server-side only; full bypass of RLS. |
| `VITE_SUPABASE_URL` | `https://poker.sexyness.app` | Same-origin so the browser hits Kong via Caddy. |
| `VITE_SUPABASE_ANON_KEY` | Same value as `ANON_KEY` | Baked into the PWA bundle at build. |
| `SITE_URL` | `https://poker.sexyness.app` | Used by GoTrue for redirect allow-list. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Your choice | Supabase Studio basic-auth (not publicly routed, but set anyway). |
| `PWA_IMAGE` | `ghcr.io/n3v3r3nds/home-pot-pwa:latest` | Override to pin to a specific SHA tag. |

Generate the two JWT keys once (see the anon/service-role blocks in
[README.md](README.md#quick-start)) and store them in a password manager.
`VITE_SUPABASE_ANON_KEY` must also be set as a **GitHub Actions secret**
(or passed as `--build-arg` for manual builds) because it's baked at build time.

### GitHub secrets required for CI

- `VITE_SUPABASE_ANON_KEY` — same value as `ANON_KEY`
- `PORTAINER_STACK_WEBHOOK_URL` — from Portainer after stack creation

---

## Deploy flow — manual build & push (fastest)

Use this for everyday iteration. Assumes one-time setup below is done.

```bash
docker buildx build --platform linux/amd64 \
  --build-arg VITE_SUPABASE_URL=https://poker.sexyness.app \
  --build-arg VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
  -t ghcr.io/n3v3r3nds/home-pot-pwa:latest \
  --push . \
&& curl -fsS -X POST "$PORTAINER_WEBHOOK"
```

`--platform linux/amd64` is required (build host is arm64 Mac, server is x86_64).
Put `VITE_SUPABASE_ANON_KEY` and `PORTAINER_WEBHOOK` in your shell rc, not in the repo.

---

## Deploy flow — CI (push to main)

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on the org's
self-hosted runners (`N3v3R3nDs` org, labels `self-hosted,linux,X64,docker`):

1. **lint** — `npm ci` + `npm run lint` + `npm run build` (PRs too).
2. **pwa** — buildx → push to GHCR with tags `latest` (main only), `sha-<short>`, branch name, git tag.
3. **deploy** — POSTs `PORTAINER_STACK_WEBHOOK_URL`. Main branch only.

To redeploy without new code: re-run the latest workflow, or `curl` the webhook directly.

---

## One-time setup

### 1. GitHub repo + GHCR package

Create repo `N3v3R3nDs/Home-Pot`, push the code. After the first image push,
make the package public: https://github.com/users/N3v3R3nD/packages/container/home-pot-pwa/settings
→ "Change visibility" → Public. (Otherwise Portainer needs a pull secret.)

### 2. Local Docker login to GHCR

```bash
echo "$GH_PAT" | docker login ghcr.io -u N3v3R3nD --password-stdin
```

PAT needs `write:packages`, `read:packages`.

### 3. Generate Supabase secrets

See [README.md Quick start](README.md#quick-start) — produces `JWT_SECRET`,
`ANON_KEY`, `SERVICE_ROLE_KEY`. Save them in a password manager.

### 4. Portainer stack

- Stacks → Add stack → name: `home-pot`
- Build method: **Repository**
- Repository URL: `https://github.com/N3v3R3nDs/Home-Pot.git`
- Compose path: `docker-compose.prod.yml`
- Environment variables: everything from the Secrets table above
- **Enable webhook** toggle → copy the webhook URL into your shell rc
  as `PORTAINER_WEBHOOK` (and into the repo's GitHub secret
  `PORTAINER_STACK_WEBHOOK_URL` if using CI)
- Deploy

### 5. Caddy block

Append the `poker.sexyness.app` block in [docs/caddy-snippet.caddyfile](docs/caddy-snippet.caddyfile)
to `/opt/caddy/Caddyfile` on the server, then:

```bash
ssh server 'docker exec caddy caddy reload --config /etc/caddy/Caddyfile'
```

### 6. DNS

Already in place — CNAME `poker` → `home.kudostrainer.com`, Proxied, in Cloudflare.

---

## Verifying a deploy

```bash
# container is running and healthy
ssh server 'docker ps --filter name=home-pot --format "{{.Names}}\t{{.Status}}"'

# PWA serves
curl -sI https://poker.sexyness.app | head -1

# Supabase rest endpoint reachable same-origin
curl -sI https://poker.sexyness.app/rest/v1/ -H "apikey: $VITE_SUPABASE_ANON_KEY" | head -1
```

---

## Rollback

Find the SHA tag you want on GHCR and override the image in the Portainer
stack env:

```
PWA_IMAGE=ghcr.io/n3v3r3nds/home-pot-pwa:sha-abc1234
```

"Update the stack" in Portainer — containers recreate with the pinned image.

---

## Database migrations

Bind-mounted from the repo into the `db` container at first boot only
(see [docker-compose.prod.yml](docker-compose.prod.yml)). To apply a new
migration on an existing deployment:

```bash
ssh server 'docker exec -i home-pot-db psql -U postgres' < supabase/migrations/NN-name.sql
```

(Or use Studio's SQL editor — same thing with a UI.)

Postgres data lives in the Docker volume `home-pot_db-data`. Reset with
`docker compose down -v` **destroys all data** — only do this intentionally.
