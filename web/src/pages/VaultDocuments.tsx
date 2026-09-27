import { FileLock2 } from "lucide-react";

import { ComingSoon } from "@/components/ComingSoon";

/**
 * Sensitive Document domain of the vault: announced by outcome, not yet built.
 * No word about encryption — nothing is encrypted until Trust Phase 2+ (ADR-020).
 */
const VaultDocuments = () => (
  <ComingSoon
    icon={FileLock2}
    title="Tài liệu"
    description="Nơi lưu tài liệu nhạy cảm của bạn — hợp đồng riêng, ghi chú cần giữ kín, giấy tờ chưa phân loại — tìm lại được bằng thẻ gắn nhãn. Đang được xây, chưa lưu gì ở đây."
  />
);

export default VaultDocuments;
