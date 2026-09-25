import { Building2, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BusinessFields, IndividualFields } from "@/components/contacts/ContactForms";
import { Button } from "@/components/ui/button";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  businessDraftProblem,
  canSubmitBusiness,
  canSubmitIndividual,
  individualDraftProblem,
  EMPTY_BUSINESS_DRAFT,
  EMPTY_INDIVIDUAL_DRAFT,
  type BusinessDraft,
  type Contact,
  type ContactType,
  type IndividualDraft,
} from "@/lib/contacts";
import { useContactActions } from "@/lib/use-contacts";

type NewContactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the stored contact once the server has accepted it. */
  onCreated: (contact: Contact) => void;
};

/**
 * Adding a contact begins by naming what it is.
 *
 * The type is asked before anything is typed because it cannot be changed afterwards, and
 * because the two forms barely overlap — a single form with fields that appear and vanish would
 * make the same decision invisibly, halfway through filling it in.
 */
export function NewContactDialog({ open, onOpenChange, onCreated }: NewContactDialogProps) {
  const [chosen, setChosen] = useState<ContactType | null>(null);
  const [individual, setIndividual] = useState<IndividualDraft>(EMPTY_INDIVIDUAL_DRAFT);
  const [business, setBusiness] = useState<BusinessDraft>(EMPTY_BUSINESS_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);

  const { addIndividual, addBusiness } = useContactActions();
  const { isSubmitting, guard } = useSubmitGuard();

  useEffect(() => {
    if (open) return;
    setChosen(null);
    setIndividual(EMPTY_INDIVIDUAL_DRAFT);
    setBusiness(EMPTY_BUSINESS_DRAFT);
    setNotice(null);
  }, [open]);

  const save = useCallback(async (): Promise<void> => {
    setNotice(null);
    // The server validates independently; this only spares a round trip.
    const problem =
      chosen === "individual" ? individualDraftProblem(individual) : businessDraftProblem(business);
    if (problem !== null) {
      setNotice(problem);
      return;
    }

    try {
      const saved =
        chosen === "individual" ? await addIndividual(individual) : await addBusiness(business);
      onOpenChange(false);
      onCreated(saved);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, [chosen, individual, business, addIndividual, addBusiness, onOpenChange, onCreated]);

  const submit = useCallback((): void => {
    void guard(save);
  }, [guard, save]);

  const canSubmit =
    chosen === "individual" ? canSubmitIndividual(individual) : canSubmitBusiness(business);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[88vh] max-w-[560px] gap-0 overflow-hidden rounded-xl border-border bg-card p-0"
      >
        <div className="flex items-start justify-between border-b border-border px-6 pb-4 pt-6">
          <div>
            <DialogTitle className="text-[20px] font-semibold tracking-tight text-foreground">
              {chosen === null
                ? "Thêm liên hệ"
                : chosen === "individual"
                  ? "Liên hệ cá nhân"
                  : "Liên hệ doanh nghiệp"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
              {chosen === null
                ? "Chọn loại liên hệ — sau khi tạo thì không đổi được"
                : chosen === "individual"
                  ? "Một người: tên và ít nhất một cách liên lạc"
                  : "Một công ty: tên, mã số thuế và người đại diện"}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={() => onOpenChange(false)}
            className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>

        {chosen === null ? (
          <div className="grid gap-3 px-6 py-6 sm:grid-cols-2">
            <ChoiceCard
              icon={UserRound}
              title="Thêm liên hệ cá nhân"
              description="Một người bạn muốn giữ liên lạc"
              onClick={() => setChosen("individual")}
            />
            <ChoiceCard
              icon={Building2}
              title="Thêm liên hệ doanh nghiệp"
              description="Một công ty bạn làm việc cùng"
              onClick={() => setChosen("business")}
            />
          </div>
        ) : (
          <>
            <div className="max-h-[54vh] overflow-y-auto px-6 py-5">
              {chosen === "individual" ? (
                <IndividualFields draft={individual} onChange={setIndividual} />
              ) : (
                <BusinessFields draft={business} onChange={setBusiness} />
              )}
              {notice !== null ? (
                <p role="alert" className="mt-4 text-[13px] text-primary">
                  {notice}
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
              <Button
                variant="outline"
                className="press h-10 px-5"
                onClick={() => {
                  setChosen(null);
                  setNotice(null);
                }}
              >
                Quay lại
              </Button>
              <div className="flex items-center gap-3">
                <Button variant="outline" className="press h-10 px-5" onClick={() => onOpenChange(false)}>
                  Huỷ
                </Button>
                <Button
                  className="press h-10 px-5"
                  disabled={!canSubmit || isSubmitting}
                  onClick={submit}
                >
                  {isSubmitting ? "Đang lưu…" : "Lưu liên hệ"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/50 hover:bg-accent/30"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-accent/40 text-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
