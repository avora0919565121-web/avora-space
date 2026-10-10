import { Check, Loader2, LogOut, MonitorX } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { DeviceSecuritySection } from "@/components/DeviceSecurity";
import { askConfirm } from "@/components/ConfirmHost";
import { PinSetup, usePinStatus } from "@/components/PinGate";
import { RevealButton, useReveal } from "@/components/RevealContact";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useDisplayName } from "@/lib/auth";
import { maskEmail, maskPhone } from "@/lib/mask";
import { pinDaysLeft } from "@/lib/user-pin";

/** Signed-in confirmation screen: real profile data from Supabase, scoped by RLS to this user. */
const Profile = () => {
  const { user, profile, profileError, updateDisplayName, signOut, signOutOthers } = useAuth();
  const displayName = useDisplayName();
  const navigate = useNavigate();
  const location = useLocation();
  const pinQuery = usePinStatus();
  const myPin: string | null = pinQuery.data?.pin ?? null;
  const daysLeft: number | null = pinDaysLeft(pinQuery.data?.requiredAt ?? null);
  const reveal = useReveal();

  // AVORA-102: `Cho phép mở trên máy khác` from Két sắt lands on Bảo mật (#bao-mat).
  useEffect(() => {
    if (location.hash !== "#bao-mat") return;
    const id = window.setTimeout(() => document.getElementById("bao-mat")?.scrollIntoView({ block: "start" }), 120);
    return () => window.clearTimeout(id);
  }, [location.hash]);

  const [nameDraft, setNameDraft] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isSigningOutOthers, setIsSigningOutOthers] = useState<boolean>(false);

  useEffect(() => {
    setNameDraft(profile?.display_name ?? "");
  }, [profile?.display_name]);

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setIsSaving(true);
    const result = await updateDisplayName(nameDraft);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate("/dang-nhap", { replace: true });
  };

  /**
   * AVORA-54 · C — ends every other session of this account. The notice (a `security` push and
   * the alarm email) rides on the server RPC; a failed notice is not worth blocking the answer.
   */
  const handleSignOutOthers = async (): Promise<void> => {
    const ok = await askConfirm({
      title: "Đăng xuất mọi thiết bị khác?",
      body: "Các thiết bị khác sẽ phải đăng nhập lại ở lần thao tác kế tiếp, và Két sắt trên chúng tự khoá.",
      confirmLabel: "Đăng xuất",
      danger: true,
    });
    if (!ok || isSigningOutOthers) return;
    setIsSigningOutOthers(true);
    try {
      const result = await signOutOthers();
      if (!result.ok) {
        toast.error(result.message ?? "Không đăng xuất được. Thử lại nhé.");
        return;
      }
      await supabase.rpc("security_signout_notice").then(
        () => undefined,
        () => undefined,
      );
      toast.success("Đã đăng xuất mọi thiết bị khác.");
    } finally {
      setIsSigningOutOthers(false);
    }
  };

  const joinedAt = profile?.created_at
    ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
        new Date(profile.created_at),
      )
    : "—";

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div data-under-tabs="" className="mx-auto max-w-2xl animate-rise-in px-6 pb-12 pt-4 md:px-10">
        {/* AVORA-53 · 6.5: the tab names the page; no second large title, and the email shows once (below). */}
        <div className="flex items-center gap-s-2">
          <InitialsAvatar name={displayName} size="lg" online />
          <p className="min-w-0 truncate text-[20px] font-semibold tracking-tight text-foreground">{displayName}</p>
        </div>

        <div className="mt-s-4 rounded-card border border-border bg-card p-s-4">
          <h2 className="text-[17px] font-semibold text-foreground">Hồ sơ của bạn</h2>
          {/* AVORA-55 · 3.2 (ADR-020 / ADR-034): never promise more than is true — others still see name and photo. */}
          <p className="mt-1 text-[13px] text-muted-foreground">Chỉ bạn sửa được hồ sơ này.</p>

          {profileError ? (
            <p role="alert" className="mt-s-2 rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
              {profileError}
            </p>
          ) : null}

          <form onSubmit={handleSave} className="mt-s-4 space-y-s-2">
            <div className="space-y-2">
              <label htmlFor="profileName" className="block text-[14px] font-medium text-foreground">
                Tên hiển thị
              </label>
              <input
                id="profileName"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Chưa đặt tên"
                className="h-12 w-full rounded-md border border-border bg-card px-4 text-[16px] md:text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-personal/70"
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="press flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Lưu thay đổi
              </button>
              {saved ? (
                <span role="status" className="flex items-center gap-1.5 text-[14px] text-online">
                  <Check className="h-4 w-4" strokeWidth={2} />
                  Đã lưu
                </span>
              ) : null}
            </div>
          </form>

          <dl className="mt-s-4 grid gap-s-2 border-t border-border pt-s-4 sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-muted-foreground">Email đăng nhập</dt>
              <dd className="mt-1 truncate text-[15px] text-foreground" translate="no">
                {reveal.isRevealed ? user?.email : maskEmail(user?.email)}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Ngày tạo hồ sơ</dt>
              <dd className="tabular mt-1 text-[15px] text-foreground">{joinedAt}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">PIN AVORA · vĩnh viễn</dt>
              <dd className="tabular mt-1 text-[15px] font-semibold tracking-[0.08em] text-foreground">
                {myPin ?? (pinQuery.isPending ? "…" : "Chưa có")}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Số điện thoại</dt>
              <dd className="mt-1 truncate text-[15px] text-foreground">
                {user?.phone ? (
                  <span translate="no">{reveal.isRevealed ? user.phone : maskPhone(user.phone)}</span>
                ) : (
                  <span className="text-muted-foreground">Chưa có — bổ sung sau cũng được</span>
                )}
              </dd>
            </div>
          </dl>
          <div className="mt-2 flex justify-end">
            <RevealButton isRevealed={reveal.isRevealed} secondsLeft={reveal.secondsLeft} onAsk={reveal.ask} onHide={reveal.hide} />
          </div>
          {reveal.dialog}

          {/* No PIN yet: the form sits right here, the natural place to get one early (AVORA 33). */}
          {pinQuery.data !== undefined && myPin === null ? (
            <section aria-label="Tạo PIN AVORA" className="mt-s-4 border-t border-border pt-s-4">
              <h3 className="text-[15px] font-semibold text-foreground">Tạo PIN AVORA</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                PIN là mã định danh riêng của bạn, dùng để người khác mời bạn. Không phải mật khẩu — nhưng đã chọn thì
                không đổi được.
                {daysLeft !== null && daysLeft > 0 ? ` Còn ${daysLeft} ngày để tạo.` : ""}
              </p>
              <div className="mt-s-2">
                <PinSetup />
              </div>
            </section>
          ) : null}
        </div>

        {/* AVORA-54 · C: sign out everywhere else, right where the account lives. */}
        <section id="bao-mat" aria-labelledby="security-heading" className="mt-s-4 scroll-mt-4 rounded-card border border-border bg-card p-s-4">
          <h2 id="security-heading" className="text-[17px] font-semibold text-foreground">Bảo mật</h2>
          {/* AVORA-67 · 3.1: lock strip · Thiết bị · Đăng xuất mọi thiết bị khác · Khoá thiết bị · Két sắt. */}
          <DeviceSecuritySection
            signOutOthers={
              <button
                type="button"
                onClick={() => void handleSignOutOthers()}
                disabled={isSigningOutOthers}
                className="press flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
              >
                {isSigningOutOthers ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorX className="h-[18px] w-[18px]" strokeWidth={1.6} />}
                Đăng xuất mọi thiết bị khác
              </button>
            }
          />
          {/* AVORA-66: every privacy promise lives in one place. */}
          <a href="/cai-dat/chinh-sach#bao-mat" className="press mt-s-2 flex min-h-11 items-center justify-between rounded-md px-1 text-[14px] font-medium text-primary" data-policy-link="">
            Chính sách bảo mật <span aria-hidden="true">›</span>
          </a>
        </section>

        <button
          type="button"
          onClick={handleSignOut}
          className="press mt-s-4 flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Đăng xuất
        </button>
      </div>
    </div>
  );
};

export default Profile;
