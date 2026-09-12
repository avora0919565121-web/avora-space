import { KeyRound } from "lucide-react";

import { ComingSoon } from "@/components/ComingSoon";

/** The vault's second half: announced, not yet built. Nothing is stored here. */
const VaultPasswords = () => (
  <ComingSoon
    icon={KeyRound}
    title="Mật khẩu"
    description="Nơi giữ mật khẩu và thông tin đăng nhập của bạn — đang được xây, chưa lưu gì ở đây."
  />
);

export default VaultPasswords;
