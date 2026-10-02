import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, ShieldAlert, ShieldOff, Smartphone } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { askPersistentStorage, deviceApi, idbDeleteExcept, runDeviceRevokedHooks, type DeviceStatus } from "@/lib/device";
import { useDeviceStatus } from "@/lib/use-device";
import { cn } from "@/lib/utils";

/**
 * AVORA-67 · 3.4 — when the server says this session may not be used, nothing of the account is
 * shown: the data cache is dropped, every realtime channel is closed (S2), the device's AVORA store
 * is cleared except the device key, and a full-screen block takes over.
 */
export function DeviceGuard({ children }: { children: ReactNode }) {
  const { status } = useDeviceStatus();
  const queryClient = useQueryClient();
  const wipedRef = useRef<boolean>(false);
  const isBlocked = status !== undefined && !status.allowed;

  useEffect(() => {
    void askPersistentStorage();
  }, []);

  useEffect(() => {
    if (!isBlocked || wipedRef.current) return;
    wipedRef.current = true;
    void supabase.removeAllChannels();
    // Keep only the device status itself; every other cached answer goes.
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "device" });
    void idbDeleteExcept(["self"]);
    if (status?.reason === "lost" || status?.reason === "revoked") void runDeviceRevokedHooks();
  }, [isBlocked, queryClient, status?.reason]);

  if (isBlocked && status !== undefined) return <BlockScreen status={status} />;
  return <>{children}</>;
}

function fmt(at: string | null): string {
  if (at === null || at === "") return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** The three block screens of 3.4 — words only, no data of the account. */
export function BlockScreen({ status }: { status: DeviceStatus }) {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState<string>("");
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [note, setNote] = useState<string | null>(null);

  const leave = async (): Promise<void> => {
    await signOut().catch(() => undefined);
    window.location.assign("/dang-nhap");
  };

  const submit = async (): Promise<void> => {
    setIsWorking(true);
    try {
      if (status.reason === "lost") {
        await deviceApi.dispute(password);
        toast.success("Đã báo: không phải bạn báo mất. Máy đã gửi báo bị đăng xuất.");
        await queryClient.invalidateQueries({ queryKey: ["device"] });
      } else {
        const until = await deviceApi.requestEscape(password);
        setNote(`Đã gửi email. Khoá sẽ tự tắt lúc ${fmt(until)} nếu máy chính không bấm Huỷ.`);
      }
      setIsAsking(false);
      setPassword("");
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Chưa làm được.");
    } finally {
      setIsWorking(false);
    }
  };

  const Icon = status.reason === "locked" ? ShieldAlert : status.reason === "lost" ? Smartphone : ShieldOff;
  const title = status.reason === "locked" ? "Tài khoản đang khoá thiết bị" : status.reason === "lost" ? "Máy này đã được báo mất" : "Máy này đã được gỡ";
  const body =
    status.reason === "locked"
      ? "Tài khoản đang được khoá thiết bị. Hãy tắt khoá trên điện thoại hoặc máy tính chính của bạn."
      : status.reason === "lost"
        ? `Máy này đã được báo mất từ ${status.lostBy ?? "một máy khác của bạn"} lúc ${fmt(status.lostAt)}.`
        : "Máy này đã được gỡ khỏi tài khoản.";

  return (
    <div role="alertdialog" aria-labelledby="block-title" data-block-screen={status.reason ?? "revoked"} className="paper fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto px-6 py-[max(env(safe-area-inset-top),24px)]">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(14_70%_92%)] text-[hsl(14_70%_42%)] dark:bg-[hsl(14_40%_20%)] dark:text-[hsl(14_80%_70%)]">
          <Icon className="h-8 w-8" strokeWidth={1.6} aria-hidden="true" />
        </span>
        <h1 id="block-title" className="mt-6 text-[24px] font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
        {note !== null ? <p className="mt-4 rounded-lg bg-secondary/60 px-3 py-2 text-[13.5px] text-foreground" role="status">{note}</p> : null}
        {isAsking ? (
          <form
            className="mt-6 space-y-2 text-left"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block text-[13px] font-medium text-foreground" htmlFor="block-password">Mật khẩu tài khoản</label>
            <input
              id="block-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-personal"
            />
            <button type="submit" disabled={isWorking || password === ""} className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-50">
              {isWorking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Gửi
            </button>
          </form>
        ) : null}
        <div className="mt-6 flex flex-col gap-2">
          {status.reason === "lost" && !isAsking ? (
            <button type="button" onClick={() => setIsAsking(true)} className="press h-12 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground">
              Không phải tôi báo
            </button>
          ) : null}
          {status.reason === "locked" && !isAsking && note === null ? (
            <button type="button" onClick={() => setIsAsking(true)} className="press h-12 rounded-lg border border-border bg-card text-[15px] font-medium text-foreground">
              Tôi không còn máy chính
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void leave()}
            className={cn(
              "press flex h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-medium",
              status.reason === "revoked" ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
            )}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {status.reason === "revoked" ? "Đăng nhập lại" : "Đăng xuất"}
          </button>
        </div>
      </div>
    </div>
  );
}
