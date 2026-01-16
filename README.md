# HN Jobs

A job aggregator that scrapes and processes job postings from Hacker News "Who is Hiring" threads using AI-powered extraction.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Public UI  │────▶│   API        │────▶│   D1 DB      │
│  (React/CF)  │     │ (Hono/CF)    │     │ (Cloudflare) │
└──────────────┘     └──────────────┘     └──────────────┘
                            ▲
                            │
┌──────────────┐     ┌──────────────┐
│  Admin UI    │────▶│  Admin API   │
│   (React)    │     │  (Express)   │
└──────────────┘     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   Temporal   │────▶│   Worker     │
                     │   Server     │     │  (Node.js)   │
                     └──────────────┘     └──────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/api` | Public API (Cloudflare Workers + Hono + tRPC) |
| `packages/ui` | Public UI (React + Vite + Tailwind) |
| `packages/core` | Shared types and schemas |
| `packages/worker` | Temporal worker for job processing |
| `packages/admin/api` | Admin API (Express + Google OAuth) |
| `packages/admin/ui` | Admin UI (React + Vite) |

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (for Cloudflare deployments)
- [Temporal](https://temporal.io/) server (for job processing)

## Getting Started

### Install dependencies

```bash
bun install
```

### Set up environment variables

Copy the example env files and configure them:

```bash
cp packages/api/.env.example packages/api/.env
cp packages/ui/.env.example packages/ui/.env
cp packages/worker/.env.example packages/worker/.env
cp packages/admin/api/.env.example packages/admin/api/.env
cp packages/admin/ui/.env.example packages/admin/ui/.env
```

### Set up the database

```bash
cd packages/api
bun run db:migrate
```

### Start development servers

Using tmux (recommended):
```bash
make dev-tmux
```

Or start each service individually:

```bash
# API (Cloudflare Workers local dev)
cd packages/api && bun run dev

# UI
cd packages/ui && bun run dev

# Worker (requires Temporal server)
cd packages/worker && bun run dev

# Admin API
cd packages/admin/api && bun run dev

# Admin UI
cd packages/admin/ui && bun run dev
```

## Development

### Linting

```bash
bun run lint        # Check for issues
bun run lint:fix    # Auto-fix issues
```

### Type Checking

```bash
bun run typecheck
```

### Testing

```bash
bun test
```

### Building

```bash
bun run build
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

### Quick Overview

| Component | Infrastructure |
|-----------|----------------|
| API | Cloudflare Workers |
| UI | Cloudflare Pages |
| Worker | Oracle Cloud VM |
| Admin API + UI | Oracle Cloud VM |

Deployments are automated via GitHub Actions when changes are pushed to `main`.

## Project Structure

```
hnjobs/
├── .github/workflows/     # CI/CD workflows
├── packages/
│   ├── api/              # Public API
│   │   ├── src/
│   │   ├── schema.sql    # D1 database schema
│   │   └── wrangler.toml # Cloudflare config
│   ├── ui/               # Public UI
│   │   └── src/
│   ├── core/             # Shared code
│   │   └── src/
│   ├── worker/           # Temporal worker
│   │   ├── src/
│   │   └── baml/         # BAML AI prompts
│   └── admin/
│       ├── api/          # Admin API
│       └── ui/           # Admin UI
├── scripts/              # Development scripts
├── DEPLOYMENT.md         # Deployment guide
└── README.md
```

## License

Private - All rights reserved
