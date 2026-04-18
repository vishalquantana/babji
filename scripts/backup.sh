#!/usr/bin/env bash
set -euo pipefail

# Babji Backup Script
# Pulls database dump, tenant data, and env snapshot from production server
# Stores plain files in ~/babji-backups/YYYY-MM-DD/

SERVER="root@65.20.76.199"
BACKUP_ROOT="$HOME/babji-backups"
TODAY=$(date +%Y-%m-%d)
BACKUP_DIR="$BACKUP_ROOT/$TODAY"
RETENTION_DAYS=7

echo "=== Babji Backup — $TODAY ==="
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# 1. Database dump
echo "[1/3] Dumping PostgreSQL database..."
ssh "$SERVER" 'docker exec babji-postgres-1 pg_dump -U babji -d babji --no-owner --no-acl' \
  > "$BACKUP_DIR/database.sql"
DB_SIZE=$(du -h "$BACKUP_DIR/database.sql" | cut -f1)
echo "      database.sql ($DB_SIZE)"

# 2. Tenant data (memories, sessions, credentials, people)
echo "[2/3] Syncing tenant data..."
mkdir -p "$BACKUP_DIR/data"
rsync -az --delete \
  "$SERVER:/opt/babji/data/tenants/" \
  "$BACKUP_DIR/data/tenants/"
TENANT_COUNT=$(ls -1d "$BACKUP_DIR/data/tenants/"*/ 2>/dev/null | wc -l | tr -d ' ')
echo "      $TENANT_COUNT tenant(s) synced"

# 3. Environment snapshot (secrets, API keys, encryption key)
echo "[3/3] Copying .env snapshot..."
scp -q "$SERVER:/opt/babji/.env" "$BACKUP_DIR/env-snapshot"
echo "      env-snapshot saved"

# 4. Rotate old backups
echo ""
echo "Rotating backups older than $RETENTION_DAYS days..."
DELETED=0
if [ -d "$BACKUP_ROOT" ]; then
  for dir in "$BACKUP_ROOT"/????-??-??; do
    [ -d "$dir" ] || continue
    dir_date=$(basename "$dir")
    # Use date comparison (works on macOS and Linux)
    if [[ "$dir_date" < $(date -v-${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null || date -d "$RETENTION_DAYS days ago" +%Y-%m-%d) ]]; then
      rm -rf "$dir"
      DELETED=$((DELETED + 1))
    fi
  done
fi
if [ "$DELETED" -gt 0 ]; then
  echo "Deleted $DELETED old backup(s)"
else
  echo "Nothing to rotate"
fi

# Summary
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "=== Backup complete ==="
echo "Location: $BACKUP_DIR"
echo "Total size: $TOTAL_SIZE"
echo ""
echo "Contents:"
echo "  database.sql    — Full PostgreSQL dump"
echo "  data/tenants/   — All tenant files (memories, sessions, credentials)"
echo "  env-snapshot    — Production .env (secrets, API keys)"
