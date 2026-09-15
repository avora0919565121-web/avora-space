import { Check, Clock, Coins, Loader2, LogOut, PencilLine, Quote } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { MuteSettingsCard } from "@/components/chat/MuteSettingsCard";
import { useAuth, useDisplayName } from "@/lib/auth";
import { currenciesByRegion, REGION_LABELS } from "@/lib/currency";
import { formatRate } from "@/lib/currency";

import {
  DAILY_THOUGHT_OPTIONS,
  DEFAULT_DAILY_THOUGHT_CATEGORY,
  type DailyThoughtCategory,
} from "@/lib/daily-thoughts";
import { TIMEZONE_OPTIONS } from "@/lib/settings";
import { useCurrencyRates, useProfileSettings, useSettingsActions } from "@/lib/use-settings";

const SELECT_CLASS =
  "h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary/70";

/**
 * Reporting currency, timezone, and the daily thought.
 *
 * Changing the base currency re-values every entry in the ledger — the database rewrites each
 * cached conversion in the same transaction — so the screen says so plainly before it happens
 * rather than letting totals change without explanation.
 */
function PreferencesCard() {
  const { data: settings, isLoading } = useProfileSettings();
  const { data: rates } = useCurrencyRates();
  const { setBaseCurrency, setTimezone, setDailyThoughtCategory, setTypingSignal, isWorking } =
    useSettingsActions();

  const base = settings?.baseCurrency ?? "VND";
  const zone = settings?.timezone ?? "Asia/Ho_Chi_Minh";
  const thoughtCategory = settings?.dailyThoughtCategory ?? DEFAULT_DAILY_THOUGHT_CATEGORY;

  /**
   * Scripture is paused for choosing — but a person who chose it before the pause keeps it
   * in their own list, exactly as they left it. Hiding it from them would silently change
   * what their settings mean; the pause only stops NEW selections.
   */
  const thoughtOptions: readonly { value: DailyThoughtCategory; label: string }[] =
    thoughtCategory === "kinh_thanh"
      ? [{ value: "kinh_thanh", label: "Kinh Thánh" }, ...DAILY_THOUGHT_OPTIONS]
      : DAILY_THOUGHT_OPTIONS;
  const hidesTyping = settings?.hideTypingSignal ?? false;
  const sample = rates === undefined || base === "USD" ? null : formatRate("USD", base, rates);

  const changeBase = async (code: string): Promise<void> => {
    try {
      await setBaseCurrency.mutateAsync(code);
      toast.success("Đã đổi loại tiền báo cáo. Toàn bộ sổ sách đã được tính lại.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được thiết lập.");
    }
  };

  const changeZone = async (value: string): Promise<void> => {
    try {
      await setTimezone.mutateAsync(value);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được thiết lập.");
    }
  };

  const changeThought = async (value: string): Promise<void> => {
    try {
      await setDailyThoughtCategory.mutateAsync(value);
      toast.success(
        value === "khong_chon" ? "Đã tắt Daily Thought." : "Đã lưu lựa chọn Daily Thought.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được thiết lập.");
    }
  };

  const changeTypingSignal = async (hide: boolean): Promise<void> => {
    try {
      await setTypingSignal.mutateAsync(hide);
      toast.success(
        hide
          ? "Đã tắt tín hiệu đang nhập của bạn."
          : "Đã bật lại tín hiệu đang nhập của bạn.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được thiết lập.");
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-6">
      <h2 className="text-[17px] font-semibold text-foreground">Thiết lập</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Loại tiền dùng để cộng gộp báo cáo, múi giờ dùng cho giờ hạn của nhiệm vụ, và câu suy ngẫm
        mở đầu ngày.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-8" role="status" aria-label="Đang tải thiết lập">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <label htmlFor="baseCurrency" className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Coins className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
              Loại tiền báo cáo
            </label>
            <select
              id="baseCurrency"
              value={base}
              disabled={isWorking}
              onChange={(event) => void changeBase(event.target.value)}
              className={SELECT_CLASS}
            >
              {currenciesByRegion().map((group) => (
                <optgroup key={group.region} label={REGION_LABELS[group.region]}>
                  {group.currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Mọi tài khoản giữ nguyên loại tiền của nó; chỉ các con số tổng được quy đổi sang đây.
              {sample === null ? null : ` Hiện 1 USD ≈ ${sample} ${base}.`}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="timezone" className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
              Múi giờ
            </label>
            <select
              id="timezone"
              value={zone}
              disabled={isWorking}
              onChange={(event) => void changeZone(event.target.value)}
              className={SELECT_CLASS}
            >
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Giờ hạn “14:00” nghĩa là 14:00 ở múi giờ này.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="dailyThought"
              className="flex items-center gap-2 text-[14px] font-medium text-foreground"
            >
              <Quote className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
              Daily Thought
            </label>
            <select
              id="dailyThought"
              value={thoughtCategory}
              disabled={isWorking}
              onChange={(event) => void changeThought(event.target.value)}
              className={SELECT_CLASS}
            >
              {thoughtOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Một câu mỗi ngày trên Avora Space. Chọn “Ẩn” nếu bạn không muốn hiển thị.
            </p>
          </div>

          {/*
            One-directional on purpose: this silences the signal you SEND and leaves you
            seeing everyone else's. Making it a trade would turn a privacy choice into a
            price, and most people would keep it on for the wrong reason.
          */}
          <div className="space-y-2 border-t border-border pt-5">
            <label
              htmlFor="hideTyping"
              className="flex items-start gap-3 text-[14px] font-medium text-foreground"
            >
              <input
                id="hideTyping"
                type="checkbox"
                checked={hidesTyping}
                disabled={isWorking}
                onChange={(event) => void changeTypingSignal(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <PencilLine
                    className="h-4 w-4 text-muted-foreground"
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                  Không hiển thị cho người khác khi tôi đang nhập
                </span>
                <span className="mt-1 block text-[12px] font-normal leading-5 text-muted-foreground">
                  Chỉ tắt tín hiệu của bạn. Bạn vẫn thấy khi người khác đang nhập.
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

/** Signed-in confirmation screen: real profile data from Supabase, scoped by RLS to this user. */
const Profile = () => {
  const { user, profile, profileError, updateDisplayName, signOut } = useAuth();
  const displayName = useDisplayName();
  const navigate = useNavigate();

  const [nameDraft, setNameDraft] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

  const joinedAt = profile?.created_at
    ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
        new Date(profile.created_at),
      )
    : "—";

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl animate-rise-in px-6 py-12 md:px-10">
        <div className="flex items-center gap-4">
          <InitialsAvatar name={displayName} size="lg" online />
          <div className="min-w-0">
            <h1 className="truncate text-[28px] font-semibold tracking-tight text-foreground">
              Xin chào, {displayName}
            </h1>
            <p className="mt-1 truncate text-[15px] text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-card p-6">
          <h2 className="text-[17px] font-semibold text-foreground">Hồ sơ của bạn</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Chỉ bạn đọc và sửa được hồ sơ này — được bảo vệ bằng Row Level Security.
          </p>

          {profileError ? (
            <p role="alert" className="mt-4 rounded-md bg-accent/70 px-4 py-3 text-[14px] text-destructive">
              {profileError}
            </p>
          ) : null}

          <form onSubmit={handleSave} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="profileName" className="block text-[14px] font-medium text-foreground">
                Tên hiển thị
              </label>
              <input
                id="profileName"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder="Chưa đặt tên"
                className="h-12 w-full rounded-md border border-border bg-card px-4 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/70"
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

          <dl className="mt-8 grid gap-4 border-t border-border pt-6 sm:grid-cols-2">
            <div>
              <dt className="text-[13px] text-muted-foreground">Email đăng nhập</dt>
              <dd className="mt-1 truncate text-[15px] text-foreground">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-muted-foreground">Ngày tạo hồ sơ</dt>
              <dd className="tabular mt-1 text-[15px] text-foreground">{joinedAt}</dd>
            </div>
          </dl>
        </div>

        <PreferencesCard />

        <MuteSettingsCard />

        <button
          type="button"
          onClick={handleSignOut}
          className="press mt-6 flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.6} />
          Đăng xuất
        </button>
      </div>
    </div>
  );
};

export default Profile;
