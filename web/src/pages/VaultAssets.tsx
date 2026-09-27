import { Landmark } from "lucide-react";

import { ComingSoon } from "@/components/ComingSoon";

/**
 * Real Asset domain of the vault: holds proof of ownership only. Value and depreciation stay in
 * Tài chính; the two will reference each other by `vault_asset_id`, never copy.
 */
const VaultAssets = () => (
  <ComingSoon
    icon={Landmark}
    title="Tài sản"
    description="Nơi ghi nhận nhà, đất, xe và các tài sản khác bạn sở hữu, cùng giấy tờ chứng minh — phần giá trị/khấu hao vẫn theo dõi ở Tài chính. Đang được xây, chưa lưu gì ở đây."
  />
);

export default VaultAssets;
