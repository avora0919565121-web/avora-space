import { Outlet } from "react-router-dom";

import { ReturnChip } from "@/components/nav/ReturnChip";
import { SectionTabs } from "@/components/SectionTabs";
import { VAULT_TABS } from "@/lib/navigation";

/**
 * Két sắt — the place where what is yours is kept. It holds the ledger that
 * already exists and the password half that does not yet; the section only
 * frames them, so Tài chính behaves exactly as it did on its own route.
 */
const Vault = () => (
  <div className="flex min-h-0 flex-1 flex-col">
    <SectionTabs section="Két sắt" tabs={VAULT_TABS} />
    <ReturnChip className="mx-auto w-full max-w-5xl px-6 md:px-10" />
    <Outlet />
  </div>
);

export default Vault;
