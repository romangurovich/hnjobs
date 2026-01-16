# Deployment Guide

This document describes the deployment architecture and setup for the HN Jobs application.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                               │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   CI    │  │ Deploy  │  │   Deploy     │  │   Deploy     │      │
│  │  Tests  │  │   API   │  │   Worker     │  │   Admin      │      │
│  └─────────┘  └────┬────┘  └──────┬───────┘  └──────┬───────┘      │
└───────────────────┬┼──────────────┼─────────────────┼───────────────┘
                    ││              │                 │
         ┌──────────┘│              │                 │
         │           │              │                 │
         ▼           ▼              ▼                 ▼
┌─────────────────────────┐  ┌────────────┐  ┌────────────────────┐
│      Cloudflare         │  │ Oracle VM  │  │    Oracle VM       │
│  ┌─────────┐ ┌────────┐ │  │    #1      │  │       #2           │
│  │ Workers │ │ Pages  │ │  │ ┌────────┐ │  │ ┌───────────────┐  │
│  │  (API)  │ │  (UI)  │ │  │ │ Worker │ │  │ │   Admin API   │  │
│  └─────────┘ └────────┘ │  │ └────────┘ │  │ │ + Admin UI    │  │
└─────────────────────────┘  └────────────┘  └───────────────────┘
```

## Components

| Component | Package | Infrastructure | URL |
|-----------|---------|----------------|-----|
| API | `packages/api` | Cloudflare Workers | `https://api.hnjobs.example.com` |
| UI | `packages/ui` | Cloudflare Pages | `https://hnjobs.example.com` |
| Worker | `packages/worker` | Oracle Cloud VM #1 | N/A (background service) |
| Admin API | `packages/admin/api` | Oracle Cloud VM #2 | `https://admin.hnjobs.example.com` |
| Admin UI | `packages/admin/ui` | Oracle Cloud VM #2 | Served by Admin API |

## CI/CD Workflows

### Continuous Integration (`ci.yml`)

Runs on all pushes and pull requests to `main`:
- **Lint**: ESLint checks
- **Typecheck**: TypeScript validation
- **Test**: Bun test suite
- **Build**: Verify UI packages build successfully

### Deployment Workflows

| Workflow | Trigger | Target |
|----------|---------|--------|
| `deploy-api.yml` | Changes to `packages/api/**` or `packages/core/**` | Cloudflare Workers |
| `deploy-ui.yml` | Changes to `packages/ui/**` | Cloudflare Pages |
| `deploy-worker.yml` | Changes to `packages/worker/**` or `packages/core/**` | Oracle VM #1 |
| `deploy-admin.yml` | Changes to `packages/admin/**` | Oracle VM #2 |

All deployment workflows can also be triggered manually via `workflow_dispatch`.

## GitHub Secrets

Configure these secrets in your repository settings:

### Cloudflare

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers and Pages permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

### Oracle Cloud VMs

| Secret | Description |
|--------|-------------|
| `ORACLE_WORKER_HOST` | IP address or hostname of Worker VM |
| `ORACLE_WORKER_SSH_KEY` | SSH private key for Worker VM deploy user |
| `ORACLE_ADMIN_HOST` | IP address or hostname of Admin VM |
| `ORACLE_ADMIN_SSH_KEY` | SSH private key for Admin VM deploy user |

## VM Setup

### Prerequisites

On each Oracle Cloud VM:

1. **Install Bun**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```

2. **Create deploy user**
   ```bash
   sudo useradd -m -s /bin/bash deploy
   sudo mkdir -p /home/deploy/.ssh
   # Add your SSH public key to /home/deploy/.ssh/authorized_keys
   sudo chown -R deploy:deploy /home/deploy/.ssh
   sudo chmod 700 /home/deploy/.ssh
   sudo chmod 600 /home/deploy/.ssh/authorized_keys
   ```

3. **Clone repository**
   ```bash
   sudo mkdir -p /opt/hnjobs
   sudo chown deploy:deploy /opt/hnjobs
   sudo -u deploy git clone https://github.com/your-org/hnjobs.git /opt/hnjobs
   ```

4. **Allow deploy user to restart services**
   ```bash
   echo "deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart hnjobs-worker, /bin/systemctl restart hnjobs-admin" | sudo tee /etc/sudoers.d/deploy
   ```

### Worker VM (Oracle VM #1)

1. **Create systemd service** at `/etc/systemd/system/hnjobs-worker.service`:
   ```ini
   [Unit]
   Description=HN Jobs Temporal Worker
   After=network.target

   [Service]
   Type=simple
   User=deploy
   WorkingDirectory=/opt/hnjobs/packages/worker
   ExecStart=/home/deploy/.bun/bin/bun run src/index.ts
   Restart=on-failure
   RestartSec=10
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

2. **Create environment file** at `/opt/hnjobs/packages/worker/.env`:
   ```bash
   TEMPORAL_ADDRESS=your-temporal-server:7233
   API_URL=https://api.hnjobs.example.com
   API_TOKEN=your-api-token
   ANTHROPIC_API_KEY=your-anthropic-key
   ```

3. **Enable and start service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable hnjobs-worker
   sudo systemctl start hnjobs-worker
   ```

### Admin VM (Oracle VM #2)

1. **Create systemd service** at `/etc/systemd/system/hnjobs-admin.service`:
   ```ini
   [Unit]
   Description=HN Jobs Admin API
   After=network.target

   [Service]
   Type=simple
   User=deploy
   WorkingDirectory=/opt/hnjobs/packages/admin/api
   ExecStart=/home/deploy/.bun/bin/bun run src/server.ts
   Restart=on-failure
   RestartSec=10
   Environment=NODE_ENV=production

   [Install]
   WantedBy=multi-user.target
   ```

2. **Create environment file** at `/opt/hnjobs/packages/admin/api/.env`:
   ```bash
   PORT=3001
   API_URL=https://api.hnjobs.example.com
   ADMIN_UI_ORIGIN=https://admin.hnjobs.example.com
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   JWT_SECRET=your-jwt-secret
   ALLOWED_EMAILS=admin@example.com
   TEMPORAL_ADDRESS=your-temporal-server:7233
   ```

3. **Build Admin UI** (first time):
   ```bash
   cd /opt/hnjobs
   bun install
   cd packages/admin/ui
   bun run build
   ```

4. **Enable and start service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable hnjobs-admin
   sudo systemctl start hnjobs-admin
   ```

5. **Set up reverse proxy** (nginx example):
   ```nginx
   server {
       listen 443 ssl;
       server_name admin.hnjobs.example.com;

       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Cloudflare Setup

### Workers (API)

1. Create a D1 database named `hnjobs-db` in the Cloudflare dashboard
2. Update `packages/api/wrangler.toml` with your database ID
3. Run migrations:
   ```bash
   cd packages/api
   bunx wrangler d1 execute hnjobs-db --remote --file=schema.sql
   ```
4. Set the API token secret:
   ```bash
   bunx wrangler secret put API_TOKEN
   ```

### Pages (UI)

1. Create a Pages project named `hnjobs-ui` in the Cloudflare dashboard
2. Configure environment variables in the Pages settings:
   - `VITE_API_URL`: Your API URL (e.g., `https://api.hnjobs.example.com`)

## Manual Deployment

If you need to deploy manually:

### API
```bash
cd packages/api
bunx wrangler deploy
```

### UI
```bash
cd packages/ui
bun run build
bunx wrangler pages deploy dist --project-name=hnjobs-ui
```

### Worker
```bash
ssh deploy@worker-vm "cd /opt/hnjobs && git pull && bun install && sudo systemctl restart hnjobs-worker"
```

### Admin
```bash
cd packages/admin/ui
bun run build
scp -r dist/* deploy@admin-vm:/opt/hnjobs/packages/admin/ui/dist/
ssh deploy@admin-vm "cd /opt/hnjobs && git pull && bun install && sudo systemctl restart hnjobs-admin"
```

## Monitoring

### Check service status
```bash
# Worker VM
ssh deploy@worker-vm "sudo systemctl status hnjobs-worker"

# Admin VM
ssh deploy@admin-vm "sudo systemctl status hnjobs-admin"
```

### View logs
```bash
# Worker VM
ssh deploy@worker-vm "sudo journalctl -u hnjobs-worker -f"

# Admin VM
ssh deploy@admin-vm "sudo journalctl -u hnjobs-admin -f"
```

## Troubleshooting

### Deployment fails with SSH error
- Verify the SSH key is correctly set in GitHub secrets
- Ensure the deploy user has the correct permissions
- Check that the VM's firewall allows SSH connections

### Service won't start
- Check logs: `sudo journalctl -u <service-name> -n 50`
- Verify environment variables are set
- Ensure all dependencies are installed: `bun install`

### Cloudflare deployment fails
- Verify `CLOUDFLARE_API_TOKEN` has correct permissions
- Check wrangler.toml configuration
- Ensure D1 database exists and is configured
