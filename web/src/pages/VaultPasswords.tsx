import { VaultCompartment } from "@/components/vault/VaultCompartment";

/** Mật khẩu — encrypted on the device like the other compartments (AVORA-68, ADR-041; Nhà mới 12/11). */
const VaultPasswords = () => <VaultCompartment section="passwords" />;

export default VaultPasswords;
