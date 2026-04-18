#!/usr/bin/env bash
set -euo pipefail

# Babji Restore Script
# Restores a backup to the production server (database, tenant data, .env)
# Usage: bash scripts/restore.sh [YYYY-MM-DD]
#   If no date given, uses the most recent backup.
#
# DANGER: This is a destructive operation. It will:
#   - DROP and recreate the entire database
#   - Overwrite all tenant files on the server
#   - Overwrite the .env file on the server
#   - Restart the gateway and OAuth portal

SERVER="root@65.20.76.199"
BACKUP_ROOT="$HOME/babji-backups"

# Require explicit date
if [ -z "${1:-}" ]; then
  echo "ERROR: You must specify a backup date."
  echo "Usage: bash scripts/restore.sh YYYY-MM-DD"
  echo ""
  echo "Available backups:"
  ls -1d "$BACKUP_ROOT"/????-??-?? 2>/dev/null | xargs -I{} basename {} || echo "  (none)"
  exit 1
fi
BACKUP_DIR="$BACKUP_ROOT/$1"

BACKUP_DATE=$(basename "$BACKUP_DIR")

# Validate backup exists and has all required files
if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup directory not found: $BACKUP_DIR"
  exit 1
fi

MISSING=()
[ ! -f "$BACKUP_DIR/database.sql" ] && MISSING+=("database.sql")
[ ! -d "$BACKUP_DIR/data/tenants" ] && MISSING+=("data/tenants/")
[ ! -f "$BACKUP_DIR/env-snapshot" ] && MISSING+=("env-snapshot")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Backup is incomplete. Missing:"
  for f in "${MISSING[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

# Show what we're about to do
DB_SIZE=$(du -h "$BACKUP_DIR/database.sql" | cut -f1)
TENANT_COUNT=$(ls -1d "$BACKUP_DIR/data/tenants/"*/ 2>/dev/null | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

echo "=== Babji Restore ==="
echo ""
echo "Backup:   $BACKUP_DATE ($TOTAL_SIZE)"
echo "Database: $DB_SIZE"
echo "Tenants:  $TENANT_COUNT"
echo "Server:   $SERVER"
echo ""
echo "THIS WILL:"
echo "  1. Stop the gateway and OAuth portal"
echo "  2. DROP and recreate the babji database"
echo "  3. Overwrite ALL tenant files (memories, sessions, credentials)"
echo "  4. Overwrite the .env file (secrets, API keys)"
echo "  5. Restart all services"
echo ""
read -p "Type 'RESTORE' to confirm: " CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo "Aborted."
  exit 0
fi

echo ""

# Step 1: Stop services
echo "[1/6] Stopping services..."
ssh "$SERVER" 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 stop babji-gateway babji-oauth babji-landing 2>/dev/null || true'
echo "      Services stopped"

# Step 2: Restore database
echo "[2/6] Restoring PostgreSQL database..."
# Drop and recreate the database
ssh "$SERVER" 'docker exec babji-postgres-1 psql -U babji -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''babji'\'' AND pid <> pg_backend_pid();" 2>/dev/null || true'
ssh "$SERVER" 'docker exec babji-postgres-1 psql -U babji -d postgres -c "DROP DATABASE IF EXISTS babji;"'
ssh "$SERVER" 'docker exec babji-postgres-1 psql -U babji -d postgres -c "CREATE DATABASE babji OWNER babji;"'
# Pipe the SQL dump into the container
cat "$BACKUP_DIR/database.sql" | ssh "$SERVER" 'docker exec -i babji-postgres-1 psql -U babji -d babji --quiet'
echo "      Database restored"

# Step 3: Restore tenant data
echo "[3/6] Restoring tenant data..."
rsync -az --delete \
  "$BACKUP_DIR/data/tenants/" \
  "$SERVER:/opt/babji/data/tenants/"
echo "      $TENANT_COUNT tenant(s) restored"

# Step 4: Restore .env
echo "[4/6] Restoring .env..."
scp -q "$BACKUP_DIR/env-snapshot" "$SERVER:/opt/babji/.env"
echo "      .env restored"

# Step 5: Install deps and rebuild (in case packages changed)
echo "[5/6] Installing dependencies and rebuilding..."
ssh "$SERVER" 'cd /opt/babji && /usr/bin/pnpm install --no-frozen-lockfile --silent'
ssh "$SERVER" 'cd /opt/babji && /usr/bin/pnpm --filter @babji/db build'
echo "      Dependencies ready"

# Step 6: Restart services
echo "[6/6] Restarting services..."
ssh "$SERVER" 'export PATH="/root/.nvm/versions/node/v22.15.0/bin:$PATH" && pm2 restart babji-gateway babji-oauth babji-landing'

# Wait and verify
sleep 3
HEALTH=$(ssh "$SERVER" 'curl -s http://localhost:3000/health' 2>/dev/null || echo "FAILED")

echo ""
echo "=== Restore complete ==="
echo "Backup restored: $BACKUP_DATE"
echo "Health check:    $HEALTH"
echo ""
if echo "$HEALTH" | grep -qi "ok\|healthy\|alive"; then
  echo "Server is up and running."
else
  echo "WARNING: Health check did not return OK. Check logs:"
  echo "  ssh root@65.20.76.199 'export PATH=\"/root/.nvm/versions/node/v22.15.0/bin:\$PATH\" && pm2 logs babji-gateway --lines 30 --nostream'"
fi
