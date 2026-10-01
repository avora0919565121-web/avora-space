import { useQuery } from "@tanstack/react-query";
import { BellRing, History, Loader2, Megaphone, Table2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  affectedOwners,
  changeLine,
  dismissNudge,
  fetchNudges,
  boardChangeKeys,
  summarizeChanges,
  summaryWords,
  type BoardChange,
  type BoardNudge,
} from "@/lib/board-changes";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import type { ColumnDef, ThinkTable } from "@/lib/think-hub";
import { useAuth } from "@/lib/auth";
import { usePeopleNames } from "@/lib/use-task-owner";
import { useAnnounceSettings } from "@/lib/use-board-changes";
import { cn } from "@/lib/utils";

const FIELD_LABELS: Record<string, string> = {
  title: "tiêu đề",
  status: "trạng thái",
  priority: "ưu tiên",
  category: "phân loại",
  next_action_date: "ngày cần làm tiếp",
  tags: "nhãn",
  notes: "ghi chú",
  remind_at: "nhắc",
};

/** Turns a logged field key into words: built-in names, or the board's own column label. */
export function fieldLabeler(columns: readonly ColumnDef[]): (key: string) => string {
  const byKey = new Map(columns.map((column) => [column.key, column.label] as const));
  return (key: string) => {
    if (key.startsWith("ext:")) return byKey.get(key.slice(4)) ?? "cột đã xoá";
    return FIELD_LABELS[key] ?? key;
  };
}

/** The people of the board's conversation, by display name (never an email). */
export function useBoardPeople(conversationId: string | null, kind: "group" | "direct" | null): { id: string; name: string }[] {
  const { user } = useAuth();
  const { nameOf, peerOf } = usePeopleNames();
  const members = useQuery({
    queryKey: groupKeys.members(conversationId ?? ""),
    queryFn: () => fetchGroupMembers(conversationId ?? ""),
    enabled: conversationId !== null && kind === "group",
    staleTime: 60_000,
  });
  return useMemo(() => {
    if (kind === "group") {
      return (members.data ?? [])
        .filter((member) => member.userId !== user?.id)
        .map((member) => ({ id: member.userId, name: member.displayName?.trim() || nameOf(member.userId) }));
    }
    const peer = peerOf(conversationId);
    return peer === null ? [] : [{ id: peer, name: nameOf(peer) }];
  }, [kind, members.data, user?.id, nameOf, peerOf, conversationId]);
}

/**
 * `Báo nhóm · N` beside the board's name (AVORA-62 · B): shown only while I have changes not yet
 * announced. A small orange dot that stays still — present, never blinking.
 */
export function AnnounceButton({ count, onClick }: { count: number; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      data-announce-button=""
      className="press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-primary/35 bg-primary/[0.08] px-3 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[0.12]"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
      Báo nhóm · <span className="tabular">{count}</span>
    </button>
  );
}

/** The preview before sending: a written summary, five lines, a note, who gets told personally. */
export function AnnounceDialog({
  open,
  onOpenChange,
  table,
  pending,
  conversationName,
  people,
  onSend,
  isSending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: ThinkTable;
  pending: readonly BoardChange[];
  conversationName: string;
  people: readonly { id: string; name: string }[];
  onSend: (input: { note: string; notify: string[]; mentions: string[] }) => Promise<void>;
  isSending: boolean;
}) {
  const { user } = useAuth();
  const [note, setNote] = useState<string>("");
  const [notify, setNotify] = useState<Set<string>>(new Set());
  const owners = useMemo(() => affectedOwners(pending, user?.id), [pending, user?.id]);
  useEffect(() => {
    if (!open) return;
    setNote("");
    setNotify(new Set(owners));
  }, [open, owners]);
  const label = fieldLabeler(table.columns);
  const summary = summarizeChanges(pending);
  const lines = pending.slice(0, 5).map((change) => changeLine(change, label));
  const rest = pending.length - lines.length;
  const mentions = people.filter((person) => note.includes(`@${person.name}`)).map((person) => person.id);
  const atQuery = /@([^\s@]*)$/.exec(note)?.[1] ?? null;
  const suggestions = atQuery === null ? [] : people.filter((person) => person.name.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 5);
  const ownerPeople = owners.map((id) => people.find((person) => person.id === id) ?? { id, name: "Người dùng AVORA" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[520px] overflow-y-auto">
        <DialogTitle className="text-[18px]">Báo thay đổi cho mọi người</DialogTitle>
        <DialogDescription className="text-[13px]">
          Một thẻ trong {conversationName}. Không đẩy thông báo cho cả nhóm — chỉ người được chọn bên dưới.
        </DialogDescription>
        <div className="rounded-lg border-l-[3px] border-primary bg-secondary/50 px-3.5 py-2.5">
          <p className="text-[14.5px] font-semibold text-foreground" data-announce-summary="">
            {summaryWords(summary)}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[13px] text-muted-foreground">
            {lines.map((line, index) => (
              <li key={`${index}-${line}`} className="truncate">
                {line}
              </li>
            ))}
            {rest > 0 ? <li>và {rest} thay đổi khác</li> : null}
          </ul>
        </div>
        <label className="block">
          <span className="text-[13px] font-medium text-muted-foreground">Ghi chú cho mọi người (không bắt buộc, gõ @ để gọi tên)</span>
          <textarea
            value={note}
            maxLength={500}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[16px] outline-none focus:border-primary md:text-[14.5px]"
          />
        </label>
        {suggestions.length > 0 ? (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => setNote((current) => current.replace(/@([^\s@]*)$/, `@${person.name} `))}
                className="press rounded-full border border-border px-2.5 py-1 text-[12.5px]"
              >
                @{person.name}
              </button>
            ))}
          </div>
        ) : null}
        {ownerPeople.length > 0 ? (
          <fieldset>
            <legend className="text-[13px] font-medium text-muted-foreground">Báo riêng cho</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ownerPeople.map((person) => {
                const isOn = notify.has(person.id);
                return (
                  <label
                    key={person.id}
                    className={cn(
                      "press inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px]",
                      isOn ? "border-primary/40 bg-primary/[0.08] text-foreground" : "border-border text-muted-foreground",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() =>
                        setNotify((current) => {
                          const next = new Set(current);
                          if (next.has(person.id)) next.delete(person.id);
                          else next.add(person.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    {person.name}
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">Người tạo các Hạng mục bạn đã sửa / xoá. Thông báo thường, không Khẩn.</p>
          </fieldset>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="press rounded-md border border-border px-4 py-2 text-[14px]" onClick={() => onOpenChange(false)}>
            Để sau
          </button>
          <button
            type="button"
            disabled={isSending}
            onClick={() => void onSend({ note, notify: [...notify], mentions })}
            className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Megaphone className="h-4 w-4" aria-hidden="true" />}
            Gửi vào {conversationName}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** `5 thay đổi từ lần bạn xem trước · Xem` at the top of a shared board (AVORA-62 · E). */
export function ChangesSinceLine({ count, onView }: { count: number; onView: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onView}
      data-changes-since=""
      className="press mt-3 flex w-full items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2 text-left text-[13.5px] text-foreground"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1">
        <span className="tabular font-semibold">{count}</span> thay đổi từ lần bạn xem trước
      </span>
      <span className="font-semibold text-primary">Xem</span>
    </button>
  );
}

/** The marking bar while `Xem thay đổi` is on. */
export function MarkingBar({ count, onDone }: { count: number; onDone: () => void }) {
  return (
    <div role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-secondary/70 px-3.5 py-2 text-[13px]" data-marking-bar="">
      <span className="h-3 w-3 shrink-0 rounded-[3px] border border-primary/70" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-muted-foreground">
        Đang đánh dấu <span className="tabular font-semibold text-foreground">{count}</span> thay đổi · ô đổi viền cam, Hạng mục mới nền cam nhạt
      </span>
      <button type="button" onClick={onDone} className="press shrink-0 rounded-md px-2 py-1 font-semibold text-primary">
        Đã xem hết
      </button>
    </div>
  );
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function shown(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ");
  return String(value);
}

/** ⋯ › Lịch sử thay đổi: by day, by person, each change before → after (AVORA-62 · E). */
export function ChangeHistoryDialog({
  open,
  onOpenChange,
  changes,
  columns,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: readonly BoardChange[];
  columns: readonly ColumnDef[];
}) {
  const { nameOf } = usePeopleNames();
  const label = fieldLabeler(columns);
  const days = useMemo(() => {
    const map = new Map<string, BoardChange[]>();
    for (const change of changes) {
      const key = change.createdAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), change]);
    }
    return [...map];
  }, [changes]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] max-w-[560px] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-[18px]">
          <History className="h-5 w-5" aria-hidden="true" /> Lịch sử thay đổi
        </DialogTitle>
        <DialogDescription className="text-[13px]">90 ngày gần nhất. Chỉ thành viên của Bảng thấy.</DialogDescription>
        {days.length === 0 ? <p className="text-[13.5px] text-muted-foreground">Chưa có thay đổi nào.</p> : null}
        {days.map(([day, list]) => (
          <section key={day}>
            <h3 className="sticky top-0 bg-background py-1 text-[12.5px] font-semibold text-muted-foreground">{dayLabel(list[0].createdAt)}</h3>
            <ul className="space-y-2">
              {list.map((change) => (
                <li key={change.id} className="rounded-lg border border-border px-3 py-2 text-[13.5px]">
                  <p className="flex items-center gap-2">
                    <span className="font-semibold">{nameOf(change.actorId)}</span>
                    <span className="text-muted-foreground">{changeLine(change, label)}</span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                      {new Date(change.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      {change.announcedAt === null ? " · chưa báo" : ""}
                    </span>
                  </p>
                  {change.kind === "record_edit" ? (
                    <dl className="mt-1 space-y-0.5 text-[12.5px]">
                      {Object.keys(change.after ?? {}).map((key) => (
                        <div key={key} className="flex gap-1.5">
                          <dt className="shrink-0 text-muted-foreground first-letter:uppercase">{label(key)}:</dt>
                          <dd className="min-w-0 truncate">
                            <span className="text-muted-foreground line-through">{shown(change.before?.[key])}</span> → {shown(change.after?.[key])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

/** ⋯ › Báo thay đổi — the owner's two choices (AVORA-62 · F). */
export function AnnounceSettingsDialog({ open, onOpenChange, table }: { open: boolean; onOpenChange: (open: boolean) => void; table: ThinkTable }) {
  const save = useAnnounceSettings();
  const [who, setWho] = useState<"members" | "admins">(table.announceWho ?? "members");
  const [mode, setMode] = useState<"manual" | "daily" | "silent">(table.announceMode ?? "manual");
  useEffect(() => {
    if (!open) return;
    setWho(table.announceWho ?? "members");
    setMode(table.announceMode ?? "manual");
  }, [open, table.announceWho, table.announceMode]);
  const option = (checked: boolean, onPick: () => void, title: string, hint: string, name: string) => (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5", checked ? "border-primary/50 bg-primary/5" : "border-border")}>
      <input type="radio" name={name} checked={checked} onChange={onPick} className="mt-1 accent-[hsl(var(--primary))]" />
      <span>
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogTitle className="text-[18px]">Báo thay đổi</DialogTitle>
        <DialogDescription className="text-[13px]">Sửa Bảng luôn có hiệu lực ngay và hiện ở chấm cam + Lịch sử, dù chọn gì ở đây.</DialogDescription>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[13px] font-medium text-muted-foreground">Ai bấm Báo nhóm được</legend>
          {option(who === "members", () => setWho("members"), "Mọi thành viên", "Mặc định.", "who")}
          {option(who === "admins", () => setWho("admins"), "Chỉ chủ bảng và quản trị", "Người khác vẫn sửa được; lưới an toàn 24 giờ vẫn chạy.", "who")}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[13px] font-medium text-muted-foreground">Cách báo</legend>
          {option(mode === "manual", () => setMode("manual"), "Thủ công — bấm Báo nhóm", "Mặc định.", "mode")}
          {option(mode === "daily", () => setMode("daily"), "Tóm tắt tự động cuối ngày", "Một thẻ lúc 18:00 giờ của chủ bảng, chỉ khi có thay đổi chưa báo.", "mode")}
          {option(mode === "silent", () => setMode("silent"), "Chỉ đánh dấu, không báo", "Không có thẻ nào trong chat.", "mode")}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className="press rounded-md border border-border px-4 py-2 text-[14px]" onClick={() => onOpenChange(false)}>
            Huỷ
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() =>
              save.mutateAsync({ tableId: table.id, who, mode }).then(
                () => {
                  toast.success("Đã lưu cách báo thay đổi.");
                  onOpenChange(false);
                },
                (error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được."),
              )
            }
            className="press rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Lưu
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The 24-hour safety net, as it reaches the person whose Hạng mục was changed (AVORA-62 · D). */
export function NudgeLines({ onOpen }: { onOpen: (nudge: BoardNudge) => void }) {
  const nudges = useQuery({ queryKey: boardChangeKeys.nudges, queryFn: fetchNudges, staleTime: 60_000 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const list = (nudges.data ?? []).filter((nudge) => !hidden.has(nudge.id));
  if (list.length === 0) return null;
  const close = (id: string): void => {
    setHidden((current) => new Set([...current, id]));
    void dismissNudge(id).catch(() => undefined);
  };
  return (
    <ul className="mt-3 space-y-1.5" aria-label="Thay đổi trên việc của bạn">
      {list.map((nudge) => (
        <li key={nudge.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13.5px]">
          <BellRing className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1">{nudge.content}</span>
          <button
            type="button"
            onClick={() => {
              close(nudge.id);
              onOpen(nudge);
            }}
            className="press shrink-0 rounded-md px-2 py-1 font-semibold text-primary"
          >
            Xem
          </button>
          <button type="button" aria-label="Ẩn dòng này" onClick={() => close(nudge.id)} className="press shrink-0 rounded p-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The card a Báo nhóm leaves in the chat (AVORA-62 · C): orange stripe, board icon, one button. */
export function BoardUpdateCard({ content, onView }: { content: string; onView?: () => void }) {
  const [head, ...rest] = content.split(" · ");
  return (
    <div data-board-update-card="" className="mx-auto w-full max-w-md rounded-xl border border-border border-l-[3px] border-l-primary bg-card px-3.5 py-3 shadow-[0_1px_0_hsl(var(--border))]">
      <p className="flex items-start gap-2 text-[14px] font-semibold leading-snug text-foreground">
        <Table2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0">{head}</span>
      </p>
      {rest.length > 0 ? <p className="mt-1 pl-6 text-[13px] text-muted-foreground">{rest.join(" · ")}</p> : null}
      {onView !== undefined ? (
        <button type="button" onClick={onView} className="press ml-6 mt-2 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-secondary">
          Xem thay đổi
        </button>
      ) : null}
    </div>
  );
}
