#!/usr/bin/env bash
# Bring up a local Weaviate (with the all-MiniLM-L6-v2 embedding model) for
# development and the tenant-isolation check. Waits until it's ready.
set -euo pipefail
COMPOSE_FILE="$(dirname "$0")/../docker/weaviate/docker-compose.yml"

docker compose -f "$COMPOSE_FILE" up -d

echo "Waiting for Weaviate to become ready on http://localhost:8080 ..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/v1/.well-known/ready >/dev/null 2>&1; then
    echo "Weaviate is ready."
    exit 0
  fi
  sleep 3
done
echo "Weaviate did not become ready in time." >&2
exit 1
