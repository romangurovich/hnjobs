# Deployment Guide

This document describes the deployment architecture and setup for the HN Jobs application.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              GitHub Actions                                   │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   CI    │  │ Deploy  │  │   Deploy     │  │   Deploy     │               │
│  │  Tests  │  │   API   │  │   Workers    │  │   Admin      │               │
│  └─────────┘  └────┬────┘  └──────┬───────┘  └──────┬───────┘               │
└───────────────────┬┼──────────────┼─────────────────┼────────────────────────┘
                    ││              │                 │
         ┌──────────┘│              │                 │
         │           │              │                 │
         ▼           ▼              ▼                 ▼
┌─────────────────────────┐  ┌─────────────────────────────┐  ┌────────────────┐
│      Cloudflare         │  │   Oracle ARM VMs (Pool)     │  │  Oracle AMD VM │
│  ┌─────────┐ ┌────────┐ │  │  ┌────────┐   ┌────────┐   │  │ ┌────────────┐ │
│  │ Workers │ │ Pages  │ │  │  │Worker 1│   │Worker 2│   │  │ │ Admin API  │ │
│  │  (API)  │ │  (UI)  │ │  │  │1CPU/6GB│   │1CPU/6GB│   │  │ │ + Caddy    │ │
│  └─────────┘ └────────┘ │  │  └───┬────┘   └────┬───┘   │  │ │ (1/8 CPU)  │ │
└─────────────────────────┘  │      │             │       │  └───────┬────────┘
                             └──────┼─────────────┼───────┘          │
                                    │             │                  │
                                    ▼             ▼                  ▼
                             ┌─────────────────────────────────────────────┐
                             │         Oracle ARM VM - Temporal            │
                             │  ┌─────────────┐  ┌────────┐  ┌──────────┐ │
                             │  │  Temporal   │  │  Web   │  │PostgreSQL│ │
                             │  │ Server:7233 │  │UI:8080 │  │ Database │ │
                             │  └─────────────┘  └────────┘  └──────────┘ │
                             │               2 OCPU / 12GB                 │
                             └─────────────────────────────────────────────┘
```

## Components

| Component | Package | Infrastructure | URL |
|-----------|---------|----------------|-----|
| API | `packages/api` | Cloudflare Workers | `https://api.hnjobs.example.com` |
| UI | `packages/ui` | Cloudflare Pages | `https://hnjobs.example.com` |
| Workers | `packages/worker` | Oracle ARM VMs (x2 pool) | N/A (background service) |
| Admin API | `packages/admin/api` | Oracle AMD VM | `https://admin.hnjobs.example.com` |
| Admin UI | `packages/admin/ui` | Oracle AMD VM | Served by Admin API |
| Temporal | (self-hosted) | Oracle ARM VM | `http://<temporal-ip>:8080` (UI) |

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
| `deploy-worker.yml` | Changes to `packages/worker/**` or `packages/core/**` | Oracle ARM VMs (x2 in parallel) |
| `deploy-admin.yml` | Changes to `packages/admin/**` | Oracle AMD VM |

All deployment workflows can also be triggered manually via `workflow_dispatch`.
Use branch protection on `main` to require `CI` before merge so deployment runs only on validated commits.

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
| `ORACLE_WORKER_1_HOST` | IP address of Worker VM 1 (ARM) |
| `ORACLE_WORKER_2_HOST` | IP address of Worker VM 2 (ARM) |
| `ORACLE_WORKER_SSH_KEY` | SSH private key for Worker VMs deploy user |
| `ORACLE_ADMIN_HOST` | IP address of Admin VM (AMD) |
| `ORACLE_ADMIN_SSH_KEY` | SSH private key for Admin VM deploy user |
| `TEMPORAL_ADDRESS` | Temporal server address (e.g., `<temporal-ip>:7233`) |

## Oracle Cloud Infrastructure Setup

### Automated Setup (Recommended)

Use the OCI setup script to automatically provision all Oracle Cloud infrastructure:

```bash
# Make the script executable
chmod +x scripts/oci-setup.sh

# Run the setup script
./scripts/oci-setup.sh
```

The script will:
1. **Verify prerequisites** - Check OCI CLI installation and authentication
2. **Gather configuration** - Prompt for compartment, region, SSH key, and admin domain
3. **Create networking** - VCN, Internet Gateway, Route Table, Security List, Subnet
4. **Provision VMs** - Two ARM A1.Flex VMs (Always Free tier) with cloud-init
5. **Generate output** - Save all resource IDs to `scripts/infra-output.json`

#### Resources Created

| Resource | Name | Details |
|----------|------|---------|
| VCN | `hnjobs-vcn` | 10.0.0.0/16 CIDR |
| Internet Gateway | `hnjobs-igw` | Public internet access |
| Route Table | `hnjobs-rt` | Routes 0.0.0.0/0 to IGW |
| Security List | `hnjobs-sl` | Ingress: SSH, HTTP, HTTPS, Temporal (7233, 8080) |
| Subnet | `hnjobs-subnet` | 10.0.1.0/24 (public) |
| Worker VM 1 | `hnjobs-worker-1` | ARM A1.Flex, 1 OCPU, 6GB RAM |
| Worker VM 2 | `hnjobs-worker-2` | ARM A1.Flex, 1 OCPU, 6GB RAM |
| Temporal VM | `hnjobs-temporal` | ARM A1.Flex, 2 OCPU, 12GB RAM + PostgreSQL + Docker |
| Admin VM | `hnjobs-admin` | AMD E2.1.Micro, 1/8 OCPU, 1GB RAM + Caddy |
| Notification Topic | `hnjobs-alerts` | Email alerts for alarms |
| Alarms | 8 total | CPU + health for each VM (incl. Temporal) |
| Log Group | `hnjobs-logs` | Container for application logs |
| Custom Logs | 3 total | worker, admin, caddy |
| Agent Config | `hnjobs-logging-config` | Log shipping configuration |

#### Free Tier Usage

| Resource | Used | Total | Remaining |
|----------|------|-------|-----------|
| ARM OCPUs | 4 | 4 | 0 |
| ARM Memory | 24GB | 24GB | 0GB |
| AMD Micro | 1 | 1 | 0 |

#### Post-Setup Steps

After running the script:

1. **Wait for Temporal** - The Temporal VM takes 5-10 minutes for Docker to pull images
   ```bash
   # Verify Temporal is running
   ssh deploy@<temporal-ip> 'docker ps'
   # Should show: temporal-server, temporal-ui, temporal-postgresql
   ```
2. **Configure DNS** - Add A record pointing your admin domain to the Admin VM IP
3. **Clone repository**:
   ```bash
   ssh deploy@<vm-ip>
   git clone <your-repo-url> /opt/hnjobs
   cd /opt/hnjobs && bun install
   ```
   Notes:
   - Worker bootstrap attempts this automatically using the `REPO_URL` entered in `scripts/oci-setup.sh`.
   - Admin VM still requires this step if `/opt/hnjobs` does not already exist.
4. **Create .env files** from templates - set `TEMPORAL_ADDRESS` to Temporal VM IP:
   ```bash
   TEMPORAL_ADDRESS=<temporal-ip>:7233
   ```
5. **Start services**:
   ```bash
   # On Worker VMs (both)
   sudo systemctl start hnjobs-worker
   
   # On Admin VM
   sudo systemctl start hnjobs-admin
   ```
6. **Add GitHub Secrets** - The script outputs the values needed:
   - `ORACLE_WORKER_1_HOST` - Worker VM 1 IP
   - `ORACLE_WORKER_2_HOST` - Worker VM 2 IP
   - `ORACLE_WORKER_SSH_KEY` - SSH key for workers
   - `ORACLE_ADMIN_HOST` - Admin VM IP
   - `ORACLE_ADMIN_SSH_KEY` - SSH key for admin
   - `TEMPORAL_ADDRESS` - Temporal server address

## Temporal (Self-Hosted)

The infrastructure includes a self-hosted Temporal server running on Oracle Cloud.

### Architecture

| Component | Port | Description |
|-----------|------|-------------|
| Temporal Server | 7233 | gRPC endpoint for workers and clients |
| Temporal UI | 8080 | Web interface for workflow management |
| PostgreSQL | 5432 | Internal persistence (Docker network only) |

### Accessing Temporal

**Web UI:** `http://<temporal-ip>:8080`

The Temporal UI provides:
- Workflow execution history
- Task queue monitoring  
- Namespace management
- Schedule management

**gRPC (for workers/clients):** `<temporal-ip>:7233`

### Configuration

Workers and Admin API connect to Temporal via environment variable:

```bash
TEMPORAL_ADDRESS=<temporal-ip>:7233
TEMPORAL_NAMESPACE=default
```

### Managing Temporal

```bash
# SSH into Temporal VM
ssh deploy@<temporal-ip>

# View running containers
docker ps

# View Temporal logs
docker logs -f temporal-server

# View PostgreSQL logs
docker logs -f temporal-postgresql

# Restart Temporal stack
sudo systemctl restart temporal

# Check Temporal health
docker exec temporal-server temporal operator cluster health
```

### Temporal Admin Tools

The `temporal-admin-tools` container provides CLI access:

```bash
# Execute commands in admin-tools container
docker exec -it temporal-admin-tools bash

# Inside container, use tctl or temporal CLI
temporal workflow list
temporal namespace list
```

### Manual Setup

If you prefer to set up VMs manually or already have existing infrastructure:

## VM Setup (Manual)

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
   TEMPORAL_ADDRESS=<temporal-vm-ip>:7233
   TEMPORAL_NAMESPACE=default
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
   PORT=8081
   API_URL=https://api.hnjobs.example.com
   ADMIN_UI_ORIGIN=https://admin.hnjobs.example.com
   TEMPORAL_ADDRESS=<temporal-vm-ip>:7233
   TEMPORAL_NAMESPACE=default
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   JWT_SECRET=your-jwt-secret-at-least-32-characters
   ALLOWED_EMAILS=admin@example.com
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

5. **Set up reverse proxy**:

   **Option A: Caddy (Recommended - automatic HTTPS)**
   
   Caddy is installed automatically by the OCI setup script. Configuration is at `/etc/caddy/Caddyfile`:
   ```
   admin.hnjobs.example.com {
     reverse_proxy localhost:8081
     encode gzip zstd
   }
   ```
   
   Reload after changes: `sudo systemctl reload caddy`

   **Option B: Nginx (manual SSL)**
   ```nginx
   server {
       listen 443 ssl;
       server_name admin.hnjobs.example.com;

       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;

       location / {
           proxy_pass http://127.0.0.1:8081;
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
   For an existing database that should keep its data, run the incremental
   `listing_month` migration instead:
   ```bash
   cd packages/api
   bun run db:migrate:listing-month:remote
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

### Workers
```bash
# Deploy to both worker VMs
for host in worker-1-ip worker-2-ip; do
  ssh deploy@$host "cd /opt/hnjobs && git switch main || git switch -c main --track origin/main && git pull --ff-only origin main && bun install --frozen-lockfile && sudo systemctl restart hnjobs-worker"
done
```

### Admin
```bash
cd packages/admin/ui
bun run build
scp -r dist/* deploy@admin-vm:/opt/hnjobs/packages/admin/ui/dist/
ssh deploy@admin-vm "cd /opt/hnjobs && git switch main || git switch -c main --track origin/main && git pull --ff-only origin main && bun install --frozen-lockfile && sudo systemctl restart hnjobs-admin"
```

## Monitoring & Logging

### OCI Monitoring (Cloud Console)

The setup script configures OCI Monitoring with:

| Alarm | Threshold | Severity |
|-------|-----------|----------|
| `hnjobs-worker-1-high-cpu` | >80% for 5min | Warning |
| `hnjobs-worker-2-high-cpu` | >80% for 5min | Warning |
| `hnjobs-temporal-high-cpu` | >80% for 5min | Warning |
| `hnjobs-admin-high-cpu` | >90% for 5min | Warning |
| `hnjobs-worker-1-health` | Instance not running | Critical |
| `hnjobs-worker-2-health` | Instance not running | Critical |
| `hnjobs-temporal-health` | Instance not running | Critical |
| `hnjobs-admin-health` | Instance not running | Critical |

### OCI Logging (Centralized Logs)

The setup script creates centralized logging with:

| Log | Source | Description |
|-----|--------|-------------|
| `hnjobs-worker` | Worker VMs | Temporal worker service logs |
| `hnjobs-admin` | Admin VM | Admin API service logs |
| `hnjobs-caddy` | Admin VM | Caddy reverse proxy access logs |

**Log Group:** `hnjobs-logs`

#### Agent Configuration (Manual Setup Required)

The Unified Monitoring Agent requires an Agent Configuration to ship logs.

> **Note:** Creating agent configurations via CLI/API often fails due to IAM permissions. 
> Manual setup via OCI Console is recommended.

**Create via OCI Console:**

1. Navigate to [Agent Configurations](https://cloud.oracle.com/logging/agent-configs) in your region
2. Click **Create agent config**

**Step 1 - Basic Information:**

| Field | Value | Required |
|-------|-------|----------|
| **Name** | `hnjobs-logging-config` | ✓ |
| **Compartment** | Your compartment (e.g., `romanpro (root)`) | ✓ |
| **Description** | HN Jobs centralized log collection | |
| **Configuration Type** | `Logging` | ✓ |

**Step 2 - Host Groups:**

Select which instances this configuration applies to:

| Option | When to Use |
|--------|-------------|
| **All instances in compartment** | Simplest option - applies to all VMs in compartment |
| **Dynamic Group** | If you created a dynamic group for hnjobs instances |

**Step 3 - Log Inputs (add 3 sources):**

| Name | Log Path | Parser Type |
|------|----------|-------------|
| `syslog` | `/var/log/messages` | `SYSLOG` |
| `worker-logs` | `/opt/hnjobs/packages/worker/*.log` | `NONE` |
| `caddy-access` | `/var/log/caddy/access.log` | `JSON` |

For each log input, configure:
- **Name**: Friendly identifier
- **File Paths**: Glob pattern for log files
- **Parser**: `NONE`, `SYSLOG`, `JSON`, `GROK`, `CSV`, etc.
- **Advanced** (optional): `is_read_from_head` = false (tail new entries only)

**Step 4 - Log Destination:**

| Field | Value |
|-------|-------|
| **Log Group** | `hnjobs-logs` |
| **Log Name** | `hnjobs-worker` or `hnjobs-admin` |

4. Review and click **Create**

#### Required IAM Policies

Add these policies to your tenancy (**Identity → Policies**):

```text
# Allow instances to write logs (using instance principal)
allow any-user to use log-content in compartment <your-compartment> where request.principal.type='instance'

# If using the CLI/API to create agent configs, you also need:
allow group <your-group> to manage unified-agent-configuration in compartment <your-compartment>
allow group <your-group> to manage log-groups in compartment <your-compartment>
```

**Alternative: Dynamic Group approach** (more secure):

```text
# Step 1: Create a Dynamic Group (Identity → Dynamic Groups)
# Name: hnjobs-instances
# Rule:
all {instance.compartment.id = '<your-compartment-ocid>'}

# Step 2: Add Policies (Identity → Policies)
allow dynamic-group hnjobs-instances to use log-content in compartment <your-compartment>
allow dynamic-group hnjobs-instances to read unified-agent-configurations in compartment <your-compartment>
```

#### Verify Agent is Working

SSH into an instance and check:

```bash
# Check agent status
sudo systemctl status unified-monitoring-agent

# View agent logs
sudo journalctl -u unified-monitoring-agent -f

# Verify config was pulled
sudo cat /etc/unified-monitoring-agent/unified-monitoring-agent.yaml
```

**Access in OCI Console:**
- **Metrics**: Observability → Monitoring → Metrics Explorer
- **Alarms**: Observability → Monitoring → Alarm Definitions
- **Logs**: Observability → Logging → Log Groups → hnjobs-logs
- **Log Search**: Observability → Logging → Log Search
- **Notifications**: Developer Services → Notifications → Topics

### Log Search Examples

In OCI Console → Logging → Log Search, use these queries:

```
# All worker errors
search "hnjobs-logs/hnjobs-worker" | error

# Admin API requests
search "hnjobs-logs/hnjobs-admin" | sort by datetime desc

# Caddy 5xx errors
search "hnjobs-logs/hnjobs-caddy" | status >= 500
```

### Check Monitoring Agent
```bash
# Verify agent is running on each VM
ssh deploy@<vm-ip> "sudo systemctl status unified-monitoring-agent"
```

### Check service status
```bash
# Worker VMs (check both)
ssh deploy@worker-1-ip "sudo systemctl status hnjobs-worker"
ssh deploy@worker-2-ip "sudo systemctl status hnjobs-worker"

# Admin VM
ssh deploy@admin-ip "sudo systemctl status hnjobs-admin"
ssh deploy@admin-ip "sudo systemctl status caddy"
```

### View logs
```bash
# Worker VMs
ssh deploy@worker-1-ip "sudo journalctl -u hnjobs-worker -f"
ssh deploy@worker-2-ip "sudo journalctl -u hnjobs-worker -f"

# Admin VM
ssh deploy@admin-ip "sudo journalctl -u hnjobs-admin -f"
ssh deploy@admin-ip "tail -f /var/log/caddy/access.log"
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

### Temporal connection fails
- Verify Temporal VM is running: `ssh deploy@<temporal-ip> 'docker ps'`
- Check port 7233 is accessible from workers/admin
- Verify `TEMPORAL_ADDRESS` is set correctly in .env files
- Check Temporal logs: `ssh deploy@<temporal-ip> 'docker logs temporal-server'`

### Temporal UI not accessible
- Verify port 8080 is open in OCI security list
- Check Temporal containers are running: `docker ps`
- Restart Temporal stack: `sudo systemctl restart temporal`

### Workflows not executing
- Check worker is connected: Look for "Worker started" in worker logs
- Verify task queue name matches (`hn-jobs`)
- Check Temporal UI for pending workflows
- Verify namespace exists: `docker exec temporal-admin-tools temporal namespace list`
