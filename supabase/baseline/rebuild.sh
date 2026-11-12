#!/usr/bin/env bash
# Dựng lại database AVORA từ repo: baseline (schema production 09/11/2026, trước 111-A) rồi mọi migration
# từ 20261109091000 trở đi, theo thứ tự tên tệp. Dừng ở lỗi đầu tiên.
#
#   PG… env trỏ tới database đích (trống).  --local: Postgres thường (nạp thêm local/00_shim_plain_postgres.sql
#   giả lập role/schema/auth/storage của Supabase). Không có --local: project Supabase thật (đã có sẵn những thứ đó).
#   --until <version>: dừng sau migration đó (ví dụ để dựng đúng như live).
set -euo pipefail
cd "$(dirname "$0")"
LOCAL=0; UNTIL=""
while [ $# -gt 0 ]; do case "$1" in --local) LOCAL=1 ;; --until) UNTIL="$2"; shift ;; esac; shift; done
run() { PGOPTIONS='-c check_function_bodies=off -c client_min_messages=warning' psql -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; echo "ok  $1"; }
[ "$LOCAL" = 1 ] && run local/00_shim_plain_postgres.sql
for f in 01_types.sql 02_functions_pre_tables.sql 03_tables.sql 04_constraints_pk_unique.sql 06_functions.sql 07_defaults.sql \
         08_constraints_check.sql 09_indexes.sql 10_constraints_fk.sql 12_rls_enable.sql 13_triggers.sql 14_policies.sql \
         15_grants.sql 16_seed.sql 17_platform_extras.sql 19_default_privileges.sql; do run "$f"; done
for f in $(ls ../migrations | awk '$0 >= "20261109091000"' | sort); do
  run "../migrations/$f"
  [ -n "$UNTIL" ] && [[ "$f" == "$UNTIL"* ]] && break
done
echo "Xong. So với live: psql -At -f fingerprint.sql (cùng câu trên live) rồi so hai JSON."
