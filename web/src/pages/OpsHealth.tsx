import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { InlineBack } from "@/components/nav/InlineBack";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { amIOps } from "@/lib/feedback";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";

type Health = {
  since: string;
  byDay: { day: string; count: number; people: number }[];
  byScope: { scope: string; count: number }[];
  byVersion: { version: string; count: number }[];
  sendFailed: number;
  realtimeReconnects: number;
  top: { scope: string; code: string; route: string; count: number; people: number }[];
};

async function fetchHealth(days: number): Promise<Health> {
  const { data, error } = await supabase.rpc("ops_health_summary" as never, { p_days: days } as never);
  if (error) {
    logError("ops-health", { code: error.code, message: error.message });
    throw new Error(error.message.includes("avora_not_allowed") ? "Trang này chỉ dành cho nhóm vận hành Avora." : "Chưa tải được số liệu. Thử lại nhé.");
  }
  return data as unknown as Health;
}

/**
 * 112-F · /quan-tri/suc-khoe — Avora's team only (the summary is refused on the server for anyone else).
 * Errors by day, by flow and by version; messages that failed to send; realtime reconnects; the ten most
 * common errors. Only what devices reported — never message content.
 */
const OpsHealth = () => {
  const { user } = useAuth();
  const [days, setDays] = useState<number>(7);
  const ops = useQuery({ queryKey: ["ops", "am-i", user?.id ?? ""], queryFn: amIOps, enabled: Boolean(user?.id), staleTime: 5 * 60_000 });
  const health = useQuery({ queryKey: ["ops", "health", days], queryFn: () => fetchHealth(days), enabled: ops.data === true });
  const max = Math.max(1, ...(health.data?.byDay ?? []).map((row) => row.count));

  return (
    <div className="paper min-h-0 flex-1 scroll-y-free">
      <InlineBack className="mx-auto w-full max-w-3xl px-6 md:px-10" />
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Sức khoẻ</h1>
        {ops.data === false || ops.isError ? (
          <div className="mt-6 flex items-start gap-3 rounded-card border border-border bg-card p-5" data-ops-denied="">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            <p className="text-[14px] text-muted-foreground">Trang này chỉ dành cho nhóm vận hành Avora.</p>
          </div>
        ) : null}
        {ops.data === true ? (
          <>
            <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Khoảng thời gian">
              {[1, 7, 30].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={days === value}
                  onClick={() => setDays(value)}
                  className={cn("press min-h-11 rounded-full border border-border px-4 text-[13px] font-medium", days === value ? "bg-foreground text-background" : "text-muted-foreground")}
                >
                  {value === 1 ? "Hôm nay" : `${value} ngày`}
                </button>
              ))}
            </div>
            {health.isError ? (
              <div className="mt-5 rounded-card border border-border bg-card p-5">
                <p role="alert" className="text-[14px] text-foreground">{health.error.message}</p>
                <button type="button" onClick={() => void health.refetch()} className="press mt-3 min-h-11 rounded-full border border-border px-4 text-[13px] font-medium">
                  Thử lại
                </button>
              </div>
            ) : null}
            {health.isPending ? <p className="mt-5 text-[14px] text-muted-foreground">Đang tải…</p> : null}
            {health.data !== undefined ? (
              <div className="mt-5 space-y-5" data-ops-health="">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Tin gửi lỗi (máy báo)" value={health.data.sendFailed} />
                  <Stat label="Lần nối lại realtime" value={health.data.realtimeReconnects} />
                </div>
                <section className="rounded-card border border-border bg-card p-4">
                  <h2 className="text-[15px] font-semibold text-foreground">Lỗi theo ngày</h2>
                  {health.data.byDay.length === 0 ? (
                    <p className="mt-2 text-[13.5px] text-muted-foreground">Chưa có lỗi nào được báo trong khoảng này.</p>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {health.data.byDay.map((row) => (
                        <li key={row.day} className="flex items-center gap-3 text-[13px]">
                          <span className="tabular w-[84px] shrink-0 text-muted-foreground">{row.day}</span>
                          <span className="h-2 rounded-full bg-foreground/70" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
                          <span className="tabular shrink-0 text-foreground">{row.count} · {row.people} người</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <Table title="Theo luồng" rows={health.data.byScope.map((row) => [row.scope, row.count])} />
                <Table title="Theo phiên bản" rows={health.data.byVersion.map((row) => [row.version, row.count])} />
                <section className="rounded-card border border-border bg-card p-4">
                  <h2 className="text-[15px] font-semibold text-foreground">10 lỗi thường gặp</h2>
                  <ul className="mt-2 divide-y divide-border">
                    {health.data.top.map((row) => (
                      <li key={`${row.scope}-${row.code}`} className="py-2 text-[13px]">
                        <span className="font-medium text-foreground">{row.scope}</span> <span className="text-muted-foreground">{row.code}</span>
                        <span className="block text-[12px] text-muted-foreground">{row.route} · {row.count} lần · {row.people} người</span>
                      </li>
                    ))}
                    {health.data.top.length === 0 ? <li className="py-2 text-[13px] text-muted-foreground">Chưa có.</li> : null}
                  </ul>
                </section>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-[26px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: (string | number)[][] }) {
  return (
    <section className="rounded-card border border-border bg-card p-4">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((row) => (
          <li key={String(row[0])} className="flex justify-between gap-3 py-1.5 text-[13px]">
            <span className="min-w-0 break-words text-foreground">{row[0]}</span>
            <span className="tabular shrink-0 text-muted-foreground">{row[1]}</span>
          </li>
        ))}
        {rows.length === 0 ? <li className="py-1.5 text-[13px] text-muted-foreground">Chưa có.</li> : null}
      </ul>
    </section>
  );
}

export default OpsHealth;
