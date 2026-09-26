import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import {
  confirmContactLink,
  contactKeys,
  contactLinkMatchLabel,
  dismissContactLink,
  previewContactLink,
  type Contact,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";

/**
 * "Người này đã dùng AVORA" — a suggestion to link one contact to the account it matches.
 *
 * The same Gộp / Bỏ qua choice as the import preview, rebuilt for a single contact: the server only
 * says a match exists and on which field; who the account is stays hidden until "Gộp" is pressed,
 * and the link is written only then. Nothing is merged on its own.
 */
export function ContactLinkBanner({ contact }: { contact: Contact }) {
  const queryClient = useQueryClient();
  const eligible = contact.contactType === "individual" && contact.linkedUserId === null;

  const previewQuery = useQuery({
    queryKey: [...contactKeys.linkSuggestion(contact.id), contact.phone, contact.email],
    queryFn: () => previewContactLink(contact.id),
    enabled: eligible,
    staleTime: 60_000,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: contactKeys.all });
  };

  const mergeMutation = useMutation({
    mutationFn: () => confirmContactLink(contact.id),
    onSuccess: () => {
      toast.success(`Đã liên kết ${contact.name} với tài khoản AVORA.`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const skipMutation = useMutation({
    mutationFn: () => dismissContactLink(contact.id),
    onSuccess: () => {
      toast.success("Đã bỏ qua gợi ý này.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const match = previewQuery.data ?? null;
  if (!eligible || match === null) return null;
  const busy = mergeMutation.isPending || skipMutation.isPending;

  return (
    <section
      aria-label="Gợi ý liên kết tài khoản AVORA"
      className="animate-rise-in mt-6 rounded-xl border border-primary/30 bg-primary/[0.06] px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Link2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-foreground">
            {contact.name} có vẻ đã dùng AVORA
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Trùng {contactLinkMatchLabel(match)} với một tài khoản AVORA. Gộp để nhắn tin và gọi ngay từ
            liên hệ này — thông tin bạn đã lưu giữ nguyên.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <ChoiceButton label="Gộp" primary disabled={busy} onClick={() => mergeMutation.mutate()} />
            <ChoiceButton label="Bỏ qua" disabled={busy} onClick={() => skipMutation.mutate()} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ChoiceButton({
  label,
  primary = false,
  disabled,
  onClick,
}: {
  label: string;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "press min-h-9 rounded-md border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50",
        primary
          ? "border-primary/60 bg-card text-foreground hover:bg-card/80"
          : "border-transparent text-muted-foreground hover:bg-card/70",
      )}
    >
      {label}
    </button>
  );
}
