#!/bin/bash
cd /opt/babji
set -a
source .env
set +a
exec node packages/gateway/dist/index.js
