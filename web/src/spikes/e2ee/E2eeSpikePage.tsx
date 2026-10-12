import { useCallback, useEffect, useRef, useState } from "react";

import { idbClear } from "./idb";
import { deviceInfo, m1, m2, m3, m4, m5, m6, m7, resultsText, warmUp, type Row } from "./measures";

/**
 * AVORA-E0 — the hidden test page (`/spike/e2ee`). One button runs M1…M7 on made-up data, a table
 * shows the numbers, “Chép kết quả” copies them as text. No product code imports this; nothing is
 * read from the account and nothing is sent over the network.
 */
export default function E2eeSpikePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [label, setLabel] = useState<string>("");
  const [fraction, setFraction] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const hiddenAtRef = useRef<number | null>(null);
  const [awaySeconds, setAwaySeconds] = useState<number | null>(null);

  const add = (more: Row[]): void => setRows((current) => [...current, ...more]);
  const [isReady, setIsReady] = useState<boolean>(false);
  useEffect(() => {
    void warmUp().then(
      () => setIsReady(true),
      () => setIsReady(true),
    );
  }, []);

  const run = useCallback(async (): Promise<void> => {
    setIsRunning(true);
    setRows([]);
    setCopied(false);
    const progress = (text: string, part: number): void => {
      setLabel(text);
      setFraction(part);
    };
    try {
      progress("M1 · WebCrypto", 0.02);
      add(await m1());
      progress("M2 · giữ khoá", 0.08);
      add(await m2("run"));
      progress("M3 · Argon2id", 0.14);
      add(await m3());
      const base = 0.2;
      const { rows: m4Rows, plain } = await m4((text, part) => progress(text, base + part * 0.35));
      add(m4Rows);
      add(await m5(plain, (text, part) => progress(text, 0.55 + part * 0.2)));
      add(await m6((text, part) => progress(text, 0.75 + part * 0.15)));
      progress("M7 · ghi 20 MB", 0.92);
      add([await m7("first")]);
      progress("Xong. Bây giờ chuyển sang app khác 30 giây rồi quay lại, bấm “Ghi tiếp”.", 1);
    } catch (error) {
      add([{ id: "!", name: "Dừng giữa chừng", pass: false, detail: `${(error as Error).name}: ${(error as Error).message}` }]);
    } finally {
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") hiddenAtRef.current = Date.now();
      else if (hiddenAtRef.current !== null) setAwaySeconds(Math.round((Date.now() - hiddenAtRef.current) / 1000));
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const recheck = async (): Promise<void> => {
    setIsRunning(true);
    try {
      add(await m2("recheck"));
    } finally {
      setIsRunning(false);
    }
  };

  const writeAgain = async (): Promise<void> => {
    setIsRunning(true);
    try {
      const row = await m7("after-switch");
      add([{ ...row, detail: `${row.detail}${awaySeconds === null ? "" : ` · đã rời ${awaySeconds} giây`}` }]);
    } finally {
      setIsRunning(false);
    }
  };

  const copy = async (): Promise<void> => {
    const text = resultsText(rows);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
  };

  const clear = async (): Promise<void> => {
    await idbClear();
    setRows([]);
    setLabel("Đã xoá dữ liệu thử.");
    setFraction(0);
  };

  const button = "min-h-12 rounded-control px-5 text-[16px] font-semibold disabled:opacity-50";

  return (
    <main className="mx-auto min-h-[100dvh] max-w-3xl overflow-x-hidden bg-background px-4 pb-16 pt-[calc(env(safe-area-inset-top)+16px)] text-[16px] text-foreground" data-e2ee-spike="">
      <h1 className="text-[22px] font-semibold">Trang thử kỹ thuật (AVORA-E0)</h1>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-[16px] leading-6" data-spike-guide="">
        <li>Mở trang trên iPhone, trong PWA đã cài; bấm “Chạy thử”; chờ xong (khoảng 1–3 phút).</li>
        <li>Bấm “Chép kết quả”, dán vào chat Avora 09.</li>
        <li>Làm lại ở Safari thường và ở máy tính (cùng bước).</li>
        <li>Chuyển sang app khác 30 giây rồi quay lại, bấm “Ghi tiếp”.</li>
        <li>Sau 1 giờ, 24 giờ: mở trang, bấm “Kiểm lại”, chép kết quả.</li>
        <li>Xong thì bấm “Xoá dữ liệu thử”.</li>
      </ol>
      <p className="mt-3 text-[16px] leading-6 text-muted-foreground">Chỉ dùng dữ liệu giả tạo ngay trên máy. Không đọc tin thật, không gửi gì lên mạng.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void run()} disabled={isRunning || !isReady} className={`${button} bg-primary text-primary-foreground`} data-spike-run="">
          Chạy thử
        </button>
        <button type="button" onClick={() => void recheck()} disabled={isRunning} className={`${button} border border-border bg-card`} data-spike-recheck="">
          Kiểm lại
        </button>
        <button type="button" onClick={() => void writeAgain()} disabled={isRunning} className={`${button} border border-border bg-card`} data-spike-write-again="">
          Ghi tiếp
        </button>
        <button type="button" onClick={() => void copy()} disabled={rows.length === 0} className={`${button} border border-border bg-card`} data-spike-copy="">
          {copied ? "Đã chép" : "Chép kết quả"}
        </button>
        <button type="button" onClick={() => void clear()} disabled={isRunning} className={`${button} border border-border bg-card text-destructive`} data-spike-clear="">
          Xoá dữ liệu thử
        </button>
      </div>

      <div className="mt-4" aria-live="polite">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
        <p className="mt-2 text-[16px] text-muted-foreground" data-spike-status="">{label}</p>
      </div>

      <ul className="mt-4 space-y-1 text-[14px] leading-5 text-muted-foreground" data-spike-device="">
        {deviceInfo().map((line) => (
          <li key={line} className="break-words">{line}</li>
        ))}
      </ul>

      <div className="mt-4 space-y-2" data-spike-results="">
        {rows.map((row, index) => (
          <div key={`${row.id}-${index}`} className="rounded-card border border-border bg-card p-3">
            <p className="flex items-start justify-between gap-3 text-[16px] font-medium">
              <span className="min-w-0">
                {row.id} · {row.name}
              </span>
              <span className={row.pass === null ? "text-muted-foreground" : row.pass ? "text-[hsl(var(--task-done,142_40%_35%))]" : "text-destructive"}>
                {row.pass === null ? "·" : row.pass ? "Đạt" : "Không đạt"}
              </span>
            </p>
            <p className="mt-1 break-words text-[16px] leading-6 text-muted-foreground [overflow-wrap:anywhere]">{row.detail}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
