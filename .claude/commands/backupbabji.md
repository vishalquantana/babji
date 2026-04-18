---
name: backupbabji
description: Pull a full backup of Babji production data (database, tenant files, .env) to local machine
---

# Babji Backup

Run the backup script to pull all production data to `~/babji-backups/YYYY-MM-DD/`.

## What Gets Backed Up
- **PostgreSQL database** — full dump from Docker container (tenants, credits, jobs, audit, profiles)
- **Tenant data** — SOUL.md, MEMORY.md, sessions, credentials, people files
- **Environment snapshot** — .env with all secrets, API keys, encryption key

## Execute

Run the backup script:

```bash
bash /Users/vishalkumar/Downloads/babji/scripts/backup.sh
```

After the script completes, verify the backup:

```bash
ls -la ~/babji-backups/$(date +%Y-%m-%d)/
```

Report the results to the user:
- Whether each step succeeded or failed
- Number of tenants backed up
- Total backup size
- Location of the backup

If any step fails, explain what went wrong and suggest a fix. Common issues:
- SSH connection timeout → check if server is reachable: `ssh root@65.20.76.199 'echo ok'`
- Docker not running → `ssh root@65.20.76.199 'docker ps'`
- Disk space → `df -h ~/babji-backups/`
