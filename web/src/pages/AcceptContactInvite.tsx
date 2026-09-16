import {
  CheckCircle2,
  Clock,
  Loader2,
  SearchX,
  Share2,
  UserRoundCheck,
  UserRoundPlus,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Button } from "@/components/ui/button";
import {
  CONTACT_INVITE_TTL_DAYS,
  contactInviteState,
  type ContactInviteState,
} from "@/lib/contacts";
import { useAcceptContactInvite, useContactInvitePreview } from "@/lib/use-contacts";

/**
 * The landing page of a contact invitation: it names who is asking, and asks one question.
 *
 * Everything that can stop an acceptance is read before anything is pressed, so a dead end
 * arrives as a sentence rather than as a button that fails. The button only exists in the one
 * state where pressing it can work.
 *
 * The preview is a courtesy, not a gate — `accept_invite` re-checks every rule itself, so a
 * link left open on a screen while something changed elsewhere still cannot write a half-link.
 */
const AcceptContactInvite = () => {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const previewQuery = useContactInvitePreview(token);
  const { accept, isAccepting } = useAcceptContactInvite();
  const [failure, setFailure] = useState<string | null>(null);

  const state: ContactInviteState | null = useMemo(
    () => (previewQuery.isSuccess ? contactInviteState(previewQuery.data) : null),
    [previewQuery.isSuccess, previewQuery.data],
  );

  const confirm = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      await accept(token);
      toast.success("Đã kết nối. Hai bạn giờ có nhau trong danh bạ.");
      navigate("/lien-he", { replace: true });
    } catch (error) {
      // The rule that stopped it may be newer than the preview, so the page re-reads instead
      // of leaving a stale invitation on screen next to the refusal.
      setFailure((error as Error).message);
      void previewQuery.refetch();
    }
  }, [accept, token, navigate, previewQuery]);

  if (previewQuery.isPending) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Đang mở lời mời</span>
      </Shell>
    );
  }

  if (previewQuery.isError) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
          Không mở được lời mời
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          {(previewQuery.error as Error).message}
        </p>
        <Button variant="outline" className="press mt-6 h-10 px-4" onClick={() => void previewQuery.refetch()}>
          Thử lại
        </Button>
      </Shell>
    );
  }

  if (state === null || state.kind !== "ready") {
    return (
      <Shell>
        <Closed state={state} onHome={() => navigate("/lien-he")} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto flex w-fit items-center justify-center">
        <InitialsAvatar name={state.inviterName} size="lg" />
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        <UserRoundPlus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        Lời mời kết nối
      </p>
      <h1 className="mt-1.5 truncate text-[22px] font-semibold tracking-tight text-foreground">
        {state.inviterName}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        {state.inviterName} muốn kết nối với bạn trên AVORA. Khi bạn đồng ý, hai bên sẽ có nhau trong
        danh bạ và nhắn tin được ngay.
      </p>

      {failure !== null ? (
        <p role="alert" className="mt-5 rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
          {failure}
        </p>
      ) : null}

      <button
        type="button"
        disabled={isAccepting}
        onClick={() => void confirm()}
        className="press mt-7 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isAccepting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Đang kết nối…
          </>
        ) : (
          "Chấp nhận"
        )}
      </button>
    </Shell>
  );
};

/**
 * Every ending that is not an offer.
 *
 * Each one says what happened and where to go, never the raw database sentence: an inviter who
 * opened their own link made an ordinary mistake — they meant to forward it — and should be told
 * that, not shown a refusal written for a server log.
 */
function Closed({ state, onHome }: { state: ContactInviteState | null; onHome: () => void }) {
  const kind = state?.kind ?? "missing";

  const title: string =
    kind === "accepted"
      ? "Lời mời này đã được dùng"
      : kind === "expired"
        ? "Lời mời đã hết hạn"
        : kind === "own"
          ? "Đây là lời mời của chính bạn"
          : kind === "linked"
            ? "Liên hệ này đã được kết nối"
            : "Lời mời không còn hiệu lực";

  // "Hết hạn" and "không tồn tại" are deliberately different sentences: an expired link was
  // real and the sender can simply send another, while an unknown one never existed at all.
  const body: string =
    kind === "accepted"
      ? "Ai đó đã chấp nhận lời mời này rồi. Nếu là bạn, người mời đã có trong danh bạ của bạn."
      : kind === "expired"
        ? `Lời mời chỉ dùng được trong ${CONTACT_INVITE_TTL_DAYS} ngày kể từ khi gửi. Hãy xin người mời gửi lại một lời mời mới — lần này sẽ có liên kết mới.`
        : kind === "own"
          ? "Bạn không thể tự chấp nhận lời mời mình gửi. Hãy chuyển liên kết này cho người bạn muốn mời."
          : kind === "linked"
            ? "Người mời đã kết nối liên hệ này với một tài khoản khác."
            : "Liên kết này không tồn tại hoặc đã bị thay thế. Hãy xin người mời một liên kết mới.";

  const Icon =
    kind === "accepted"
      ? CheckCircle2
      : kind === "expired"
        ? Clock
        : kind === "own"
          ? Share2
          : kind === "linked"
            ? UserRoundCheck
            : SearchX;

  return (
    <>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
      <Button variant="outline" className="press mt-6 h-10 px-4" onClick={onHome}>
        Về danh bạ
      </Button>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="paper flex min-h-screen flex-1 items-center justify-center px-6 py-12">
      <div className="animate-rise-in w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

export default AcceptContactInvite;
