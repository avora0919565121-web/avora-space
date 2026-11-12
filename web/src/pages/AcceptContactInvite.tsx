import {
  CheckCircle2,
  Clock,
  HandHeart,
  Loader2,
  SearchX,
  Share2,
  UserRoundCheck,
  UserRoundPlus,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { LoadingOrRetry } from "@/components/LoadingOrRetry";
import { useAuth } from "@/lib/auth";
import { CONTACT_INVITE_PATH, CONTACT_INVITE_TTL_DAYS } from "@/lib/contacts";
import { publicInviteState, type PublicInviteState } from "@/lib/contact-invites";
import { useAcceptContactInvite, useDeclineInvite, usePublicInvitePreview } from "@/lib/use-contacts";

/** dd/MM/yyyy in the reader's own time zone. */
function fullDay(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getDate()).padStart(2, "0")}/${String(at.getMonth() + 1).padStart(2, "0")}/${at.getFullYear()}`;
}

/**
 * The page an invitation link opens (`/moi/:token`, and the older `/loi-moi-lien-he/:token`).
 *
 * KT-07a (SP-03 lỗi 4–5): public. Someone without an account reads who is asking and decides —
 * `Vào nhà cùng {Tên}` goes to sign-up and comes back here, already signed in, to accept;
 * `Không, cảm ơn` declines without any account. The page never shows the invitee's or the
 * inviter's number or email.
 *
 * Everything that can stop an acceptance is read before anything is pressed, so a dead end
 * arrives as a sentence rather than as a button that fails. `accept_invite` re-checks every rule.
 */
const AcceptContactInvite = () => {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { session } = useAuth() as { session?: unknown };
  const signedIn = session != null;

  const previewQuery = usePublicInvitePreview(token);
  const { accept, isAccepting } = useAcceptContactInvite();
  const { decline, isDeclining } = useDeclineInvite();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingDecline, setConfirmingDecline] = useState<boolean>(false);
  const [declinedNow, setDeclinedNow] = useState<boolean>(false);

  const state: PublicInviteState | null = useMemo(
    () => (previewQuery.isSuccess ? publicInviteState(previewQuery.data) : null),
    [previewQuery.isSuccess, previewQuery.data],
  );
  const here = `${CONTACT_INVITE_PATH}/${token}`;

  const confirm = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      await accept(token);
      toast.success("Đã kết nối. Hai bạn giờ có nhau trong danh bạ.");
      navigate("/lien-he", { replace: true });
    } catch (error) {
      // The rule that stopped it may be newer than the preview, so the page re-reads.
      setFailure((error as Error).message);
      void previewQuery.refetch();
    }
  }, [accept, token, navigate, previewQuery]);

  const refuse = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      await decline(token);
      setDeclinedNow(true);
      setConfirmingDecline(false);
    } catch (error) {
      setFailure((error as Error).message);
      void previewQuery.refetch();
    }
  }, [decline, token, previewQuery]);

  if (previewQuery.isPending) {
    return (
      <Shell>
        <LoadingOrRetry label="Đang mở lời mời" onRetry={() => void previewQuery.refetch()} />
      </Shell>
    );
  }

  if (previewQuery.isError) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Không mở được lời mời</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{(previewQuery.error as Error).message}</p>
        <Button variant="outline" className="press mt-6 h-10 px-4" onClick={() => void previewQuery.refetch()}>
          Thử lại
        </Button>
      </Shell>
    );
  }

  const home = (): void => navigate(signedIn ? "/lien-he" : "/dang-nhap");

  if (declinedNow && state !== null && state.kind === "ready") {
    return (
      <Shell>
        <Closed state={{ kind: "declined", inviterName: state.inviterName }} signedIn={signedIn} onHome={home} />
      </Shell>
    );
  }

  if (state === null || state.kind !== "ready") {
    return (
      <Shell>
        <Closed state={state} signedIn={signedIn} onHome={home} />
      </Shell>
    );
  }

  const until = fullDay(state.expiresAt);

  if (confirmingDecline) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
          Bạn không nhận lời mời của {state.inviterName}?
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          {state.inviterName} sẽ thấy “Đã từ chối”. AVORA không gửi thêm lời nhắc.
        </p>
        {failure !== null ? (
          <p role="alert" className="mt-5 rounded-md bg-personal-soft px-4 py-3 text-[14px] text-destructive">
            {failure}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Button className="press h-10 px-5" disabled={isDeclining} onClick={() => void refuse()}>
            {isDeclining ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Không nhận lời
          </Button>
          <Button variant="outline" className="press h-10 px-5" disabled={isDeclining} onClick={() => setConfirmingDecline(false)}>
            Quay lại
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto flex w-fit items-center justify-center">
        <UserAvatar name={state.inviterName} size="lg" />
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        <UserRoundPlus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        Lời mời kết nối
      </p>
      <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight text-foreground">
        {state.inviterName} mời bạn vào AVORA
      </h1>
      {state.note !== null ? (
        <blockquote className="mt-3 rounded-md bg-personal-soft px-4 py-3 text-left text-[14px] italic leading-relaxed text-foreground">
          “{state.note}”
        </blockquote>
      ) : null}
      <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
        {signedIn
          ? `Khi bạn đồng ý, bạn và ${state.inviterName} sẽ có nhau trong danh bạ và nhắn tin được ngay.`
          : "AVORA là nơi riêng cho bạn và người thân: trò chuyện, việc chung, sổ sách. Không quảng cáo."}
      </p>

      {failure !== null ? (
        <p role="alert" className="mt-5 rounded-md bg-personal-soft px-4 py-3 text-[14px] text-destructive">
          {failure}
        </p>
      ) : null}

      {signedIn ? (
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
      ) : (
        <div className="mt-7 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/dang-nhap?mode=dang-ky", { state: { from: here } })}
            className="press inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
          >
            Vào nhà cùng {state.inviterName}
          </button>
          <button
            type="button"
            onClick={() => navigate("/dang-nhap", { state: { from: here } })}
            className="press min-h-11 px-3 text-[14px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Tôi đã có tài khoản · Đăng nhập
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setConfirmingDecline(true)}
        className="press mt-2 min-h-11 px-3 text-[14px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Không, cảm ơn
      </button>
      {until !== null ? <p className="mt-3 text-[12.5px] text-muted-foreground">Lời mời dùng được đến {until}.</p> : null}
    </Shell>
  );
};

/**
 * Every ending that is not an offer — each says what happened and where to go, never the raw
 * database sentence.
 */
function Closed({ state, signedIn, onHome }: { state: PublicInviteState | null; signedIn: boolean; onHome: () => void }) {
  const kind = state?.kind ?? "missing";
  const inviter = state?.kind === "declined" ? state.inviterName : "người mời";

  const title: string =
    kind === "accepted"
      ? "Lời mời này đã được dùng"
      : kind === "expired"
        ? "Lời mời đã hết hạn"
        : kind === "own"
          ? "Đây là lời mời của chính bạn"
          : kind === "linked"
            ? "Liên hệ này đã được kết nối"
            : kind === "declined"
              ? "Bạn đã từ chối lời mời này"
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
            : kind === "declined"
              ? `Nếu bạn đổi ý, bạn có thể vào AVORA và tìm ${inviter} bằng mã PIN.`
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
            : kind === "declined"
              ? HandHeart
              : SearchX;

  return (
    <>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/50 text-muted-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[20px] font-semibold tracking-tight text-foreground">{title}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
      <Button variant="outline" className="press mt-6 h-10 px-4" onClick={onHome}>
        {signedIn ? "Về danh bạ" : "Về trang AVORA"}
      </Button>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="paper flex min-h-[100dvh] flex-1 items-center justify-center scroll-y bg-background px-6 py-12">
      <div className="animate-rise-in w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

export default AcceptContactInvite;
