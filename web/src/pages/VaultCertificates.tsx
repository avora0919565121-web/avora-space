import { BadgeCheck } from "lucide-react";

import { ComingSoon } from "@/components/ComingSoon";

/** Certificate domain of the vault (RFC-AVORA-TRUST-001 §16): announced by outcome, not yet built. */
const VaultCertificates = () => (
  <ComingSoon
    icon={BadgeCheck}
    title="Chứng chỉ"
    description="Nơi lưu bằng cấp, giấy phép, chứng chỉ hành nghề — Avora sẽ nhắc bạn trước khi giấy tờ nào sắp hết hạn. Đang được xây, chưa lưu gì ở đây."
  />
);

export default VaultCertificates;
