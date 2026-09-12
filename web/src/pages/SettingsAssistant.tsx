import { Sparkles } from "lucide-react";

import { ComingSoon } from "@/components/ComingSoon";

/** Avora AI: named in the navigation, with no assistant behind it yet. */
const SettingsAssistant = () => (
  <ComingSoon
    icon={Sparkles}
    title="Avora AI"
    description="Trợ lý riêng của bạn trong AVORA — đang được xây, chưa có gì để trò chuyện ở đây."
  />
);

export default SettingsAssistant;
