#!/bin/bash
# AVORA-106 · K0.2 — runs every supabase/tests/*.sql against the project through the Management API.
# Each test builds its fixture in one transaction and ends with `raise exception '<NAME> failures=N …'`,
# so nothing is ever kept. Needs SUPABASE_ACCESS_TOKEN (env or web/.env). Exit 1 on any failure.
set -euo pipefail
cd "$(dirname "$0")/../.."
TOKEN="${SUPABASE_ACCESS_TOKEN:-$(grep '^SUPABASE_ACCESS_TOKEN=' web/.env 2>/dev/null | cut -d= -f2- | tr -d '"')}"
REF="$(cat supabase/.temp/project-ref)"
status=0
for f in supabase/tests/*.sql; do
  body=$(python3 -c 'import json,sys;print(json.dumps({"query":open(sys.argv[1]).read()}))' "$f")
  out=$(curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$body")
  msg=$(python3 -c 'import json,sys;d=json.loads(sys.stdin.read());print(d.get("message","") if isinstance(d,dict) else d)' <<<"$out")
  if grep -qE "failures=0 |PROBE" <<<"$msg" && ! grep -q "^FAIL" <<<"$msg"; then
    echo "✓ $(basename "$f")"
  else
    echo "✗ $(basename "$f")"; echo "$msg" | sed 's/\\n/\n/g' | grep -E "FAIL|ERROR" | head -20; status=1
  fi
done
exit $status
