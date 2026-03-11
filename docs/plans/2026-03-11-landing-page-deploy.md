# Landing Page Deployment Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy the existing `/apps/landing-page` Next.js app as a separate PM2 process on `65.20.76.199`, and update nginx so `babji.quantana.top/` serves the landing page while `/admin`, `/connect`, `/link`, `/api`, `/report` stay on the OAuth portal.

**Architecture:** Run the landing page on port 3200 as a third PM2 process (`babji-landing`). Update the nginx config to route specific OAuth portal paths to port 3100 and default `/` to port 3200. The OAuth portal's `/_next` assets need their own location block to avoid conflicts.

**Tech Stack:** Next.js 16, PM2, nginx, Turso (waitlist DB)

---

### Task 1: Build the landing page on the server

**Files:**
- Existing: `/opt/babji/apps/landing-page/` (already synced to server)

**Step 1: Install dependencies and build on server**

```bash
ssh root@65.20.76.199 'cd /opt/babji && pnpm --filter landing-page install --no-frozen-lockfile && pnpm --filter landing-page build'
```

Expected: Build succeeds, `.next/` directory created under `apps/landing-page/`.

**Step 2: Verify build output exists**

```bash
ssh root@65.20.76.199 'ls /opt/babji/apps/landing-page/.next/BUILD_ID'
```

Expected: File exists, prints a build hash.

**Step 3: Commit (nothing to commit locally — this is a server-side build)**

No commit needed.

---

### Task 2: Register landing page as PM2 process

**Step 1: Start the landing page with PM2 on port 3200**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && cd /opt/babji/apps/landing-page && PORT=3200 pm2 start pnpm --name babji-landing -- start && pm2 save'
```

**Step 2: Verify the process is running**

```bash
ssh root@65.20.76.199 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 list'
```

Expected: `babji-landing` shows status `online`.

**Step 3: Verify it responds on port 3200**

```bash
ssh root@65.20.76.199 'sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/'
```

Expected: `200`.

---

### Task 3: Update nginx to split routing

**Files:**
- Modify: `/etc/nginx/sites-enabled/babji` on the server

**Step 1: Back up the current nginx config**

```bash
ssh root@65.20.76.199 'cp /etc/nginx/sites-enabled/babji /etc/nginx/sites-enabled/babji.bak'
```

**Step 2: Write the new nginx config**

The new config routes:
- `/admin`, `/connect`, `/link`, `/api`, `/report` → OAuth portal (port 3100)
- OAuth portal's internal `/_next/` assets → port 3100 (prefixed path to avoid clash)
- Everything else (`/`) → Landing page (port 3200)

```nginx
server {
    server_name babji.quantana.top;

    # --- OAuth Portal routes (port 3100) ---

    # Admin dashboard
    location /admin {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OAuth connect flow
    location /connect {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Short links
    location /link {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API routes (OAuth callbacks, admin API, etc.)
    location /api {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Reports
    location /report {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Gateway API
    location /api/gateway/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # --- Landing Page (port 3200) - default route ---
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/babji.quantana.top/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/babji.quantana.top/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    if ($host = babji.quantana.top) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80;
    server_name babji.quantana.top;
    return 404; # managed by Certbot
}
```

Note: nginx uses longest-prefix matching, so `/api/gateway/` (more specific) will match before `/api`. The explicit `/admin`, `/connect`, `/link`, `/api`, `/report` blocks match before the catch-all `/`.

**Step 3: Test and reload nginx**

```bash
ssh root@65.20.76.199 'nginx -t && systemctl reload nginx'
```

Expected: `syntax is ok`, `test is successful`, reload succeeds.

---

### Task 4: Verify everything works end-to-end

**Step 1: Verify landing page at root**

```bash
ssh root@65.20.76.199 'curl -s https://babji.quantana.top/ | head -c 500'
```

Expected: HTML containing landing page content (e.g., "Babji", "Summon", etc.)

**Step 2: Verify OAuth portal admin still works**

```bash
ssh root@65.20.76.199 'curl -s -o /dev/null -w "%{http_code}" https://babji.quantana.top/admin'
```

Expected: `200` (admin login page).

**Step 3: Verify short links still work**

```bash
ssh root@65.20.76.199 'curl -s -o /dev/null -w "%{http_code}" https://babji.quantana.top/link/test123'
```

Expected: `404` or redirect (but served by OAuth portal, not landing page).

**Step 4: Verify API routes still work**

```bash
ssh root@65.20.76.199 'curl -s -o /dev/null -w "%{http_code}" https://babji.quantana.top/api/admin/login'
```

Expected: `405` or `200` (served by OAuth portal).

**Step 5: Verify gateway API still works**

```bash
ssh root@65.20.76.199 'curl -s http://localhost:3000/health'
```

Expected: Health check response.

---

### Task 5: Commit and update docs

**Step 1: Update CHANGELOG.md**

Append entry:
```
## 2026-03-11
- **Landing Page**: Deployed landing-page app on port 3200 as PM2 process `babji-landing`. Updated nginx to serve landing page at `/` and route `/admin`, `/connect`, `/link`, `/api`, `/report` to OAuth portal. (Deployed)
```

**Step 2: Update CLAUDE.md server section**

Add `babji-landing` (ID 3) to the PM2 process names list and document port 3200.

**Step 3: Commit**

```bash
git add CHANGELOG.md CLAUDE.md docs/plans/2026-03-11-landing-page-deploy.md
git commit -m "docs: add landing page deployment plan and update server docs"
```
