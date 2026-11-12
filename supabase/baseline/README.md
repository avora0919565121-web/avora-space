# Migration nền (baseline) — dựng lại database AVORA từ repo

**Vì sao có:** 33 bảng cốt lõi (tasks, profiles, accounts, transactions, think_hub_table/record, group_decisions,
task_*…) được tạo trên live trước migration đầu tiên của repo (15/09/2026) và trước cả sổ migration của Supabase
(20260905). Không nơi nào còn lệnh tạo chúng. Thư mục này là bản chụp schema production để repo dựng lại được
database từ con số 0 (LOI-20, VMT duyệt 12/11/2026).

## Nguồn và phạm vi

- Xuất từ production `myrubjdysllgucgafqjy` ngày **09/11/2026, trước 111-A**, chỉ cấu trúc, **không có dữ liệu người dùng**
  (`16_seed.sql` chỉ là danh mục tham chiếu: app_features, app_config với `ops_user_ids` để trống, currencies,
  sticker_catalog, think_hub_template, một phần book_catalog phạm vi công cộng).
- `19_default_privileges.sql`: quyền mặc định production (đọc từ `pg_default_acl` live 12/11). Project mới của
  Supabase cấp ALL cho anon/authenticated theo mặc định; thiếu tệp này thì bảng/hàm tạo sau rộng quyền hơn live.
- Không có bí mật: không khoá, không token. URL Edge Function trong 4 hàm `private.call_*` trỏ về project production;
  trên project khác thì chạy bản "trỏ về chính mình" như staging (`staging_point_to_self`).

## Dựng lại

    PGHOST=… PGUSER=… PGDATABASE=<db trống> ./rebuild.sh            # project Supabase thật
    PGHOST=localhost PGPORT=54322 PGUSER=postgres PGDATABASE=x ./rebuild.sh --local   # Postgres thường

Thứ tự: 01 → 17, 19, rồi **mọi migration có version ≥ 20261109091000** (111-A trở đi). Migration cũ hơn đã nằm trong
bản chụp, không chạy lại.

## Đã kiểm (12/11/2026)

Dựng vào Postgres 17 trống (`--local`): 17 tệp nền 0 lỗi, 8 migration sau 0 lỗi. So vân tay (`fingerprint.sql`:
cột, hàm, luật quyền, chỉ mục, ràng buộc, trigger, quyền bảng của anon/authenticated) với live:
3.731 mục trên live; khác biệt **chỉ** là phần của các migration chưa lên live (111-C, Nhà mới) và 4 ràng buộc
CHECK in khác dấu ngoặc (cùng nghĩa). Không thiếu đối tượng nào của live.

## Khi nào làm lại bản chụp

Khi có thay đổi trên live không đi qua migration trong repo (Rork sửa thẳng trên dashboard). Chạy `fingerprint.sql`
trên live và trên bản dựng lại; khác ngoài dự kiến thì xuất lại.
