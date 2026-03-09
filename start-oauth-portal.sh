#!/bin/bash
set -a
source /opt/babji/.env
set +a
cd /opt/babji/apps/oauth-portal
exec npx next start -p 3100
