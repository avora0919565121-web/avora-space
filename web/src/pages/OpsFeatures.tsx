import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { askText } from "@/components/ConfirmHost";
import { InlineBack } from "@/components/nav/InlineBack";
import { useAuth } from "@/lib/auth";
import { amIOps } from "@/lib/feedback";
import {
  FEATURE_KEYS,
  featureKeys,
  fetchFeatureChanges,
  fetchFeatureRows,
  setFeatureStatus,
  type FeatureKey,
  type FeatureStatus,
} from "@/lib/features";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<FeatureStatus, string> = { stable: "Đang chạy", soon: "Sắp có", hidden: "Ẩn" };
const STATUSES: readonly FeatureStatus[] = ["stable", "soon", "hidden"];

/**
 * AVORA-112-B · /quan-tri/tinh-nang — Avora's team only (checked on the server: reading the history and
 * every change go through `is_ops`). Also the remote kill switch.
 */
const OpsFeatures = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const ops = useQuery({ queryKey: ["ops", "am-i", user?.id ?? ""], queryFn: amIOps, enabled: Boolean(user?.id), staleTime: 5 * 60_000 });
  const rows = useQuery({ queryKey: [...featureKeys.all, "rows"], queryFn: fetchFeatureRows, enabled: ops.data === true });
  const changes = useQuery({ queryKey: featureKeys.changes, queryFn: fetchFeatureChanges, enabled: ops.data === true });

  const statusByKey = useMemo(() => new Map((rows.data ?? []).map((row) => [row.key, row.status] as const)), [rows.data]);
  const labelOf = (key: string): string => FEATURE_KEYS.find((entry) => entry.key === key)?.label ?? key;

  const change = useMutation<void, Error, { key: FeatureKey; status: FeatureStatus; note: string | null }>({
    mutationFn: ({ key, status, note }) => setFeatureStatus(key, status, note),
    onSuccess: (_data, { key, status }) => toast.success(`${labelOf(key)}: ${STATUS_LABEL[status]}`),
    onError: (error) => toast.error(error.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: featureKeys.all }),
  });

  const ask = async (key: FeatureKey, status: FeatureStatus): Promise<void> => {
    const note = await askText({
      title: `${labelOf(key)} → ${STATUS_LABEL[status]}?`,
      body: "Đổi ngay cho mọi người dùng khi họ mở lại hoặc quay lại app. Ghi lý do để lịch sử đọc được về sau.",
      initial: "",
      confirmLabel: "Đổi",
      maxLength: 300,
    });
    if (note === null) return;
    change.mutate({ key, status, note: note.trim() === "" ? null : note.trim() });
  };

  return (
    <div className="paper min-h-0 flex-1 scroll-y-free">
      <InlineBack className="mx-auto w-full max-w-3xl px-6 md:px-10" />
      <div className="mx-auto max-w-3xl px-6 py-8 md:px-10">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Tính năng</h1>
        {ops.isPending ? <p className="mt-4 text-[14px] text-muted-foreground">Đang kiểm tra quyền…</p> : null}
        {ops.data === false || ops.isError ? (
          <div className="mt-6 flex items-start gap-3 rounded-card border border-border bg-card p-5" data-ops-denied="">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
            <p className="text-[14px] text-muted-foreground">Trang này chỉ dành cho nhóm vận hành Avora.</p>
          </div>
        ) : null}
        {ops.data === true ? (
          <>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              Sắp có: không nút, không gọi máy chủ, chỉ một dòng trong nội dung. Ẩn: không lối vào, link cũng về Avora Space.
            </p>
            {rows.isError ? (
              <p role="alert" className="mt-4 text-[14px] text-foreground">{rows.error.message}</p>
            ) : null}
            <ul className="mt-5 overflow-hidden rounded-card border border-border bg-card" data-ops-features="">
              {FEATURE_KEYS.map(({ key, label }) => {
                const current = statusByKey.get(key) ?? "stable";
                return (
                  <li key={key} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[14.5px] font-medium text-foreground">{label}</span>
                      <span className="block text-[12px] text-muted-foreground">{key}</span>
                    </span>
                    <span className="flex shrink-0 overflow-hidden rounded-full border border-border" role="radiogroup" aria-label={label}>
                      {STATUSES.map((status) => (
                        <button
                          key={status}
                          type="button"
                          role="radio"
                          aria-checked={current === status}
                          disabled={change.isPending || current === status}
                          onClick={() => void ask(key, status)}
                          className={cn(
                            "press min-h-11 px-3 text-[12.5px] font-medium transition-colors",
                            current === status ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          {STATUS_LABEL[status]}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <h2 className="mt-8 text-[16px] font-semibold tracking-tight text-foreground">Lịch sử đổi</h2>
            <ul className="mt-3 space-y-2" data-ops-changes="">
              {(changes.data ?? []).length === 0 ? (
                <li className="text-[13.5px] text-muted-foreground">{changes.isPending ? "Đang tải…" : "Chưa đổi lần nào."}</li>
              ) : (
                (changes.data ?? []).map((entry) => (
                  <li key={entry.id} className="rounded-[12px] border border-border bg-card px-4 py-2.5 text-[13.5px]">
                    <span className="font-medium text-foreground">{labelOf(entry.key)}</span>{" "}
                    <span className="text-muted-foreground">
                      {STATUS_LABEL[(entry.fromStatus ?? "stable") as FeatureStatus] ?? entry.fromStatus} → {STATUS_LABEL[entry.toStatus as FeatureStatus] ?? entry.toStatus}
                      {" · "}
                      {new Date(entry.at).toLocaleString("vi-VN")}
                    </span>
                    {entry.note !== null ? <span className="mt-0.5 block text-muted-foreground">{entry.note}</span> : null}
                  </li>
                ))
              )}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default OpsFeatures;
