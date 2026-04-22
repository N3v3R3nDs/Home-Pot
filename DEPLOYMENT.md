# Deployment

Production Home Pot runs at **https://poker.sexyness.app**, served by the
shared Caddy on the home server. Three images are built locally, pushed to
GitHub Container Registry, then Portainer pulls and runs them.

```
  local (arm64 Mac)                   GHCR                       server (x86_64)
┌────────────────────┐     push     ┌─────────┐     pull     ┌─────────────────────┐
│  docker buildx     │──linux/amd64▶│ ghcr.io │─────────────▶│  portainer stack    │
│  (pwa, db, kong-c) │              │  …/*    │              │  behind Caddy :443  │
└────────────────────┘              └─────────┘              └─────────────────────┘
           │                                                            ▲
           └────── curl $PORTAINER_WEBHOOK ─────────────────────────────┘
                        (tells Portainer: pull :latest, recreate)
```

---

## Day-to-day: pushing a code change

From the repo root on your Mac:

```bash
./scripts/deploy.sh
```

That's it. Script lives at [scripts/deploy.sh](scripts/deploy.sh) — it builds
the PWA (the image that changes most), pushes to GHCR, and hits the Portainer
webhook to trigger a redeploy. Takes ~60-90s after the first build (cached).

The DB and kong-config images rarely change — rebuild them only when you edit
`supabase/migrations/` or `supabase/kong.yml`:

```bash
./scripts/deploy.sh --all   # rebuild pwa + db + kong-config
```

---

## One-time setup (already done, documented for rebuild)

### Required env on your Mac

Put these in `~/.zshrc` (or wherever):

```bash
export VITE_SUPABASE_ANON_KEY='eyJ...'                 # from 1Password
export PORTAINER_WEBHOOK='https://.../api/stacks/webhooks/<uuid>'
```

The anon key is the same JWT that's in the Portainer stack's env vars
(baked into the PWA bundle at build time).

### GHCR login

```bash
echo "$GH_PAT" | docker login ghcr.io -u N3v3R3nD --password-stdin
```

PAT at https://github.com/settings/tokens with scopes:
`write:packages`, `read:packages`, `delete:packages`.

### Portainer webhook

Portainer UI → Stacks → **home-pot** → Settings → enable webhook toggle →
copy URL into `$PORTAINER_WEBHOOK`.

---

## Architecture

| Component | Where | Notes |
|---|---|---|
| PWA | `ghcr.io/n3v3r3nds/home-pot-pwa` | Built from [Dockerfile](Dockerfile). `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` baked at build time. |
| DB | `ghcr.io/n3v3r3nds/home-pot-db` | Built from [Dockerfile.db](Dockerfile.db). `supabase/postgres:15.6.1.139` + all `supabase/migrations/*` copied into `/docker-entrypoint-initdb.d/` with `zz-` prefix so they run after the image's own role-creation scripts. |
| Kong config | `ghcr.io/n3v3r3nds/home-pot-kong-config` | Built from [Dockerfile.kong-config](Dockerfile.kong-config). Alpine + envsubst + `supabase/kong.yml` template. Runs once at stack start, writes resolved config to shared volume. |
| Supabase stack | Stock images | auth (gotrue), rest (postgrest), realtime, studio, meta, kong — all pulled unchanged. See [docker-compose.prod.yml](docker-compose.prod.yml). |
| Caddy | Shared `/opt/caddy/Caddyfile` | Routes `/rest\|/auth\|/realtime\|/storage\|/functions/*` → `home-pot-kong:8000`, everything else → `home-pot-pwa:80`. |
| Portainer | Stack `home-pot` (git-backed from `main`) | Env vars set in stack UI. Redeploy = pull `:latest` + recreate. |
| DNS | Cloudflare | `poker.sexyness.app` CNAME → `home.kudostrainer.com`, proxied. |

All containers join the external Docker network `web` so Caddy can reach them.

### Why custom DB + kong-config images?

Portainer-deployed git stacks **can't resolve `./relative-path` bind mounts**.
Docker daemon looks for those paths on the host filesystem, but the git clone
lives inside Portainer's container volume — the paths don't line up, so Docker
auto-creates empty directories and init scripts silently break.

Baking the files into images sidesteps the whole path-resolution problem.
Downside: editing a migration means a rebuild. Acceptable since it's rare.

---

## Stack secrets (in Portainer env vars)

| Var | Notes |
|---|---|
| `POSTGRES_PASSWORD` | Postgres superuser password. Also used by every Supabase service role (set via `00-roles.sh`). |
| `JWT_SECRET` | 32+ char random. Signs `ANON_KEY` and `SERVICE_ROLE_KEY`. **Losing this breaks every session.** |
| `ANON_KEY` | Public JWT, `role=anon`. Also set as `VITE_SUPABASE_ANON_KEY` (baked into PWA) — values must match. |
| `SERVICE_ROLE_KEY` | Admin JWT, `role=service_role`. Server-side only, bypasses RLS. |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Supabase Studio basic-auth. Studio is internal-only (not routed publicly). |
| `VITE_SUPABASE_URL` | `https://poker.sexyness.app` |
| `SITE_URL` | `https://poker.sexyness.app` (GoTrue redirect allow-list) |
| `PWA_IMAGE` / `DB_IMAGE` / `KONG_CONFIG_IMAGE` | Optional override, e.g. `ghcr.io/n3v3r3nds/home-pot-pwa:sha-abc1234` for rollback. Defaults to `:latest`. |

Stored in 1Password — see shared vault.

---

## Verifying a deploy

```bash
# public endpoints reachable
curl -sI https://poker.sexyness.app | head -1
curl -sI https://poker.sexyness.app/rest/v1/ -H "apikey: $VITE_SUPABASE_ANON_KEY" | head -1

# containers healthy on the server
ssh server 'docker ps --filter name=home-pot --format "{{.Names}}\t{{.Status}}"'

# db init ran cleanly (only needed after fresh volume)
ssh server 'docker logs home-pot-db 2>&1 | grep -E "ALTER ROLE|CREATE SCHEMA" | head'
```

`home-pot-studio` will always show `(unhealthy)` — its healthcheck is strict
and we don't route to it publicly. Ignore it.

---

## Rollback

Find the SHA tag you want on GHCR (GitHub UI → Packages → home-pot-pwa →
versions), then either:

**A)** Override in Portainer env:
```
PWA_IMAGE=ghcr.io/n3v3r3nds/home-pot-pwa:sha-abc1234
```
Save → "Update the stack" → containers recreate pinned to that SHA.

**B)** Retag and push `latest`:
```bash
docker pull ghcr.io/n3v3r3nds/home-pot-pwa:sha-abc1234
docker tag ghcr.io/n3v3r3nds/home-pot-pwa:sha-abc1234 ghcr.io/n3v3r3nds/home-pot-pwa:latest
docker push ghcr.io/n3v3r3nds/home-pot-pwa:latest
curl -X POST "$PORTAINER_WEBHOOK"
```

---

## Reset (wipe all data)

Deletes the DB volume — **every session, player, bank entry lost**. Only for
hard resets.

```bash
ssh server 'docker compose -p home-pot down -v'
# then redeploy via Portainer UI: Stacks → home-pot → Update the stack
```

The `zz-*` init scripts in `home-pot-db` will re-run on the fresh volume.

---

## Database access for ops

```bash
ssh server 'docker exec -it home-pot-db psql -U postgres'
# or for a migration file from the repo:
ssh server 'docker exec -i home-pot-db psql -U postgres' < supabase/migrations/05-new.sql
```

For UI access, tunnel Studio (it's on the internal network only):
```bash
ssh -L 8001:localhost:8000 server    # then open http://localhost:8001
# (Studio is served through Kong at /; HTTP Basic with DASHBOARD_USERNAME/PASSWORD)
```

---

## Adding a new migration

1. Drop a new file in `supabase/migrations/` named `NN-<name>.sql` (next sequential number).
2. `./scripts/deploy.sh --all` to rebuild the `home-pot-db` image.
3. **First deploy only** — the migration runs on fresh volumes. On an existing
   volume, apply it manually once:
   ```bash
   ssh server 'docker exec -i home-pot-db psql -U postgres' < supabase/migrations/NN-new.sql
   ```
