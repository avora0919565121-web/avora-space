#!/usr/bin/env bash
# 112-G · lưu ý 4 — test chỉ ghi vào web/.test-output/ (bỏ qua khi commit).
# Muốn lưu một lần đo / bộ ảnh làm bằng chứng thì chạy tay:
#   bun run evidence:save do-112g            → docs/reliability/do-112g/
#   bun run evidence:save screens 2026-10-13 → docs/screens/2026-10-13/ (chỉ thư mục đó)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/.test-output"
case "${1:-}" in
  screens)
    day="${2:?cần ngày, ví dụ 2026-10-13}"
    src="$out/screens/$day"; dst="$here/../docs/screens/$day"
    ;;
  do-*)
    src="$out/reliability/do-112a"; dst="$here/../docs/reliability/$1"
    ;;
  *) echo "Cách dùng: evidence:save do-<mã> | screens <ngày>" >&2; exit 2 ;;
esac
[ -d "$src" ] || { echo "Chưa có $src — chạy test trước." >&2; exit 1; }
mkdir -p "$dst"
cp -R "$src"/. "$dst"/
echo "Đã chép $(find "$src" -type f | wc -l) tệp → ${dst#$here/../}"
