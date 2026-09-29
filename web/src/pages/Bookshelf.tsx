import { ExternalLink, Library, Loader2, Plus, Search, Star, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DateField } from "@/components/calendar/DateField";
import { HubTitle } from "@/components/nav/HubTitle";
import { ReturnChip } from "@/components/nav/ReturnChip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { normalizeSearch } from "@/lib/normalize-search";
import { recordsOf, scopeOfTable, todayIso, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useThinkHub, useThinkHubActions } from "@/lib/use-think-hub";
import { useShelfActions, useStars } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

/** Shelves in reading order (C6): what is being read first, what was finished last. */
const TIERS: readonly { key: string; label: string }[] = [
  { key: "dang_doc", label: "Đang đọc" },
  { key: "muon_doc", label: "Muốn đọc" },
  { key: "doc_lai", label: "Đọc lại" },
  { key: "da_doc", label: "Đã đọc" },
];

/** Muted AVORA covers: the colour follows the title, so a book always looks the same. */
const COVERS: readonly string[] = ["#5B4636", "#2F4A3F", "#3B4A63", "#6B3F3F", "#4A4A2E", "#3F3552", "#2E4F55", "#6A5230"];

function coverColor(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVERS[hash % COVERS.length];
}

/** "40%", "40 %" or "trang 40/100" → 0.4; anything else has no bar. */
export function readingProgress(position: string | null | undefined): number | null {
  if (position == null) return null;
  const percent = position.match(/(\d{1,3})\s*%/);
  if (percent !== null) return Math.min(100, Number(percent[1])) / 100;
  const pages = position.match(/(\d+)\s*\/\s*(\d+)/);
  if (pages !== null && Number(pages[2]) > 0) return Math.min(1, Number(pages[1]) / Number(pages[2]));
  return null;
}

function columnKey(table: ThinkTable | null, label: string): string | null {
  return table?.columns.find((column) => column.label === label)?.key ?? null;
}

function addDays(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Kệ sách (Đợt gộp 2 · C6): one bookshelf table per person, shown as shelves of covers. AVORA
 * does not read the books — "Mở sách" opens the link the person saved.
 */
const Bookshelf = () => {
  const navigate = useNavigate();
  const { tables, records, isPending } = useThinkHub();
  const actions = useThinkHubActions();
  const { bookshelf, star } = useShelfActions();
  const stars = useStars();
  const askedRef = useRef<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const shelf: ThinkTable | null = useMemo(() => tables.find((table) => table.kind === "bookshelf") ?? null, [tables]);
  useEffect(() => {
    if (isPending || shelf !== null || askedRef.current) return;
    askedRef.current = true;
    bookshelf.mutate();
  }, [isPending, shelf, bookshelf]);

  const keys = useMemo(
    () => ({
      author: columnKey(shelf, "Tác giả"),
      source: columnKey(shelf, "Nguồn"),
      link: columnKey(shelf, "Link"),
      position: columnKey(shelf, "Đang ở"),
      lesson: columnKey(shelf, "Bài học chính"),
    }),
    [shelf],
  );
  const books: ThinkRecord[] = useMemo(() => (shelf === null ? [] : recordsOf(records, shelf.id)), [records, shelf]);
  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    if (needle === "") return books;
    return books.filter((book) => normalizeSearch(`${book.title} ${keys.author === null ? "" : String(book.extensionFields[keys.author] ?? "")}`).includes(needle));
  }, [books, query, keys.author]);
  const opened = books.find((book) => book.id === openId) ?? null;
  const field = (book: ThinkRecord, key: string | null): string => (key === null ? "" : String(book.extensionFields[key] ?? ""));

  const patchField = (book: ThinkRecord, key: string | null, value: string): void => {
    if (key === null) return;
    actions.updateRecord(book.id, { extensionFields: { ...book.extensionFields, [key]: value.trim() === "" ? null : value.trim() } }).catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Không lưu được."),
    );
  };

  if (isPending || shelf === null) {
    return (
      <div className="paper flex min-h-0 flex-1 items-center justify-center">
        {bookshelf.isError ? <p role="alert" className="text-destructive">Chưa mở được Kệ sách.</p> : <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div className="paper flex min-h-0 flex-1 flex-col">
      <HubTitle
        title="Kệ sách"
        className="max-w-6xl"
        action={
          <button type="button" onClick={() => setIsAdding(true)} className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-[14.5px] font-semibold text-primary-foreground">
            <Plus className="h-[18px] w-[18px]" aria-hidden="true" /> Thêm sách
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 md:px-10">
          <ReturnChip className="-mt-2 mb-2" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm sách, tác giả…" aria-label="Tìm sách" className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none" />
            </label>
            <button type="button" onClick={() => navigate(`/ke-hoach?bang=${shelf.id}`)} className="press inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-[13.5px]">
              <Table2 className="h-4 w-4" aria-hidden="true" /> Xem dạng bảng
            </button>
          </div>

          {books.length === 0 ? (
            <div className="mt-10 flex flex-col items-center text-center">
              <Library className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-[16px] font-medium text-foreground">Tôi học được gì, áp dụng thế nào?</p>
              <button type="button" onClick={() => setIsAdding(true)} className="press mt-4 rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground">+ Thêm sách</button>
            </div>
          ) : (
            TIERS.map((tier) => {
              const list = filtered.filter((book) => book.status === tier.key);
              if (list.length === 0) return null;
              return (
                <section key={tier.key} aria-label={tier.label} className="mt-7">
                  <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{tier.label} · {list.length}</h2>
                  <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:overflow-visible md:px-0">
                    {list.map((book) => {
                      const progress = readingProgress(field(book, keys.position));
                      return (
                        <li key={book.id} className="w-[112px] shrink-0 md:w-auto">
                          <button type="button" onClick={() => setOpenId(book.id)} className="press group block w-full text-left">
                            <span
                              className="relative flex aspect-[2/3] w-full flex-col justify-between overflow-hidden rounded-md p-2.5 shadow-sm ring-1 ring-black/10 transition-transform group-hover:-translate-y-0.5"
                              style={{ backgroundColor: coverColor(book.title) }}
                            >
                              <span className="line-clamp-4 text-[13px] font-semibold leading-snug text-white">{book.title}</span>
                              <span className="line-clamp-2 text-[11px] text-white/75">{field(book, keys.author)}</span>
                              {stars.data?.has(book.id) === true ? <Star className="absolute right-1.5 top-1.5 h-3.5 w-3.5 fill-amber-300 text-amber-300" aria-label="Quan trọng" /> : null}
                            </span>
                            {progress !== null ? (
                              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary">
                                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>

      <AddBookDialog
        open={isAdding}
        onOpenChange={setIsAdding}
        sources={shelf.columns.find((column) => column.key === keys.source)?.options ?? []}
        onAdd={async (input) => {
          const extensionFields: Record<string, string> = {};
          if (keys.author !== null && input.author.trim() !== "") extensionFields[keys.author] = input.author.trim();
          if (keys.source !== null && input.source !== "") extensionFields[keys.source] = input.source;
          if (keys.link !== null && input.link.trim() !== "") extensionFields[keys.link] = input.link.trim();
          await actions.createRecord({ tableId: shelf.id, scope: scopeOfTable(shelf), title: input.title, status: "muon_doc", extensionFields });
          toast.success("Đã thêm vào tầng Muốn đọc.");
        }}
      />

      <Dialog open={opened !== null} onOpenChange={(next) => !next && setOpenId(null)}>
        <DialogContent className="max-h-[88dvh] max-w-[480px] overflow-y-auto">
          {opened !== null ? (
            <>
              <DialogTitle className="text-[19px]">{opened.title}</DialogTitle>
              <DialogDescription className="text-[13px]">{[field(opened, keys.author), field(opened, keys.source)].filter((part) => part !== "").join(" · ") || "Chưa ghi tác giả"}</DialogDescription>
              <div role="group" aria-label="Trạng thái" className="flex flex-wrap gap-1.5">
                {TIERS.map((tier) => (
                  <button
                    key={tier.key}
                    type="button"
                    aria-pressed={opened.status === tier.key}
                    onClick={() => void actions.updateRecord(opened.id, { status: tier.key })}
                    className={cn("press rounded-full border px-3 py-1.5 text-[13px]", opened.status === tier.key ? "border-primary bg-primary/10 font-semibold" : "border-border")}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-[13px] font-medium">Đang ở</span>
                <input
                  key={`pos-${opened.id}`}
                  defaultValue={field(opened, keys.position)}
                  placeholder="40% · trang 120/300 · chương 5"
                  onBlur={(event) => event.target.value !== field(opened, keys.position) && patchField(opened, keys.position, event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-[14.5px] outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="text-[13px] font-medium">Bài học chính</span>
                <textarea
                  key={`lesson-${opened.id}`}
                  rows={3}
                  defaultValue={field(opened, keys.lesson)}
                  onBlur={(event) => event.target.value !== field(opened, keys.lesson) && patchField(opened, keys.lesson, event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[14.5px] outline-none focus:border-primary"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {field(opened, keys.link) !== "" ? (
                  <a href={field(opened, keys.link)} target="_blank" rel="noreferrer noopener" className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13.5px] font-semibold text-primary-foreground">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Mở sách
                  </a>
                ) : null}
                <button type="button" onClick={() => star.mutate(opened.id)} className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13.5px]">
                  <Star className={cn("h-4 w-4", stars.data?.has(opened.id) === true && "fill-amber-400 text-amber-400")} aria-hidden="true" /> Quan trọng
                </button>
                <button type="button" disabled title="Sắp có" className="rounded-md border border-dashed border-border px-3 py-2 text-[13.5px] text-muted-foreground opacity-60">
                  Ghi chép · Sắp có
                </button>
              </div>
              <div>
                <p className="text-[13px] font-medium">Đọc lại sau…</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[30, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() =>
                        actions.updateRecord(opened.id, { status: "doc_lai", nextActionDate: addDays(days) }).then(
                          () => toast.success(`Sẽ nhắc đọc lại sau ${days} ngày.`),
                          (error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được."),
                        )
                      }
                      className="press rounded-full border border-border px-3 py-1.5 text-[13px]"
                    >
                      {days} ngày
                    </button>
                  ))}
                  <DateField
                    id={`reread-${opened.id}`}
                    className="min-w-[160px]"
                    value={opened.nextActionDate ?? ""}
                    onChange={(value) => value !== "" && void actions.updateRecord(opened.id, { status: "doc_lai", nextActionDate: value })}
                    label="Chọn ngày đọc lại"
                    title="Chọn ngày đọc lại"
                    allow="future"
                    min={todayIso()}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpenId(null);
                  navigate(`/ke-hoach?bang=${shelf.id}&hang-muc=${opened.id}`);
                }}
                className="press self-start text-[13px] font-medium text-primary"
              >
                Áp dụng: tạo Hạng mục hoặc nhiệm vụ từ sách này →
              </button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

function AddBookDialog({
  open,
  onOpenChange,
  sources,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: readonly string[];
  onAdd: (input: { title: string; author: string; source: string; link: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState<string>("");
  const [author, setAuthor] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAuthor("");
    setSource("");
    setLink("");
  }, [open]);
  const input = "mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-[14.5px] outline-none focus:border-primary";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        <DialogTitle className="text-[18px]">Thêm sách</DialogTitle>
        <label className="block"><span className="text-[13px] font-medium">Tên sách</span><input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="block"><span className="text-[13px] font-medium">Tác giả</span><input value={author} onChange={(e) => setAuthor(e.target.value)} className={input} /></label>
        <label className="block">
          <span className="text-[13px] font-medium">Nguồn</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
            <option value="">—</option>
            {sources.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-[13px] font-medium">Link (không bắt buộc)</span><input value={link} inputMode="url" onChange={(e) => setLink(e.target.value)} className={input} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className="press rounded-md border border-border px-4 py-2 text-[14px]">Huỷ</button>
          <button
            type="button"
            disabled={title.trim() === "" || isSaving}
            onClick={() => {
              setIsSaving(true);
              onAdd({ title, author, source, link })
                .then(() => onOpenChange(false), (error: unknown) => toast.error(error instanceof Error ? error.message : "Không thêm được sách."))
                .finally(() => setIsSaving(false));
            }}
            className="press rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Thêm vào Muốn đọc
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default Bookshelf;
