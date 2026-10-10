import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Gauge } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ARGON_COSTS, browserOf, deviceKindOf, median, type ArgonProfile } from "@/lib/argon-bench";
import { logError } from "@/lib/log";

interface Row {
  readonly profile: ArgonProfile;
  readonly label: string;
  readonly runs: number[];
  readonly error: string | null;
  readonly saved: boolean;
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * `/thu-argon` (S7) — runs both Argon2id costs three times each on this device and stores the
 * timings without any account link, so the vault KDF can be chosen from real iPhone numbers.
 */
const ArgonBench = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState<boolean>(false);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    setRows([]);
    const { argon2id } = await import("hash-wasm");
    const ua = window.navigator.userAgent;
    const kind = deviceKindOf(ua, window.navigator.maxTouchPoints ?? 0);
    const browser = browserOf(ua);
    const standalone = isStandalone();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    for (const cost of ARGON_COSTS) {
      const runs: number[] = [];
      let error: string | null = null;
      for (let i = 0; i < 3; i += 1) {
        try {
          const started = performance.now();
          await argon2id({
            password: "avora-bench",
            salt,
            parallelism: 1,
            iterations: cost.iterations,
            memorySize: cost.memoryKiB,
            hashLength: 32,
            outputType: "binary",
          });
          runs.push(Math.round(performance.now() - started));
          setRows((prev) => [...prev.filter((r) => r.profile !== cost.profile), { profile: cost.profile, label: cost.label, runs: [...runs], error: null, saved: false }]);
        } catch (caught: unknown) {
          error = (caught instanceof Error ? caught.message : "lỗi").slice(0, 120);
          break;
        }
      }
      const { error: saveError } = await supabase.rpc("record_argon_bench", {
        p_device_kind: kind,
        p_browser: browser,
        p_standalone: standalone,
        p_profile: cost.profile,
        p_runs_ms: runs,
        p_error: error,
      });
      if (saveError !== null) logError("argon-bench", { code: saveError.code });
      setRows((prev) => [
        ...prev.filter((r) => r.profile !== cost.profile),
        { profile: cost.profile, label: cost.label, runs, error, saved: saveError === null },
      ]);
    }
    setRunning(false);
  }, []);

  return (
    <div className="paper min-h-[100dvh] px-5 pb-16 pt-[max(env(safe-area-inset-top),20px)]">
      <div className="mx-auto max-w-lg">
        <Link to="/cai-dat/huong-dan" className="press -ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[15px] text-muted-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Cài đặt
        </Link>
        <h1 className="mt-4 flex items-center gap-2 text-[26px] font-semibold tracking-tight text-foreground">
          <Gauge className="h-6 w-6 text-primary" aria-hidden /> Thử tốc độ máy
        </h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
          AVORA đo xem máy này mất bao lâu để khoá Mật khẩu Két sắt. Kết quả chỉ gồm loại máy, trình duyệt và
          thời gian — không gắn với tài khoản của bạn. Mất khoảng 5 giây.
        </p>
        <button
          type="button"
          data-argon-run
          disabled={running}
          onClick={() => void run()}
          className="press mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-5 text-[16px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {running ? "Đang đo…" : rows.length > 0 ? "Đo lại" : "Bắt đầu đo"}
        </button>
        <ul className="mt-6 space-y-3">
          {rows.map((row) => (
            <li key={row.profile} data-argon-row={row.profile} className="rounded-card border border-border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold text-foreground">{row.label}</span>
                <span className="font-mono text-[15px] tabular-nums text-foreground">
                  {median(row.runs) === null ? "—" : `${median(row.runs)} ms`}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {row.runs.join(" · ") || "chưa có"}
                {row.error !== null ? ` · Lỗi: ${row.error}` : ""}
                {row.saved ? " · Đã gửi" : ""}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[13px] text-muted-foreground">
          Trên iPhone: mở một lần trong Safari và một lần từ biểu tượng AVORA trên Màn hình chính.
        </p>
      </div>
    </div>
  );
};

export default ArgonBench;
