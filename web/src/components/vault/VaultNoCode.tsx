import { KeyRound, LockKeyhole } from "lucide-react";
import { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { VaultGate } from "@/components/vault/VaultGate";
import { VaultSampleList } from "@/components/vault/VaultSamples";
import { useIsMobile } from "@/hooks/use-mobile";
import { COMPARTMENT_INTRO, compartmentSection, type CompartmentKey } from "@/lib/vault-compartments";

/**
 * KT-07c (CEO 12/11 · 19): an encrypted compartment before any code is set.
 *
 * Computer: the code keypad stays, on the left; on the right the compartment's samples show what it is
 * for. Phone: an invitation to set the code, with the samples below; tapping it pulls the keypad up in
 * a sheet from the bottom. Never a wall: the samples are readable without a code.
 */
export function VaultNoCode({ compartment }: { compartment: CompartmentKey }) {
  const isMobile = useIsMobile();
  const [isPadOpen, setIsPadOpen] = useState<boolean>(false);
  const intro = COMPARTMENT_INTRO[compartment];
  const section = compartmentSection(compartment);

  if (!isMobile) {
    return (
      <div className="flex min-h-0 flex-1 scroll-y" data-vault-no-code="desk">
        <div className="mx-auto grid w-full max-w-5xl items-start gap-8 px-6 pb-10 md:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] md:px-10">
          <div className="flex min-h-[560px] flex-col" data-vault-pad="">
            <VaultGate key={`no-code-${compartment}`} compartment={compartment} />
          </div>
          <div className="pt-10" data-vault-samples-side="">
            <VaultSampleList section={section} invite={`Đặt mã ở bên trái để cất ${intro.noun} thật.`} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 scroll-y px-4 pb-10 pt-3" data-vault-no-code="phone">
      <button
        type="button"
        onClick={() => setIsPadOpen(true)}
        data-vault-set-code-invite=""
        className="press flex w-full items-center gap-3 rounded-card border border-border bg-card px-4 py-3.5 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-foreground">Đặt mã để cất {intro.noun} thật</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{intro.purpose}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-[13.5px] font-semibold text-primary-foreground">
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Đặt mã
        </span>
      </button>
      <div className="mt-4">
        <VaultSampleList section={section} />
      </div>
      <Sheet open={isPadOpen} onOpenChange={setIsPadOpen}>
        <SheetContent side="bottom" className="flex h-[90dvh] flex-col rounded-t-[20px] p-0" data-vault-pad-sheet="">
          <SheetTitle className="sr-only">Đặt mã Két sắt</SheetTitle>
          <SheetDescription className="sr-only">Sáu số để mở các ngăn của Két sắt.</SheetDescription>
          <div aria-hidden="true" className="flex h-6 shrink-0 items-center justify-center">
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
          </div>
          <VaultGate key={`no-code-sheet-${compartment}`} compartment={compartment} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
