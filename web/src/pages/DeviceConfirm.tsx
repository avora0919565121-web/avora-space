import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/auth";

/**
 * AVORA-67 · 2.3 — `/xac-nhan-thiet-bi?t=…`, the page behind the email links. No sign-in. Opening it
 * only describes the link (mail scanners open links on their own); nothing changes until a button is
 * pressed. Shows only the device label and a time — no email, PIN or full name.
 */
type Info = { status: "open" | "used" | "expired" | "invalid"; kind?: "lost_confirm" | "not_me_rank" | "lock_escape"; label?: string | null; when?: string; claimer?: string | null };

const endpoint = (): string => `${import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string}/functions/v1/device-action`;

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

const RESULT: Record<string, string> = {
  confirm: "Đã xác nhận. Máy đó được gỡ hẳn khỏi tài khoản.",
  reject: "Đã ghi nhận: bạn không báo mất. Máy bị báo được dùng lại; máy đã gửi báo bị đăng xuất. Nên đổi mật khẩu tài khoản.",
  found: "Đã ghi nhận: bạn tìm lại được thiết bị. Mọi thứ trở lại như cũ.",
  not_me_rank: "Đã lấy lại bậc cho máy cũ và gỡ máy đã chiếm bậc. Nên đổi mật khẩu tài khoản ngay.",
  cancel_escape: "Đã huỷ yêu cầu tắt Khoá thiết bị.",
};

const DeviceConfirm = () => {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState<string>("");
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setInfo({ status: "invalid" });
      return;
    }
    void post({ op: "info", token }).then(
      ({ ok, data }) => setInfo(ok ? (data as Info) : { status: "invalid" }),
      () => setInfo({ status: "invalid" }),
    );
  }, [token]);

  const choose = async (choice: string): Promise<void> => {
    setIsWorking(true);
    setError(null);
    try {
      const { ok, data } = await post({ token, choice, password: choice === "not_me_rank" ? password : undefined });
      if (ok && data.ok === true) setDone(RESULT[choice] ?? "Đã xong.");
      else if (data.reason === "password") setError("Mật khẩu tài khoản chưa đúng.");
      else if (String(data.error ?? "").includes("used")) setError("Liên kết này đã được dùng.");
      else if (String(data.error ?? "").includes("expired")) setError("Liên kết đã hết hạn.");
      else if (String(data.error ?? "").includes("rate")) setError("Thử sai nhiều lần. Liên kết đã bị khoá.");
      else setError("Chưa làm được. Thử lại nhé.");
    } catch {
      setError("Không kết nối được. Kiểm tra mạng rồi thử lại.");
    } finally {
      setIsWorking(false);
    }
  };

  const label = info?.label ?? "Thiết bị";
  // AVORA-94B · PHẦN C: every end state has a way on — into AVORA when signed in, else to sign in.
  const exit = (
    <a href={session !== null ? "/tong-quan" : "/dang-nhap"} data-device-exit="" className="press mt-6 inline-flex min-h-11 items-center rounded-md border border-border bg-card px-5 text-[14px] font-medium text-foreground">
      {session !== null ? "Mở AVORA" : "Đăng nhập"}
    </a>
  );
  const btn = "press flex min-h-12 w-full items-center justify-center rounded-lg px-4 text-[15px] font-semibold disabled:opacity-50";

  return (
    <div className="paper flex min-h-[100dvh] items-center justify-center px-6 py-10" data-device-confirm={info?.kind ?? info?.status ?? "loading"}>
      <div className="w-full max-w-sm">
        <span className="wordmark text-[15px] text-muted-foreground">AVORA</span>
        {info === null ? (
          <Loader2 className="mt-10 h-6 w-6 animate-spin text-muted-foreground" aria-label="Đang tải" />
        ) : done !== null ? (
          <div className="mt-8" role="status">
            <ShieldCheck className="h-10 w-10 text-primary" strokeWidth={1.6} aria-hidden="true" />
            <p className="mt-4 text-[17px] leading-relaxed text-foreground">{done}</p>
            {exit}
          </div>
        ) : info.status !== "open" ? (
          <div className="mt-8">
            <p className="text-[17px] text-foreground">
              {info.status === "used" ? "Liên kết này đã được dùng." : info.status === "expired" ? "Liên kết đã hết hạn." : "Liên kết không hợp lệ."}
            </p>
            {exit}
          </div>
        ) : (
          <div className="mt-8">
            {info.kind === "lost_confirm" ? (
              <>
                <h1 className="text-[24px] font-semibold tracking-tight">Xác nhận báo mất</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">{label}</strong> được báo mất lúc {info.when}. Máy đó đang ngừng dùng.
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  <button type="button" disabled={isWorking} onClick={() => void choose("confirm")} className={`${btn} bg-primary text-primary-foreground`}>Đúng, tôi đã báo</button>
                  <button type="button" disabled={isWorking} onClick={() => void choose("reject")} className={`${btn} border border-destructive/40 text-destructive`}>Sai — tôi không báo mất</button>
                  <button type="button" disabled={isWorking} onClick={() => void choose("found")} className={`${btn} border border-border text-foreground`}>Tôi đã tìm lại thiết bị</button>
                </div>
              </>
            ) : info.kind === "not_me_rank" ? (
              <>
                <h1 className="text-[24px] font-semibold tracking-tight">Không phải tôi</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                  {info.claimer ?? "Một máy"} đã nhận bậc của <strong className="text-foreground">{label}</strong> lúc {info.when}. Nhập mật khẩu tài khoản để lấy lại bậc và gỡ máy kia.
                </p>
                <form
                  className="mt-5 space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void choose("not_me_rank");
                  }}
                >
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Mật khẩu tài khoản" placeholder="Mật khẩu tài khoản" className="h-12 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-personal" />
                  <button type="submit" disabled={isWorking || password === ""} className={`${btn} bg-destructive text-destructive-foreground`}>Không phải tôi</button>
                </form>
              </>
            ) : (
              <>
                <h1 className="text-[24px] font-semibold tracking-tight">Huỷ yêu cầu tắt khoá</h1>
                <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">Có yêu cầu tắt Khoá thiết bị lúc {info.when}. Không phải bạn thì bấm Huỷ.</p>
                <button type="button" disabled={isWorking} onClick={() => void choose("cancel_escape")} className={`${btn} mt-6 bg-primary text-primary-foreground`}>Huỷ yêu cầu</button>
              </>
            )}
            {isWorking ? <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
            {error !== null ? <p className="mt-4 text-[14px] text-destructive" role="alert">{error}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeviceConfirm;
