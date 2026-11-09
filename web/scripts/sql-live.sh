#!/bin/bash
# Runs one SQL file (or stdin with /dev/stdin) against the live project via the Management API; prints JSON.
set -euo pipefail
cd "$(dirname "$0")/../.."
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(grep '^SUPABASE_ACCESS_TOKEN=' web/.env 2>/dev/null | cut -d= -f2- | tr -d '"')}"
REF="$(cat supabase/.temp/project-ref)"
body=$(python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$1")
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$body"
echo
