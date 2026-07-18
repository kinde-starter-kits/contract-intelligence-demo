#!/usr/bin/env bash
#
# Register the crew's M2M application as an agent in the agent-auth component,
# once, against the configured Convex deployment. Idempotent: a second run
# returns the existing agent id (created: false).
#
# Usage:
#   CREW_M2M_CLIENT_ID=... ORG_CODE=... ./scripts/provision-agent.sh
#
# Or edit the defaults below. Requires `npx convex` to be configured for the
# target deployment (see .env.local / `npx convex env list`).
set -euo pipefail

CLIENT_ID="${CREW_M2M_CLIENT_ID:-}"
ORG_CODE="${ORG_CODE:-}"
NAME="${AGENT_NAME:-Contract Review Crew}"
SLUG="${AGENT_SLUG:-contract-review-crew}"
# Deliberately broad crew scopes — see docs/kinde-setup.md §5.
SCOPES='["contracts:read","clauses:flag","clauses:approve"]'
TOOLS='["retrieve_clause","flag_clause","approve_clause"]'

if [[ -z "$CLIENT_ID" ]]; then
  echo "Set CREW_M2M_CLIENT_ID (the crew's Kinde M2M client id)." >&2
  exit 1
fi

ORG_JSON="null"
if [[ -n "$ORG_CODE" ]]; then
  ORG_JSON="\"$ORG_CODE\""
fi

npx convex run agents:provisionAgent "{
  \"kindeClientId\": \"$CLIENT_ID\",
  \"name\": \"$NAME\",
  \"slug\": \"$SLUG\",
  \"orgCode\": $ORG_JSON,
  \"scopes\": $SCOPES,
  \"allowedTools\": $TOOLS
}"
