# Baseful

![Baseful preview](https://raw.githubusercontent.com/getbaseful/baseful/refs/heads/main/preview.png)

Baseful is an open-source, self-hostable platform for managing PostgreSQL databases, inspired by the developer experience of Neon.

It gives you a web dashboard, a built-in Postgres proxy with token-based auth, backup workflows, monitoring, and container lifecycle management on your own infrastructure.

## What Baseful Includes

- Postgres database provisioning and lifecycle controls
- Token-based connection strings through a built-in proxy on port `6432`
- SQL editor and table explorer in the web UI
- Database metrics and active connection monitoring
- Backup + restore flows with S3-compatible object storage support
- Optional backup encryption (PGP public key)
- User auth, admin whitelist management, and profile settings
- Domain + SSL provisioning support for dashboard access

## Project Status

Baseful is an early-stage project, actively developed and production-tested on Ubuntu 24.04 LTS VPS, but some important capabilities are still being expanded.

Current focus areas include:

- Stronger and more granular connection limit controls
- Additional production hardening and operational safeguards
- Further UX and workflow improvements across database operations

## Architecture

Baseful is a monorepo with:

- `backend/`: Go (`gin`) API + Postgres proxy + Docker orchestration + SQLite metadata DB
- `frontend/`: React + Vite dashboard
- Root `Dockerfile`: multi-stage build (frontend + backend)
- Root `docker-compose.yml`: single `baseful` service with Docker socket access (this is under reconsideration)

Baseful manages Postgres database containers through the local Docker engine and places them on the `baseful-network` Docker network.

## Requirements

- Ubuntu 24.04 LTS VPS (production-tested target)
- Docker Engine
- Docker Compose (`docker compose` plugin or `docker-compose`)
- Git
- Open ports:
  - `3000` (dashboard/API in Docker setup)
  - `6432` (database proxy)
  - `80` and `443` (domain/SSL features)

## Platform Notes

- Baseful is intended for VPS deployment.
- Production testing has been done on **Ubuntu 24.04 LTS**.
- Development has been done on a **MacBook Air M4 (2025)**.

## Quick Install (Recommended)

One-command install:

```bash
curl -sSL https://raw.githubusercontent.com/getbaseful/baseful/refs/heads/main/install.sh | bash
```

What the installer does:

1. Installs Docker/Git if missing
2. Clones Baseful into `/opt/baseful`
3. Creates `.env` from `backend/.env.example`
4. Generates a secure `JWT_SECRET`
5. Auto-detects `PUBLIC_IP`
6. Creates `baseful-network`
7. Builds and starts Baseful with Docker Compose
8. Optionally applies security hardening (`ufw`, `fail2ban`, unattended upgrades)

After install:

- Dashboard: `http://<PUBLIC_IP>:3000`
- Proxy: `<PUBLIC_IP>:6432`

## Manual Self-Hosted Setup (Docker Compose)

```bash
git clone https://github.com/getbaseful/baseful.git
cd baseful
cp backend/.env.example .env
```

Set at minimum in `.env`:

- `JWT_SECRET` (32+ chars)
- `PUBLIC_IP` (server IP or DNS name)

Create the Docker network (required):

```bash
docker network create baseful-network
```

Start:

```bash
docker compose up -d --build
```

Open:

- `http://localhost:3000` (or your server IP/domain on port `3000`)

## Local Development

### 1) Start backend (Go API)

From repo root:

```bash
cp backend/.env.example .env
export PORT=8080
export DB_PATH=./backend/data.db
```

Ensure Docker network exists:

```bash
docker network create baseful-network
```

Run backend:

```bash
cd backend
go run .
```

### 2) Start frontend (Vite)

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/uploads` to `http://localhost:8080`.

## First-Time App Setup

1. Open Baseful in your browser
2. Register the first account (first user becomes admin)
3. Create a project
4. Create your first Postgres database
5. Generate/rotate tokens and use the provided connection string via proxy `:6432`

## Common Operations

View logs:

```bash
docker compose logs -f
```

Check proxy logs (install-script path):

```bash
tail -f /var/log/proxy/proxy.log
```

Update an existing install:

```bash
curl -sSL https://raw.githubusercontent.com/getbaseful/baseful/refs/heads/main/install.sh | bash -s -- update
```

Uninstall (destructive):

```bash
bash uninstall.sh
```

## Configuration Notes

Important environment variables:

- `PUBLIC_IP`: used when generating connection details
- `JWT_SECRET`: auth signing secret (must be strong)
- `PROXY_PORT`: default `6432`
- `PROXY_SSL_ENABLED`: enable/disable proxy TLS behavior
- `PROXY_IDLE_TIMEOUT`: default `30m`
- `PROXY_QUERY_TIMEOUT`: default `5m`
- `PROXY_REVOCATION_CHECK`: token revocation checks
- `DOCKER_NETWORK`: default `baseful-network`

In Docker Compose mode, `PORT` is set to `3000` for the web/API service.

## Data & Persistence

By default, Docker Compose mounts:

- `./backend-data` -> SQLite app data (`/app/data`)
- `./caddy-data` -> Caddy certificates/state
- `/var/log/proxy` -> proxy logs

Back up these paths for disaster recovery.

## Security Considerations

- Baseful container has access to `/var/run/docker.sock` to manage database containers.
- Restrict host access and firewall exposed ports.
- Use strong `JWT_SECRET` and rotate tokens when needed.
- Prefer TLS + domain setup for production deployments.
- Enable encrypted backups when using external object storage.

## License

This repository is licensed under **Functional Source License 1.1 (FSL-1.1-ALv2)** with a future Apache-2.0 license grant. See [LICENSE](./LICENSE).
