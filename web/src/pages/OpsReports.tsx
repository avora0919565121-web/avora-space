import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { InlineBack } from "@/components/nav/InlineBack";
import { useAuth } from "@/lib/auth";
import { amIOps } from "@/lib/feedback";
import { REPORT_REASONS } from "@/lib/reports";
import {
  fetchOpsReports,
  fetchSupportRequests,
  handleOpsReport,
  opsBlockedTerms,
  safetyKeys,
  suspensionText,
  type OpsAction,
  type OpsReport,
} from "@/lib/safety";
import { CHIP_ON_PLAIN } from "@/lib/chip";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_LABEL: Record<OpsReport["kind"], string> = {
  user: "Người dùng",
  message: "Tin nhắn",
  group: "Nhóm",
  file: "Tệp",
  avatar: "Ảnh đại diện",
};

const STATUS_LABEL: Record<OpsReport["status"], string> = {
  open: "Mới",
  reviewing: "Đang xem",
  actioned: "Đã xử lý",
  dismissed: "Đã bỏ qua",
};

const ACTION_LABEL: Record<NonNullable<OpsReport["action"]>, string> = {
  dismiss: "Bỏ qua",
  warn: "Cảnh cáo",
  suspend_temp: "Khoá tạm",
  suspend_permanent: "Khoá vĩnh viễn",
};

function reasonLabel(value: string): string {
  return REPORT_REASONS.find((item) => item.value === value)?.label ?? value;
}

/** "3 giờ", "2 ngày" — how long the report has waited. */
function ageLabel(createdAt: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} phút`;
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}

const chipClass = "press min-h-11 rounded-full border border-border px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50";

function ReportRow({ report, onAct, isWorking }: { report: OpsReport; onAct: (action: OpsAction, days?: number) => void; isWorking: boolean }) {
  const [days, setDays] = useState<number>(7);
  const isOpen = report.status === "open" || report.status === "reviewing";
  const isOld = isOpen && Date.now() - new Date(report.createdAt).getTime() > DAY_MS;
  const isMinor = report.reason === "minor_safety";
  const hasPerson = report.reportedUserId !== null;
  return (
    <li
      className={cn("rounded-card border p-4", isMinor && isOpen ? "border-destructive/50 bg-destructive/[0.06]" : "border-border bg-card")}
      data-ops-report={report.id}
      data-reason={report.reason}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-foreground">{KIND_LABEL[report.kind]}</span>
        <span className={cn("font-semibold", isMinor ? "text-destructive" : "text-foreground")}>{reasonLabel(report.reason)}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{STATUS_LABEL[report.status]}{report.action !== null ? ` · ${ACTION_LABEL[report.action]}` : ""}</span>
        <span className={cn("tabular ml-auto", isOld ? "font-semibold text-destructive" : "text-muted-foreground")} data-age-old={isOld ? "" : undefined}>
          {ageLabel(report.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-[14.5px] font-medium text-foreground">
        {report.kind === "group" ? `Nhóm ${report.groupName ?? "(đã xoá)"}` : (report.reportedName ?? "(không rõ tên)")}
        {hasPerson && report.priorCount > 1 ? <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">{report.priorCount} báo cáo</span> : null}
      </p>
      {report.suspendedUntil !== null ? <p className="mt-0.5 text-[12.5px] text-destructive">{suspensionText(report.suspendedUntil)}</p> : null}
      {report.content ? (
        <p className="mt-2 line-clamp-4 whitespace-pre-line border-l-2 border-border pl-2.5 text-[13.5px] leading-5 text-foreground">{report.content}</p>
      ) : null}
      {report.note ? <p className="mt-2 text-[13px] text-muted-foreground">Ghi chú: {report.note}</p> : null}
      {isOpen ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={isWorking} onClick={() => onAct("dismiss")} className={chipClass}>Bỏ qua</button>
          {hasPerson ? (
            <>
              <button type="button" disabled={isWorking} onClick={() => onAct("warn")} className={chipClass}>Cảnh cáo</button>
              <span className="inline-flex items-center gap-1 rounded-full border border-border pl-3">
                <select
                  aria-label="Số ngày khoá"
                  value={days}
                  onChange={(event) => setDays(Number(event.target.value))}
                  className="min-h-11 bg-transparent text-[16px] md:text-[13px] text-foreground outline-none"
                >
                  {[1, 3, 7, 14, 30, 90].map((value) => (
                    <option key={value} value={value}>{value} ngày</option>
                  ))}
                </select>
                <button type="button" disabled={isWorking} onClick={() => onAct("suspend_temp", days)} className="press min-h-11 rounded-full px-3 text-[13px] font-medium text-destructive disabled:opacity-50">
                  Khoá tạm
                </button>
              </span>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => onAct("suspend_permanent")}
                className="press min-h-11 rounded-full bg-destructive px-4 text-[13px] font-semibold text-destructive-foreground disabled:opacity-50"
              >
                Khoá vĩnh viễn
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function TermsSection() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState<string>("");
  const [locale, setLocale] = useState<"vi" | "en">("vi");
  const terms = useQuery({ queryKey: safetyKeys.opsTerms, queryFn: () => opsBlockedTerms("list") });
  const edit = useMutation({
    mutationFn: (input: { op: "add" | "remove"; term?: string; id?: number }) => opsBlockedTerms(input.op, { term: input.term, locale, id: input.id }),
    onSuccess: (list) => {
      queryClient.setQueryData(safetyKeys.opsTerms, list);
      setTerm("");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <section className="rounded-card border border-border bg-card p-4" data-ops-terms="">
      <h2 className="text-[15px] font-semibold text-foreground">Từ bị lọc ({terms.data?.length ?? 0})</h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">Áp cho tên hiển thị, tên nhóm, tên dự án chia sẻ và tin nhắn khi chưa xác minh. Không dấu, không phân biệt hoa thường.</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (term.trim().length >= 2) edit.mutate({ op: "add", term });
        }}
      >
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Thêm từ hoặc cụm từ"
          aria-label="Từ cần lọc"
          maxLength={80}
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-input bg-background px-3 text-[16px] md:text-[14px] text-foreground outline-none focus:border-personal/60"
        />
        <select aria-label="Ngôn ngữ" value={locale} onChange={(event) => setLocale(event.target.value as "vi" | "en")} className="min-h-11 rounded-[10px] border border-input bg-background px-2 text-[16px] md:text-[14px]">
          <option value="vi">vi</option>
          <option value="en">en</option>
        </select>
        <button type="submit" disabled={edit.isPending || term.trim().length < 2} className="press min-h-11 rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground disabled:opacity-50">
          Thêm
        </button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {(terms.data ?? []).map((item) => (
          <li key={item.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-background pl-3 text-[13px] text-foreground">
            {item.term} <span className="text-[11px] text-muted-foreground">{item.locale}</span>
            <button type="button" aria-label={`Bỏ ${item.term}`} onClick={() => edit.mutate({ op: "remove", id: item.id })} className="press flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SupportSection() {
  const support = useQuery({ queryKey: safetyKeys.opsSupport, queryFn: fetchSupportRequests });
  return (
    <section className="rounded-card border border-border bg-card p-4" data-ops-support="">
      <h2 className="text-[15px] font-semibold text-foreground">Yêu cầu hỗ trợ</h2>
      <ul className="mt-2 divide-y divide-border">
        {(support.data ?? []).map((item) => (
          <li key={item.id} className="py-2.5 text-[13.5px]">
            <p className="font-medium text-foreground">
              {item.name} · <a href={`mailto:${item.reply_email}`} className="underline underline-offset-2">{item.reply_email}</a>
              <span className="ml-2 text-[12px] font-normal text-muted-foreground">{ageLabel(item.created_at)}</span>
            </p>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{item.body}</p>
          </li>
        ))}
        {support.data?.length === 0 ? <li className="py-2 text-[13px] text-muted-foreground">Chưa có.</li> : null}
      </ul>
    </section>
  );
}

/**
 * 111-B · /quan-tri/bao-cao — Avora's team only (every call is refused on the server for anyone else).
 * Open reports first, child-safety reports at the very top, oldest first; anything waiting over
 * 24 hours shows its age in red.
 */
const OpsReports = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const ops = useQuery({ queryKey: ["ops", "am-i", user?.id ?? ""], queryFn: amIOps, enabled: Boolean(user?.id), staleTime: 5 * 60_000 });
  const reports = useQuery({ queryKey: safetyKeys.opsReports, queryFn: fetchOpsReports, enabled: ops.data === true });
  const act = useMutation({
    mutationFn: (input: { id: string; action: OpsAction; days?: number }) => handleOpsReport(input.id, input.action, input.days),
    onSuccess: () => {
      toast.success("Đã xử lý báo cáo.");
      void queryClient.invalidateQueries({ queryKey: safetyKeys.opsReports });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const list = (reports.data ?? []).filter((item) => filter === "all" || item.status === "open" || item.status === "reviewing");
  const openCount = (reports.data ?? []).filter((item) => item.status === "open" || item.status === "reviewing").length;

  return (
    <div className="paper min-h-0 flex-1 scroll-y-free">
      <InlineBack className="mx-auto w-full max-w-3xl px-6 md:px-10" />
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Báo cáo</h1>
        {ops.data === false || ops.isError ? (
          <div className="mt-6 flex items-start gap-3 rounded-card border border-border bg-card p-5" data-ops-denied="">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            <p className="text-[14px] text-muted-foreground">Trang này chỉ dành cho nhóm vận hành Avora.</p>
          </div>
        ) : null}
        {ops.data === true ? (
          <div className="mt-4 space-y-5">
            <div className="flex gap-2" role="radiogroup" aria-label="Lọc báo cáo">
              {(["open", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={filter === value}
                  onClick={() => setFilter(value)}
                  className={cn("press min-h-11 rounded-full border border-border px-4 text-[13px] font-medium", filter === value ? CHIP_ON_PLAIN : "text-muted-foreground")}
                >
                  {value === "open" ? `Cần xử lý · ${openCount}` : "Tất cả"}
                </button>
              ))}
            </div>
            {reports.isPending ? (
              <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang tải…</p>
            ) : null}
            {reports.isError ? <p role="alert" className="text-[14px] text-foreground">{reports.error.message}</p> : null}
            {reports.data !== undefined && list.length === 0 ? (
              <p className="rounded-card border border-border bg-card p-5 text-[14px] text-muted-foreground">Không có báo cáo nào cần xử lý.</p>
            ) : null}
            <ul className="space-y-3" data-ops-reports="">
              {list.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  isWorking={act.isPending}
                  onAct={(action, days) => act.mutate({ id: report.id, action, days })}
                />
              ))}
            </ul>
            <TermsSection />
            <SupportSection />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default OpsReports;
