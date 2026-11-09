import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, FileText, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { DeleteAccountDialog } from "@/components/AccountDeletion";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import {
  NOTICE_TEXT,
  SUPPORT_EMAIL,
  TERMS_VERSION,
  acceptTerms,
  ackNotice,
  fetchAccountGate,
  safetyKeys,
  suspensionText,
  type AccountGate,
} from "@/lib/safety";

const primaryClass =
  "press flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
const quietClass =
  "press flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50";
const dangerLinkClass = "press min-h-11 px-3 text-[13.5px] font-medium text-destructive underline-offset-2 hover:underline";

/** A full-screen card for the two "only this" states: suspended, terms declined. */
function GateScreen({ icon, title, children, testId }: { icon: ReactNode; title: string; children: ReactNode; testId: string }) {
  return (
    <div className="paper flex min-h-[100dvh] items-center justify-center px-5 py-10" data-testid={testId}>
      <div className="w-full max-w-[420px] rounded-card border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-foreground">{icon}</span>
        <h1 className="mt-4 text-[19px] font-semibold leading-snug tracking-tight text-foreground">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()} className={quietClass}>
      <LogOut className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Đăng xuất
    </button>
  );
}

function SuspendedScreen({ until }: { until: string }) {
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  return (
    <GateScreen testId="account-suspended" icon={<ShieldAlert className="h-6 w-6 text-destructive" strokeWidth={1.7} aria-hidden="true" />} title={suspensionText(until)}>
      <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
        Trong thời gian này bạn không xem hay gửi được tin nhắn. Nếu bạn nghĩ đây là nhầm lẫn, hãy viết cho{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-foreground underline underline-offset-2">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
      <div className="mt-5 space-y-2">
        <a href="/chinh-sach#cong-dong" className={quietClass}>
          <FileText className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Quy tắc cộng đồng
        </a>
        <SignOutButton />
        <button type="button" onClick={() => setIsDeleteOpen(true)} className={dangerLinkClass}>
          Xoá tài khoản
        </button>
      </div>
      <DeleteAccountDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen} graceDays={14} />
    </GateScreen>
  );
}

/** Older accounts (and anyone after the Điều khoản change) agree once; nothing is pre-ticked. */
function TermsPrompt({ onDecline }: { onDecline: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<boolean>(false);
  const accept = useMutation({
    mutationFn: () => acceptTerms(TERMS_VERSION),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: safetyKeys.gate(user?.id ?? "") }),
  });
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="max-w-[440px] gap-0 rounded-card border-border bg-card p-0" data-testid="terms-prompt" onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <div className="px-6 pb-2 pt-6">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">Điều khoản sử dụng mới</DialogTitle>
          <DialogDescription className="mt-1.5 text-[14px] leading-6 text-muted-foreground">
            Avora đã cập nhật Điều khoản và Quy tắc cộng đồng: không chấp nhận nội dung khiêu dâm, bạo lực, quấy rối, lừa đảo hay gây hại cho trẻ em. Bạn có thể báo cáo và chặn bất kỳ ai.
          </DialogDescription>
          <a href="/chinh-sach#dieu-khoan" target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center text-[14px] font-medium text-foreground underline underline-offset-2">
            Đọc Điều khoản và Quy tắc cộng đồng
          </a>
          <label className="mt-1 flex min-h-11 cursor-pointer items-start gap-3 py-2 text-[14px] leading-6 text-foreground">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="mt-1 h-4 w-4 accent-personal" data-terms-check="" />
            <span>Tôi đồng ý với Điều khoản sử dụng và Quy tắc cộng đồng.</span>
          </label>
          {accept.isError ? <p className="text-[13px] text-destructive">{accept.error.message}</p> : null}
        </div>
        <div className="flex flex-col gap-2 px-6 pb-6 pt-3">
          <button type="button" disabled={!checked || accept.isPending} onClick={() => accept.mutate()} className={primaryClass}>
            {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Đồng ý và tiếp tục
          </button>
          <button type="button" onClick={onDecline} className={quietClass}>
            Không đồng ý
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TermsDeclinedScreen({ onReview }: { onReview: () => void }) {
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  return (
    <GateScreen testId="terms-declined" icon={<FileText className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />} title="Cần đồng ý Điều khoản để dùng Avora">
      <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
        Bạn có thể xem lại Điều khoản, hoặc xoá tài khoản nếu không muốn tiếp tục.
      </p>
      <div className="mt-5 space-y-2">
        <button type="button" onClick={onReview} className={primaryClass}>
          Xem lại Điều khoản
        </button>
        <SignOutButton />
        <button type="button" onClick={() => setIsDeleteOpen(true)} className={dangerLinkClass}>
          Xoá tài khoản
        </button>
      </div>
      <DeleteAccountDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen} graceDays={14} />
    </GateScreen>
  );
}

/** One notice at a time; closing it marks it read. */
function NoticeDialog({ gate }: { gate: AccountGate }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const notice = gate.notices.find((item) => !closed.has(item.id));
  if (notice === undefined) return null;
  const text = NOTICE_TEXT[notice.kind] ?? NOTICE_TEXT.report_reviewed;
  const close = (): void => {
    setClosed((prev) => new Set(prev).add(notice.id));
    void ackNotice(notice.id).then(() => queryClient.invalidateQueries({ queryKey: safetyKeys.gate(user?.id ?? "") }));
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-w-[420px] gap-0 rounded-card border-border bg-card p-0" data-testid="account-notice" data-kind={notice.kind}>
        <div className="flex flex-col items-center px-6 pb-2 pt-7 text-center">
          <span className={`flex h-12 w-12 items-center justify-center rounded-full ${notice.kind === "warning" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            <Bell className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
          </span>
          <DialogTitle className="mt-3 text-[18px] font-semibold tracking-tight text-foreground">{text.title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-[14px] leading-6 text-muted-foreground">{text.body}</DialogDescription>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button type="button" onClick={close} className={primaryClass}>
            Đã hiểu
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 111-B · after the deletion gate: suspended → only the restricted screen; terms not agreed →
 * the agreement (a fresh sign-up that ticked the box is recorded without asking again);
 * otherwise the app, with any unread notice on top. A failed read lets the app through — the
 * server still refuses a suspended session everywhere.
 */
export function SafetyGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const [declined, setDeclined] = useState<boolean>(false);
  const autoAccepted = useRef<boolean>(false);
  const gate = useQuery({
    queryKey: safetyKeys.gate(userId),
    queryFn: fetchAccountGate,
    enabled: userId !== "",
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const signedUpWith = (user?.user_metadata as { terms_version?: unknown } | undefined)?.terms_version;
  const needsTerms = gate.data != null && !gate.data.termsAccepted;
  const autoAccept = needsTerms && signedUpWith === gate.data?.termsVersion;

  useEffect(() => {
    if (!autoAccept || autoAccepted.current) return;
    autoAccepted.current = true;
    void acceptTerms(gate.data?.termsVersion ?? TERMS_VERSION)
      .then(() => queryClient.invalidateQueries({ queryKey: safetyKeys.gate(userId) }))
      .catch(() => undefined);
  }, [autoAccept, gate.data?.termsVersion, queryClient, userId]);

  if (gate.data == null) return <>{children}</>;
  if (gate.data.suspendedUntil !== null) return <SuspendedScreen until={gate.data.suspendedUntil} />;
  if (needsTerms && !autoAccept) {
    if (declined) return <TermsDeclinedScreen onReview={() => setDeclined(false)} />;
    return (
      <>
        {children}
        <TermsPrompt onDecline={() => setDeclined(true)} />
      </>
    );
  }
  return (
    <>
      {children}
      <NoticeDialog gate={gate.data} />
    </>
  );
}
