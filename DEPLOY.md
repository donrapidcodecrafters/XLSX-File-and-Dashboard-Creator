# Production Deployment Guide
**Platform:** Cadence Reporting Portal  
**Stack:** Fastify API + React/Vite frontend + Postgres 16  
**Host:** GoDaddy VPS — 2 vCPU / 4 GB RAM / Linux  
**Process manager:** PM2 (fork mode, max_memory_restart 1500M)  

---

## Credentials & Config Reference

All secrets live in `.env` at the repo root — never committed (it's in `.gitignore`).  
A second copy of `.env` must exist on the VPS at the same path after deployment.

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Your Postgres connection string — format: `postgresql://user:pass@host:5432/dbname` |
| `SESSION_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SENDGRID_API_KEY` | sendgrid.com → Settings → API Keys → Create API Key (Full Access) |
| `SENDGRID_FROM_EMAIL` | A verified sender in SendGrid (Settings → Sender Authentication) |
| `PUBLIC_APP_URL` | Your domain or VPS IP, e.g. `https://reporting.yourdomain.com` |
| `AUTH_ENABLED` | Set to `true` in production |
| `AUTH_WHITELIST_USERS` | Format: `email:bcrypt_hash` — generate hash with command below |

**Generate a bcrypt hash for a user password:**
```bash
node -e "const b=require('./node_modules/bcryptjs'); b.hash('YourPassword',12).then(console.log)"
```

---

## Part 1 — First-Time VPS Setup

SSH into your GoDaddy VPS as root (or sudo user):
```bash
ssh root@YOUR_VPS_IP
```

### 1.1 System packages
```bash
apt update && apt upgrade -y
apt install -y git curl build-essential nginx certbot python3-certbot-nginx
```

### 1.2 Node.js 20 via NVM
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
nvm alias default 20
node --version   # should show v20.x.x
```

### 1.3 PM2
```bash
npm install -g pm2
pm2 startup systemd -u root --hp /root   # follow the printed command to enable on boot
```

### 1.4 PostgreSQL 16
```bash
sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update && apt install -y postgresql-16

# Start and enable
systemctl start postgresql
systemctl enable postgresql
```

**Create the database and user:**
```bash
sudo -u postgres psql <<EOF
CREATE DATABASE dashboard_db;
CREATE USER studio_user WITH PASSWORD 'your_db_password_here';
GRANT ALL PRIVILEGES ON DATABASE dashboard_db TO studio_user;
ALTER DATABASE dashboard_db OWNER TO studio_user;
EOF
```

> **Note:** The schema is auto-migrated on API startup (`POSTGRES_AUTO_MIGRATE=true`).  
> You don't need to run any SQL migration scripts manually.

---

## Part 2 — Deploy the Code

### 2.1 Clone the repo (first time)
```bash
cd /var/www
git clone https://github.com/YOUR_ORG/YOUR_REPO.git reporting-platform
cd reporting-platform
```

### 2.2 Create the production .env
Copy the contents of your local `.env` file to the server:
```bash
nano /var/www/reporting-platform/.env
# Paste your .env contents, update PUBLIC_APP_URL and NODE_ENV=production
```

Minimum production `.env` values to change from dev:
```
NODE_ENV=production
PUBLIC_APP_URL=https://reporting.yourdomain.com
DATABASE_URL=postgresql://studio_user:YOUR_DB_PASSWORD@127.0.0.1:5432/dashboard_db
AUTH_ENABLED=true
SESSION_SECRET=YOUR_64_CHAR_RANDOM_HEX
AUTH_WHITELIST_USERS=don@rapidcodecrafters.com:$2b$12$YOUR_BCRYPT_HASH
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=reports@yourdomain.com
AUTOMATION_ENABLED=true
```

### 2.3 Install dependencies and build
```bash
cd /var/www/reporting-platform
npm install
npm run build
```

Build output:
- API compiled to `apps/api/dist/`
- Frontend compiled to `apps/web/dist/`

### 2.4 Create logs directory
```bash
mkdir -p /var/www/reporting-platform/logs
```

### 2.5 Start with PM2
```bash
cd /var/www/reporting-platform
pm2 start ecosystem.config.cjs
pm2 save   # persist across reboots
```

Check it's running:
```bash
pm2 status
pm2 logs quickbase-reporting-api --lines 50
```

The API listens on **port 3001**.

---

## Part 3 — Nginx Reverse Proxy

The API runs on port 3001 internally. Nginx forwards public traffic to it and serves the frontend static files.

### 3.1 Create the site config
```bash
nano /etc/nginx/sites-available/reporting-platform
```

Paste this (replace `reporting.yourdomain.com` with your actual domain or IP):
```nginx
server {
    listen 80;
    server_name reporting.yourdomain.com;

    # Frontend static files
    root /var/www/reporting-platform/apps/web/dist;
    index index.html;

    # SPA fallback — all non-API routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 30M;
        proxy_read_timeout 120s;
    }
}
```

```bash
# Enable the site
ln -s /etc/nginx/sites-available/reporting-platform /etc/nginx/sites-enabled/
nginx -t        # test config
systemctl reload nginx
```

### 3.2 SSL with Let's Encrypt (requires a real domain, not an IP)
```bash
certbot --nginx -d reporting.yourdomain.com
# Follow the prompts — it auto-edits the nginx config and sets up auto-renewal
```

Check renewal is set up:
```bash
systemctl status certbot.timer
```

---

## Part 4 — Subsequent Deployments (Updates)

Every time you push new code:

```bash
# On the VPS:
cd /var/www/reporting-platform
git pull origin main
npm install          # if package.json changed
npm run build
pm2 restart quickbase-reporting-api
pm2 logs quickbase-reporting-api --lines 30
```

Or from your local machine if you have SSH key set up:
```bash
ssh root@YOUR_VPS_IP "cd /var/www/reporting-platform && git pull && npm install && npm run build && pm2 restart quickbase-reporting-api"
```

---

## Part 5 — SendGrid Setup

1. Go to [sendgrid.com](https://sendgrid.com) → Sign in
2. **Settings → API Keys → Create API Key**
   - Name: `Cadence Reporting Platform`
   - Permissions: Full Access (or at minimum Mail Send)
   - Copy the key → add to `.env` as `SENDGRID_API_KEY=SG.xxxxx`
3. **Settings → Sender Authentication**
   - Verify the domain you're sending from (recommended) OR add a single sender
   - The verified email goes into `.env` as `SENDGRID_FROM_EMAIL`
4. Restart the API after updating `.env`:
   ```bash
   pm2 restart quickbase-reporting-api
   ```
5. Test by going to **Scheduled Reports** in the platform UI → create a config → click **Send test**

---

## Part 6 — Postgres Direct Access (from local machine)

To connect to the VPS Postgres from your local machine (e.g., TablePlus, pgAdmin, DBeaver):

```bash
# Option A: SSH tunnel (most secure — Postgres stays private)
ssh -L 5433:127.0.0.1:5432 root@YOUR_VPS_IP -N
# Then connect to: localhost:5433 / database: dashboard_db / user: studio_user
```

Or allow external connections (less secure — only do this on a trusted network):
```bash
# On VPS:
nano /etc/postgresql/16/main/pg_hba.conf
# Add: host dashboard_db studio_user YOUR_LOCAL_IP/32 md5

nano /etc/postgresql/16/main/postgresql.conf
# Change: listen_addresses = '*'

systemctl restart postgresql
# Open port 5432 in your GoDaddy firewall settings
```

---

## Part 7 — Monitoring & Logs

```bash
# Live process status
pm2 status

# Live logs (all)
pm2 logs

# API-specific logs
pm2 logs quickbase-reporting-api

# Tail error log file
tail -f /var/www/reporting-platform/logs/api-error.log

# Nginx access log
tail -f /var/log/nginx/access.log

# Nginx error log
tail -f /var/log/nginx/error.log

# Postgres logs
tail -f /var/log/postgresql/postgresql-16-main.log
```

---

## Part 8 — Firewall (ufw)

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'    # ports 80 and 443
ufw enable
ufw status
```

Port 3001 (API) stays private — only Nginx talks to it internally. Do NOT open 3001 publicly.

---

## Part 9 — Quick Health Checks

After deployment, verify everything is working:

```bash
# API health
curl http://localhost:3001/api/catalog

# Frontend loads
curl -I http://YOUR_DOMAIN_OR_IP/

# Postgres connection
sudo -u postgres psql -c "\l"

# PM2 running
pm2 status | grep online

# Check auth is enabled
curl http://localhost:3001/api/auth/me
# Should return 401 (not 200) when auth is enabled and no session exists
```

---

## Useful Commands Reference

| Task | Command |
|---|---|
| Restart API | `pm2 restart quickbase-reporting-api` |
| Stop API | `pm2 stop quickbase-reporting-api` |
| View live logs | `pm2 logs quickbase-reporting-api` |
| Reload nginx | `systemctl reload nginx` |
| Postgres CLI | `sudo -u postgres psql dashboard_db` |
| Check disk space | `df -h` |
| Check memory | `free -m` |
| Check CPU | `htop` |
| List PM2 processes | `pm2 status` |
| Save PM2 process list | `pm2 save` |
| Generate session secret | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| Generate bcrypt hash | `node -e "const b=require('./node_modules/bcryptjs'); b.hash('Password',12).then(console.log)"` |
