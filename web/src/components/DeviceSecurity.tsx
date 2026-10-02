import { ChevronDown, Laptop, Loader2, Lock, MoreHorizontal, Smartphone, Tablet } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { askText } from "@/components/ConfirmHost";
import { deviceApi, deviceLabelOf, isIosSafariTab, type MyDevice } from "@/lib/device";
import { isGuestMachine } from "@/lib/guest-machine";
import { useDeviceStatus, useInvalidateDevices, useMyDevices } from "@/lib/use-device";
import { cn } from "@/lib/utils";

const PROMPT_KEY = "avora.device.rank-prompted";

function when(at: string | null): string {
  if (at === null || at === "") return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

function sinceLabel(at: string): string {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 5) return "đang dùng";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

/** One password (and, when the rank is held, one email code) — the only two keys that move a rank. */
function PasswordDialog({
  open,
  title,
  body,
  confirmLabel,
  needsCode = false,
  onRequestCode,
  extra,
  onSubmit,
  onClose,
  danger = false,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  needsCode?: boolean;
  onRequestCode?: () => Promise<void>;
  extra?: ReactNode;
  onSubmit: (password: string, code: string | null) => Promise<void>;
  onClose: () => void;
  danger?: boolean;
}) {
  const [password, setPassword] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [codeSent, setCodeSent] = useState<boolean>(false);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  useEffect(() => {
    if (!open) {
      setPassword("");
      setCode("");
      setCodeSent(false);
    }
  }, [open]);
  const submit = async (): Promise<void> => {
    setIsWorking(true);
    try {
      await onSubmit(password, needsCode ? code : null);
      onClose();
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Chưa làm được.");
    } finally {
      setIsWorking(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogTitle className="text-[18px]">{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="text-[14px] leading-relaxed text-muted-foreground">{body}</div>
        </DialogDescription>
        {extra}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="text-[13px] font-medium text-foreground">Mật khẩu tài khoản</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-personal md:text-[15px]" />
          </label>
          {needsCode ? (
            <div>
              <span className="text-[13px] font-medium text-foreground">Mã 6 số gửi qua email</span>
              <div className="mt-1 flex gap-2">
                <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-[16px] tracking-[0.3em] outline-none focus:border-personal" aria-label="Mã 6 số" />
                <button
                  type="button"
                  className="press h-11 shrink-0 rounded-lg border border-border px-3 text-[13px] font-medium"
                  onClick={() =>
                    void onRequestCode?.().then(
                      () => {
                        setCodeSent(true);
                        toast.success("Đã gửi mã tới email của bạn.");
                      },
                      (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Chưa gửi được."),
                    )
                  }
                >
                  {codeSent ? "Gửi lại" : "Gửi mã"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="press h-11 rounded-lg px-4 text-[14px] text-muted-foreground">Huỷ</button>
            <button
              type="submit"
              disabled={isWorking || password === "" || (needsCode && code.length !== 6)}
              className={cn("press flex h-11 items-center gap-2 rounded-lg px-4 text-[14px] font-semibold disabled:opacity-50", danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}
            >
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {confirmLabel}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function useSetRank() {
  const invalidate = useInvalidateDevices();
  return async (rank: 1 | 2, password: string, code: string | null): Promise<void> => {
    const result = await deviceApi.setRank(rank, password, code);
    invalidate();
    toast.success(result.took_from ? `Máy này là Ưu tiên ${rank}. ${result.took_from} đã thành Máy khác.` : `Máy này là Ưu tiên ${rank}.`);
  };
}

/** 3.2 — asked once per device: a phone suggests Ưu tiên 1, a computer Ưu tiên 2. `Để sau` never asks again. */
export function DeviceRankPrompt() {
  const { status } = useDeviceStatus();
  const setRank = useSetRank();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(PROMPT_KEY) === "1";
    } catch {
      return true;
    }
  });
  const [isPassword, setIsPassword] = useState<boolean>(false);
  const { kind } = deviceLabelOf(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const suggested: 1 | 2 = kind === "phone" ? 1 : 2;
  const close = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(PROMPT_KEY, "1");
    } catch {
      // Without storage it may ask once more next time.
    }
  };
  if (dismissed || status === undefined || !status.allowed || status.device === null || status.guest || isGuestMachine()) return null;
  if (status.myRank !== 3 || status.rankTaken[suggested] || kind === "unknown") return null;
  return (
    <>
      <div role="dialog" aria-labelledby="rank-prompt-title" data-rank-prompt="" className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-50 mx-auto max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl md:bottom-6">
        <h2 id="rank-prompt-title" className="text-[17px] font-semibold text-foreground">Đặt máy này là máy chính?</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
          Điện thoại nên là <strong className="text-foreground">Ưu tiên 1</strong>, máy tính là <strong className="text-foreground">Ưu tiên 2</strong>. Máy chính quản lý được các máy khác và mở được Két sắt.
        </p>
        {suggested === 1 && isIosSafariTab() ? (
          <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-[13px] text-foreground">
            Mẹo: thêm AVORA vào Màn hình chính (Chia sẻ › Thêm vào MH chính). Safari mở trong tab có thể xoá dữ liệu trang sau 7 ngày không dùng — khi đó máy phải đặt lại.
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} className="press h-11 rounded-lg px-4 text-[14px] text-muted-foreground">Để sau</button>
          <button type="button" onClick={() => setIsPassword(true)} className="press h-11 rounded-lg bg-primary px-4 text-[14px] font-semibold text-primary-foreground">Đặt Ưu tiên {suggested}</button>
        </div>
      </div>
      <PasswordDialog
        open={isPassword}
        title={`Đặt Ưu tiên ${suggested}`}
        body="Nhập mật khẩu tài khoản để xác nhận đây là máy của bạn."
        confirmLabel={`Đặt Ưu tiên ${suggested}`}
        onSubmit={async (password) => {
          await setRank(suggested, password, null);
          close();
        }}
        onClose={() => setIsPassword(false)}
      />
    </>
  );
}

const KIND_ICON = { phone: Smartphone, tablet: Tablet, computer: Laptop, unknown: Laptop } as const;

type Pending =
  | { kind: "rank"; rank: 1 | 2; held: boolean }
  | { kind: "lost"; device: MyDevice }
  | { kind: "lock"; on: boolean }
  | { kind: "vault"; on: boolean }
  | null;

/** 3.1 — Cài đặt › Hồ sơ › Bảo mật: lock strip · Ưu tiên 1 · Ưu tiên 2 · Máy khác · Khoá thiết bị · Két sắt. */
export function DeviceSecuritySection({ signOutOthers }: { signOutOthers: ReactNode }) {
  const { status } = useDeviceStatus();
  const { devices } = useMyDevices(status?.allowed === true);
  const invalidate = useInvalidateDevices();
  const setRank = useSetRank();
  const [pending, setPending] = useState<Pending>(null);
  const [lostDays, setLostDays] = useState<3 | 7>(3);
  const [othersOpen, setOthersOpen] = useState<boolean>(false);
  const [offerLock, setOfferLock] = useState<boolean>(false);
  const myRank = status?.myRank ?? null;
  const isRanked = myRank === 1 || myRank === 2;
  const byRank = (rank: 1 | 2): MyDevice | undefined => devices.find((d) => d.rank === rank);
  const others = devices.filter((d) => d.rank === 3);
  const lock = status?.lock ?? null;
  const canTurnOffLock = lock !== null && (myRank === 1 || (myRank === 2 && lock.rank === 2));

  const act = (run: () => Promise<unknown>, done: string): void =>
    void run().then(
      () => {
        invalidate();
        toast.success(done);
      },
      (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Chưa làm được."),
    );

  const deviceRow = (device: MyDevice | undefined, rank: 1 | 2 | 3): ReactNode => {
    if (device === undefined) {
      return (
        <li key={`empty-${rank}`} className="flex min-h-14 items-center gap-3 px-3" data-device-row={`empty-${rank}`}>
          <span className="w-[84px] shrink-0 text-[12.5px] font-semibold text-muted-foreground">Ưu tiên {rank}</span>
          <span className="min-w-0 flex-1 text-[14px] text-muted-foreground">Chưa đặt</span>
          {rank !== 3 && !status?.guest && status?.device !== null ? (
            <button type="button" onClick={() => setPending({ kind: "rank", rank, held: false })} className="press h-9 shrink-0 rounded-md border border-border px-3 text-[13px] font-medium">Đặt máy này</button>
          ) : null}
        </li>
      );
    }
    const Icon = KIND_ICON[device.kind];
    return (
      <li key={device.id} className="flex min-h-14 items-center gap-3 px-3" data-device-row={device.id}>
        {rank !== 3 ? <span className="w-[84px] shrink-0 text-[12.5px] font-semibold text-primary">Ưu tiên {rank}</span> : null}
        <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-medium text-foreground">{device.label}</span>
            {device.isMe ? <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary">Máy này</span> : null}
          </span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {device.lostStatus === "pending" ? `Đã báo mất · chờ xác nhận tới ${when(device.lostDeadline)}` : sinceLabel(device.lastSeenAt)}
            {device.canOpenVault ? " · Mở được Két sắt" : ""}
          </span>
        </span>
        {!device.isMe && rank !== 3 && isRanked && !status?.rankTaken[rank] ? null : null}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Tuỳ chọn cho ${device.label}`} className="icon-btn h-10 w-10 shrink-0">
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onSelect={() =>
                void askText({ title: "Đổi tên máy", initial: device.label, maxLength: 60, confirmLabel: "Lưu" }).then((label) => {
                  if (label !== null && label.trim() !== "") act(() => deviceApi.rename(device.id, label.trim()), "Đã đổi tên.");
                })
              }
            >
              Đổi tên
            </DropdownMenuItem>
            {device.isMe && rank === 3 && !device.guest ? (
              <>
                <DropdownMenuItem onSelect={() => setPending({ kind: "rank", rank: 1, held: status?.rankTaken[1] === true })}>Đặt làm Ưu tiên 1</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPending({ kind: "rank", rank: 2, held: status?.rankTaken[2] === true })}>Đặt làm Ưu tiên 2</DropdownMenuItem>
              </>
            ) : null}
            {device.canReportLost ? (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setPending({ kind: "lost", device })}>
                Tôi mất thiết bị này
              </DropdownMenuItem>
            ) : null}
            {device.canRevoke ? (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => act(() => deviceApi.revoke(device.id), `Đã ngắt ${device.label}.`)}>
                Ngắt
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    );
  };

  return (
    <div className="mt-4 space-y-5" data-device-security="">
      {lock !== null ? (
        <div className="flex items-center gap-3 rounded-lg border border-[hsl(14_70%_60%)] bg-[hsl(14_80%_95%)] px-3 py-2.5 text-[14px] text-[hsl(14_60%_28%)] dark:bg-[hsl(14_40%_16%)] dark:text-[hsl(14_80%_80%)]" data-lock-strip="">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            Đang khoá thiết bị · từ {when(lock.at)}
            {lock.escapeAt !== null ? <span className="block text-[12.5px]">Có yêu cầu tắt khoá lúc {when(lock.escapeAt)}</span> : null}
          </span>
          {lock.escapeAt !== null && isRanked ? (
            <button type="button" onClick={() => act(() => deviceApi.cancelEscape(), "Đã huỷ yêu cầu tắt khoá.")} className="press h-9 rounded-md border border-current px-3 text-[13px] font-medium">Huỷ</button>
          ) : null}
          {canTurnOffLock ? (
            <button type="button" onClick={() => setPending({ kind: "lock", on: false })} className="press h-9 rounded-md bg-destructive px-3 text-[13px] font-semibold text-destructive-foreground">Tắt</button>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Thiết bị</h3>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {deviceRow(byRank(1), 1)}
          {deviceRow(byRank(2), 2)}
        </ul>
        {others.length > 0 ? (
          <div className="mt-2 rounded-lg border border-border">
            <button type="button" onClick={() => setOthersOpen((v) => !v)} aria-expanded={othersOpen} className="press flex min-h-12 w-full items-center gap-2 px-3 text-left">
              <span className="text-[14px] font-medium">Máy khác</span>
              <span className="tabular text-[12.5px] text-muted-foreground">({others.length})</span>
              <ChevronDown className={cn("ml-auto h-4 w-4 text-muted-foreground transition-transform", othersOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {othersOpen ? <ul className="divide-y divide-border border-t border-border">{others.map((d) => deviceRow(d, 3))}</ul> : null}
          </div>
        ) : null}
      </div>

      <div>
        {signOutOthers}
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">Đăng xuất ngay. Bạn đăng nhập lại bình thường trên máy bạn muốn.</p>
      </div>

      {isRanked ? (
        <div>
          <button
            type="button"
            onClick={() => setPending({ kind: "lock", on: lock === null })}
            disabled={lock !== null && !canTurnOffLock}
            className="press flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-4 text-[14px] font-medium text-foreground hover:bg-accent/40 disabled:opacity-50"
            data-device-lock-button=""
          >
            <Lock className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
            {lock === null ? "Khoá thiết bị" : "Tắt Khoá thiết bị"}
          </button>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">Khi nghi có người lạ. Mọi máy khác bị đăng xuất và không ai đăng nhập thêm được cho tới khi bạn tắt.</p>
        </div>
      ) : null}

      <label className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-foreground">Cho phép mở Két sắt trên máy khác</span>
          <span className="block text-[12.5px] text-muted-foreground">Tắt: Két sắt chỉ mở trên Ưu tiên 1 và 2.</span>
        </span>
        <Switch
          checked={status?.vaultOtherAllowed === true}
          disabled={!isRanked}
          onCheckedChange={(on) => setPending({ kind: "vault", on })}
          aria-label="Cho phép mở Két sắt trên máy khác"
        />
      </label>

      <PasswordDialog
        open={pending?.kind === "rank"}
        title={pending?.kind === "rank" ? `Đặt máy này là Ưu tiên ${pending.rank}` : ""}
        body={
          pending?.kind === "rank" && pending.held
            ? "Bậc này đang có máy giữ. Cần mật khẩu tài khoản và mã gửi qua email. Máy cũ sẽ bị đăng xuất, thành Máy khác và nhận báo động."
            : "Nhập mật khẩu tài khoản để xác nhận."
        }
        confirmLabel="Đặt"
        needsCode={pending?.kind === "rank" && pending.held}
        onRequestCode={async () => {
          if (pending?.kind === "rank") await deviceApi.requestRankCode(pending.rank);
        }}
        onSubmit={async (password, code) => {
          if (pending?.kind === "rank") await setRank(pending.rank, password, code);
        }}
        onClose={() => setPending(null)}
      />
      <PasswordDialog
        open={pending?.kind === "lost"}
        danger
        title={pending?.kind === "lost" ? `Tôi mất ${pending.device.label}` : ""}
        body={
          <>
            Máy này sẽ <strong className="text-foreground">ngừng dùng ngay</strong>. AVORA gửi email để bạn xác nhận. Máy này sẽ không mở được Két sắt nữa.
          </>
        }
        extra={
          <div role="radiogroup" aria-label="Thời gian chờ xác nhận" className="flex gap-2">
            {([3, 7] as const).map((days) => (
              <button key={days} type="button" role="radio" aria-checked={lostDays === days} onClick={() => setLostDays(days)} className={cn("press h-10 flex-1 rounded-lg border text-[14px] font-medium", lostDays === days ? "border-primary bg-primary/10 text-primary" : "border-border")}>
                {days} ngày
              </button>
            ))}
          </div>
        }
        confirmLabel="Báo mất"
        onSubmit={async (password) => {
          if (pending?.kind !== "lost") return;
          await deviceApi.reportLost(pending.device.id, lostDays, password);
          invalidate();
          toast.success("Đã báo mất. Kiểm tra email để xác nhận.");
          if (lock === null) setOfferLock(true);
        }}
        onClose={() => setPending(null)}
      />
      <PasswordDialog
        open={pending?.kind === "lock"}
        danger={pending?.kind === "lock" && pending.on}
        title={pending?.kind === "lock" && pending.on ? "Bật Khoá thiết bị" : "Tắt Khoá thiết bị"}
        body={
          pending?.kind === "lock" && pending.on
            ? myRank === 1
              ? "Chỉ máy này còn vào được. Ưu tiên 2 và mọi máy khác bị đăng xuất ngay."
              : "Ưu tiên 1 và máy này còn vào được. Mọi máy khác bị đăng xuất ngay."
            : "Các máy khác đăng nhập lại bình thường được."
        }
        confirmLabel={pending?.kind === "lock" && pending.on ? "Bật khoá" : "Tắt khoá"}
        onSubmit={async (password) => {
          if (pending?.kind !== "lock") return;
          await deviceApi.setLock(pending.on, password);
          invalidate();
          toast.success(pending.on ? "Đã bật Khoá thiết bị." : "Đã tắt Khoá thiết bị.");
        }}
        onClose={() => setPending(null)}
      />
      <PasswordDialog
        open={pending?.kind === "vault"}
        title={pending?.kind === "vault" && pending.on ? "Cho phép mở Két sắt trên máy khác?" : "Chỉ mở Két sắt trên máy chính?"}
        body={pending?.kind === "vault" && pending.on ? "Máy công ty, máy mượn cũng mở được Két sắt sau khi đúng mã." : "Két sắt chỉ mở trên Ưu tiên 1 và 2."}
        confirmLabel="Xác nhận"
        onSubmit={async (password) => {
          if (pending?.kind !== "vault") return;
          await deviceApi.setVaultOther(pending.on, password);
          invalidate();
        }}
        onClose={() => setPending(null)}
      />
      {offerLock ? (
        <div className="flex items-center gap-3 rounded-lg bg-secondary/60 px-3 py-2.5 text-[13.5px]" role="status" data-offer-lock="">
          <span className="min-w-0 flex-1">Bật Khoá thiết bị luôn? Người nhặt được máy sẽ không đăng nhập lại được bằng cách xoá dữ liệu trình duyệt.</span>
          <button type="button" onClick={() => { setOfferLock(false); setPending({ kind: "lock", on: true }); }} className="press h-9 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground">Bật</button>
          <button type="button" onClick={() => setOfferLock(false)} className="press h-9 rounded-md px-2 text-[13px] text-muted-foreground">Không</button>
        </div>
      ) : null}
    </div>
  );
}
