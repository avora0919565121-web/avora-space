-- AVORA-111-A · bật "Xoá tài khoản" sau khi đạt cổng:
-- SQL 31/31 · unit + browser xanh · thử đầu-cuối thật (user tạm → cron → Edge Function → auth/Storage/dữ liệu biến mất,
-- nhật ký không có dữ liệu cá nhân). Xem docs/reliability/do-111a/BAO-CAO.md.
update public.app_features
   set status = 'stable', note = '111-A · Xoá tài khoản trong app', updated_at = now()
 where key = 'account_deletion' and status <> 'stable';
