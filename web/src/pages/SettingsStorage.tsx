import { formatStorageBytes, STANDARD_UPLOAD_CAP_BYTES, useMyUploadUsage } from "@/lib/conversation-storage";
import { ChevronDown, ChevronRight, Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { clearDeviceCache, daysLeft, deviceStorageEstimate, formatBytes, useStorageUsage, type StorageFile, type StoragePlace } from "@/lib/cleanup";
import { restoreJournalMessages } from "@/lib/forwarding";
import { fetchThinkTables, thinkHubKeys } from "@/lib/think-hub";
import { useNotes } from "@/lib/use-notes";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * AVORA-100 · V·4 — Cài đặt › Dung lượng. Information, not alarm: no red, one decimal.
 * Only my own uploads are counted; nothing here deletes anything on the server except `Khôi phục`
 * moving a thing out of a bin (each through its own existing rule).
 */
const PLACES: readonly { id: StoragePlace; label: string; tone: string }[] = [
  { id: "chat", label: "File trong trò chuyện", tone: "bg-[hsl(var(--personal))]" },
  { id: "journal", label: "File trong Nhật ký & Ghi chép", tone: "bg-[hsl(265_30%_55%)]" },
  { id: "boards", label: "Bảng & hạng mục", tone: "bg-primary" },
  { id: "vault", label: "Két sắt (đã mã hoá)", tone: "bg-muted-foreground" },
];

type BinItem = { key: string; source: "Tin nhắn" | "Nhật ký" | "Bảng"; name: string; deletedAt: string; restore: () => Promise<void> };

function placeHref(file: StorageFile): string {
  if (file.place === "boards") return `/ke-hoach?bang=${file.ref}`;
  if (file.place === "vault") return "/ket-sat";
  if (file.bucket === "note-files") return "/tin-nhan?tab=nhat-ky";
  return `/tin-nhan/${file.ref}`;
}

const SettingsStorage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const usage = useStorageUsage();
  const notes = useNotes();
  const [open, setOpen] = useState<"largest" | "bin" | null>(null);
  const [device, setDevice] = useState<number | null>(null);
  const [isClearing, setIsClearing] = useState<boolean>(false);

  useEffect(() => {
    void deviceStorageEstimate().then(setDevice);
  }, []);

  const tables = useQuery({ queryKey: thinkHubKeys.tables, queryFn: fetchThinkTables, enabled: open === "bin" });
  const journal = useQuery({
    queryKey: ["storage-bin", "journal", user?.id ?? "none"],
    enabled: open === "bin" && Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, trashed_at, conversations!inner(type)")
        .eq("conversations.type", "personal")
        .not("trashed_at", "is", null)
        .order("trashed_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("Chưa tải được Thùng rác Nhật ký.");
      return (data ?? []) as { id: string; content: string | null; trashed_at: string }[];
    },
  });

  const bin = useMemo<BinItem[]>(() => {
    const items: BinItem[] = [];
    for (const message of journal.data ?? []) {
      items.push({
        key: `m-${message.id}`,
        source: "Tin nhắn",
        name: (message.content ?? "").trim().slice(0, 60) || "Tin nhắn",
        deletedAt: message.trashed_at,
        restore: async () => {
          await restoreJournalMessages([message.id]);
          void queryClient.invalidateQueries({ queryKey: ["storage-bin"] });
        },
      });
    }
    for (const note of notes.trashedNotes) {
      items.push({
        key: `n-${note.id}`,
        source: "Nhật ký",
        name: note.title.trim() || "Ghi chép",
        deletedAt: note.deletedAt ?? new Date().toISOString(),
        restore: async () => notes.patch.mutateAsync({ id: note.id, deleted: false }).then(() => undefined),
      });
    }
    for (const table of tables.data ?? []) {
      if (table.deletedAt === null || table.ownerUserId !== user?.id || table.conversationId !== null || table.projectId !== null) continue;
      items.push({
        key: `t-${table.id}`,
        source: "Bảng",
        name: table.name,
        deletedAt: table.deletedAt,
        restore: async () => {
          const { error } = await supabase.rpc("restore_think_hub_table", { p_table_id: table.id });
          if (error) throw new Error("Chưa khôi phục được.");
          void queryClient.invalidateQueries({ queryKey: thinkHubKeys.all });
        },
      });
    }
    return items.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt));
  }, [journal.data, notes.trashedNotes, notes.patch, tables.data, user?.id, queryClient]);

  const counts = (source: BinItem["source"]): number => bin.filter((item) => item.source === source).length;
  const data = usage.data;
  const total = data?.totalBytes ?? 0;

  const download = async (file: StorageFile): Promise<void> => {
    const { data: link, error } = await supabase.storage.from(file.bucket).createSignedUrl(file.path, 600, { download: file.fileName });
    if (error || link === null) {
      toast.error("Chưa tải về được.");
      return;
    }
    window.open(link.signedUrl, "_blank", "noopener");
  };

  const row = "press flex min-h-[56px] w-full items-center gap-2 border-b border-border/60 px-4 py-2.5 text-left last:border-b-0";

  const uploadBytes = useMyUploadUsage();
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto" data-settings-storage="">
      <div data-under-tabs="" className="mx-auto max-w-2xl animate-rise-in space-y-s-4 px-4 pb-8 pt-4 md:px-10 md:pb-12">
        <section aria-labelledby="usage-heading">
          <p id="usage-heading" className="text-[13px] text-muted-foreground">Bạn đang dùng</p>
          {usage.isPending ? (
            <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" aria-label="Đang tải" />
          ) : usage.isError ? (
            <p className="mt-1 text-[14px] text-muted-foreground">{usage.error.message}</p>
          ) : (
            <>
              <p className="tabular text-[34px] font-semibold leading-tight tracking-tight text-foreground" data-storage-total="">{formatBytes(total)}</p>
              <p className="text-[12.5px] text-muted-foreground" data-upload-usage="">
                {`Tệp bạn đã gửi trong trò chuyện: ${formatStorageBytes(uploadBytes ?? 0)} / ${formatStorageBytes(STANDARD_UPLOAD_CAP_BYTES)} (đang đếm, chưa giới hạn). Tệp trong mỗi cuộc giữ 30 ngày — sắp áp dụng.`}
              </p>
              <ul className="mt-s-2 rounded-card border border-border bg-card px-4 py-1">
                {PLACES.map((place) => {
                  const bytes = data?.byPlace[place.id]?.bytes ?? 0;
                  const share = total > 0 ? Math.max(bytes > 0 ? 2 : 0, Math.round((bytes / total) * 100)) : 0;
                  return (
                    <li key={place.id} className="border-b border-border/60 py-2.5 last:border-b-0" data-storage-place={place.id}>
                      <span className="flex items-baseline gap-2 text-[14.5px]">
                        <span className="min-w-0 flex-1 text-foreground">{place.label}</span>
                        <span className="tabular shrink-0 text-[13px] text-muted-foreground">
                          {place.id === "boards" ? `${data?.boards ?? 0} bảng · ${data?.records ?? 0} mục · ` : ""}
                          {formatBytes(bytes)}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary">
                        <span className={cn("block h-full rounded-full transition-[width] duration-700", place.tone)} style={{ width: `${share}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section aria-labelledby="cleanup-heading">
          <h2 id="cleanup-heading" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Dọn dẹp</h2>
          <div className="mt-2 overflow-hidden rounded-card border border-border bg-card">
            <button type="button" className={row} aria-expanded={open === "largest"} onClick={() => setOpen(open === "largest" ? null : "largest")} data-storage-largest="">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-foreground">20 file lớn nhất</span>
                <span className="block text-[12.5px] text-muted-foreground">Chỉ file bạn tải lên · xem rồi chọn tải về máy</span>
              </span>
              {open === "largest" ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {open === "largest" ? (
              <ul className="border-b border-border/60 bg-secondary/30">
                {(data?.largest ?? []).length === 0 ? <li className="px-4 py-3 text-[13.5px] text-muted-foreground">Chưa có file nào.</li> : null}
                {(data?.largest ?? []).map((file) => (
                  <li key={`${file.bucket}/${file.path}`} className="flex items-center gap-2 border-b border-border/50 px-4 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-foreground">{file.fileName}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {formatBytes(file.size)} · {PLACES.find((place) => place.id === file.place)?.label ?? "Khác"} · {new Date(file.createdAt).toLocaleDateString("vi-VN")}
                      </span>
                    </span>
                    <button type="button" onClick={() => navigate(placeHref(file))} className="press h-10 shrink-0 rounded-md px-2 text-[12.5px] font-medium text-personal">Mở nơi chứa</button>
                    <button type="button" onClick={() => void download(file)} aria-label={`Tải ${file.fileName} về máy`} className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                      <Download className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <button type="button" className={row} aria-expanded={open === "bin"} onClick={() => setOpen(open === "bin" ? null : "bin")} data-storage-bin="">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-foreground">Thùng rác chung</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {open === "bin" ? `Tin nhắn ${counts("Tin nhắn")} · Nhật ký ${counts("Nhật ký")} · Bảng ${counts("Bảng")} · Tài chính ở Két sắt` : "Tin nhắn · Nhật ký · Bảng · Tài chính"}
                </span>
              </span>
              {open === "bin" ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {open === "bin" ? (
              <ul className="border-b border-border/60 bg-secondary/30" data-storage-bin-list="">
                {journal.isPending || tables.isPending ? <li className="px-4 py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></li> : null}
                {bin.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 border-b border-border/50 px-4 py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-foreground">{item.name}</span>
                      <span className="block text-[12px] text-muted-foreground">{item.source} · Còn {daysLeft(item.deletedAt)} ngày</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => item.restore().then(() => toast.success("Đã khôi phục."), (error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa khôi phục được."))}
                      className="press inline-flex h-10 shrink-0 items-center gap-1 rounded-md px-2 text-[13px] text-foreground"
                    >
                      <RotateCcw className="h-4 w-4" /> Khôi phục
                    </button>
                  </li>
                ))}
                <li className="px-4 py-2.5">
                  <button type="button" onClick={() => navigate("/ket-sat")} className="press text-[13px] text-personal">Thùng rác Tài chính · mở trong Két sắt ›</button>
                </li>
              </ul>
            ) : null}

            <button type="button" className={row} onClick={() => navigate("/ke-hoach?ke=3&don=1")} data-storage-cleanup="">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-foreground">Dọn kệ Kế hoạch</span>
                <span className="block text-[12.5px] text-muted-foreground">Avora chỉ gợi ý — bạn chọn rồi mới dọn</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>

            <div className="flex min-h-[56px] items-center gap-2 px-4 py-2.5" data-device-cache="">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-foreground">Bộ nhớ trên máy này</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  Sách & ảnh đã lưu {device === null ? "—" : formatBytes(device)} · chỉ xoá trên máy này
                </span>
              </span>
              <button
                type="button"
                disabled={isClearing}
                onClick={() => {
                  setIsClearing(true);
                  void clearDeviceCache()
                    .then(() => deviceStorageEstimate())
                    .then((next) => {
                      setDevice(next);
                      toast.success("Đã xoá bộ nhớ trên máy này. Sách đọc offline sẽ tải lại khi mở.");
                    })
                    .catch(() => toast.error("Chưa xoá được."))
                    .finally(() => setIsClearing(false));
                }}
                className="press h-10 shrink-0 rounded-md border border-border px-3 text-[13.5px] disabled:opacity-50"
              >
                Xoá
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SettingsStorage;
