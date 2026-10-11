import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BookCover } from "@/components/library/BookCover";
import { bookTitleLines, CHILDREN_AGES, coverUrl, fetchChildrenShelf, type CatalogBook, type ChildrenAge } from "@/lib/book-catalog";
import { useShelfCatalog } from "@/lib/use-book-covers";
import { cn } from "@/lib/utils";

type Row = ChildrenAge | "tranh";
const ROW_LABEL: Record<Row, string> = { thieu_nhi: "Thiếu nhi", thieu_nien: "Thiếu niên", tranh: "Sách tranh" };

/**
 * AVORA-100 · S.2 §4.4 — `Tủ sách tuổi thơ`, inside the `Thiếu nhi · Thiếu niên` chip. Two rows
 * (three when open-licence picture books are in), the Vietnamese title as the main line, the
 * original under it. A chip for each age narrows to one row. Nothing is scored or counted.
 */
export function ChildrenShelf({ onShelf, onAdd }: { onShelf: ReadonlySet<string>; onAdd: (item: CatalogBook) => Promise<void> }) {
  const shelf = useQuery({ queryKey: ["children-shelf"], queryFn: fetchChildrenShelf, staleTime: 10 * 60_000 });
  const [only, setOnly] = useState<Row | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const keys = useMemo(
    () => [...(shelf.data?.thieu_nhi ?? []), ...(shelf.data?.thieu_nien ?? []), ...(shelf.data?.tranh ?? [])].map((b) => `${b.source}:${b.sourceId}`),
    [shelf.data],
  );
  const covers = useShelfCatalog(keys);
  const rows: Row[] = (["thieu_nhi", "thieu_nien", "tranh"] as const).filter((r) => (shelf.data?.[r].length ?? 0) > 0);
  const chips: { id: Row; label: string }[] = [...CHILDREN_AGES, ...((shelf.data?.tranh.length ?? 0) > 0 ? [{ id: "tranh" as const, label: "Sách tranh" }] : [])];

  const add = (item: CatalogBook): void => {
    const key = `${item.source}:${item.sourceId}`;
    setAdding(key);
    onAdd(item)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa thêm được sách."))
      .finally(() => setAdding(null));
  };

  return (
    <section aria-label="Tủ sách tuổi thơ" data-children-shelf="" className="mt-4 rounded-card border border-border bg-card/60 py-3">
      <div className="flex flex-col px-3 md:flex-row md:items-baseline md:gap-2">
        <h4 className="text-[15px] font-semibold text-foreground">Tủ sách tuổi thơ</h4>
        <span className="text-[12px] text-muted-foreground">sách công cộng và giấy phép mở</span>
      </div>
      <div className="mt-2 flex gap-1.5 px-3" role="group" aria-label="Lứa tuổi">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={only === c.id}
            data-children-age={c.id}
            onClick={() => setOnly(only === c.id ? null : c.id)}
            className={cn("press h-9 rounded-full border px-3.5 text-[13px] font-medium", only === c.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {shelf.isPending ? (
        <p className="mt-3 flex items-center gap-2 px-3 text-[13.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Đang mở tủ sách…
        </p>
      ) : shelf.isError ? (
        <p className="mt-3 px-3 text-[13.5px] text-muted-foreground">Chưa mở được tủ sách. Thử lại sau nhé.</p>
      ) : (
        rows
          .filter((r) => only === null || only === r)
          .map((r) => (
            <div key={r} className="mt-3" data-children-row={r}>
              <p className="px-3 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{ROW_LABEL[r]}</p>
              <ul
                data-h-scroll=""
                className={cn(
                  "mt-2 gap-3 px-3",
                  only === null ? "flex snap-x overflow-x-auto pb-1 [scrollbar-width:none]" : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5",
                )}
              >
                {(shelf.data?.[r] ?? []).map((item) => {
                  const key = `${item.source}:${item.sourceId}`;
                  const lines = bookTitleLines(item);
                  const isOn = onShelf.has(key);
                  const cover = coverUrl(covers.get(key)?.coverPath ?? item.coverPath);
                  return (
                    <li key={key} className={cn("flex flex-col", only === null && "w-[104px] shrink-0 snap-start")} data-children-book={key}>
                      <BookCover title={lines.main} original={lines.original} author={item.authors} url={cover} viStrip={cover !== null && lines.original !== null ? lines.main : null} size="continue" className="w-full" />
                      <span className="mt-1.5 line-clamp-2 text-[13.5px] font-medium leading-snug text-foreground" data-title-main="">
                        {lines.main}
                      </span>
                      {lines.original !== null ? (
                        <span className="truncate text-[11.5px] text-muted-foreground" lang={item.language} data-title-original="">
                          {lines.original}
                        </span>
                      ) : null}
                      {isOn ? (
                        <span className="mt-1 inline-flex min-h-9 items-center gap-1 text-[12.5px] text-muted-foreground">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Trên kệ
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={adding === key}
                          onClick={() => add(item)}
                          aria-label={`Muốn đọc: ${lines.main}`}
                          className="press mt-1 inline-flex min-h-9 items-center gap-1 self-start rounded-lg border border-border px-2.5 text-[12.5px] font-medium disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Muốn đọc
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
      )}
    </section>
  );
}
