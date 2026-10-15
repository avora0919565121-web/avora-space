-- AVORA-112-B · Advisor: không thêm mục mới. Cột "ai đổi" chỉ để truy vết (không cần khoá ngoại, không cần
-- chỉ mục — bảng vài chục dòng); chính sách đọc lịch sử gọi auth.uid() một lần mỗi truy vấn.
alter table public.app_features drop constraint if exists app_features_updated_by_fkey;
alter table public.app_feature_changes drop constraint if exists app_feature_changes_changed_by_fkey;
drop index if exists public.app_feature_changes_at;
drop policy if exists app_feature_changes_ops_read on public.app_feature_changes;
create policy app_feature_changes_ops_read on public.app_feature_changes for select to authenticated
  using ((select private.is_ops((select auth.uid()))));
