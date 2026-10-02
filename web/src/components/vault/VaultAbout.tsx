import { memo } from "react";

import { VAULT_ABOUT } from "@/lib/vault-lock";
import { cn } from "@/lib/utils";

/**
 * AVORA-51 · B2 — the note about what this lock is and is not. Rendered word for word from
 * `VAULT_ABOUT`; nothing shortened, nothing dressed up.
 */
export const VaultAboutText = memo(function VaultAboutText({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5 text-left", className)}>
      <p className="text-[15.5px] font-semibold leading-snug text-foreground">{VAULT_ABOUT.title}</p>
      {VAULT_ABOUT.lines.map((line) => (
        <p key={line} className="text-[14px] leading-relaxed text-muted-foreground">
          {line}
        </p>
      ))}
      {/* AVORA-66: the full promise lives in the policy. */}
      <a href="/cai-dat/chinh-sach#ket-sat" className="inline-flex min-h-10 items-center text-[13.5px] font-medium text-primary" data-policy-link="">
        Xem chính sách ›
      </a>
    </div>
  );
});
