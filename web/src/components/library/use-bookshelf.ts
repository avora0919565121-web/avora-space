import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { booksOnDevice, FINISHED_PERCENT, fetchAllReadingStates, type ReadingState } from "@/lib/reading-state";
import { borrowKeyOf, catalogRefOf, coverUrl } from "@/lib/book-catalog";
import { recordsOf, type ThinkRecord, type ThinkTable } from "@/lib/think-hub";
import { useMyCovers, useShelfCatalog } from "@/lib/use-book-covers";
import { useThinkHub } from "@/lib/use-think-hub";

function columnKey(table: ThinkTable | null, label: string): string | null {
  return table?.columns.find((column) => column.label === label)?.key ?? null;
}

/** Kệ sách: the board, its column keys and its books. */
export function useBookshelf() {
  const { tables, records, isPending } = useThinkHub();
  const shelf: ThinkTable | null = useMemo(() => tables.find((table) => table.kind === "bookshelf") ?? null, [tables]);
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
  const field = (book: ThinkRecord, key: string | null): string => (key === null ? "" : String(book.extensionFields[key] ?? ""));
  return { shelf, keys, books, field, isPending };
}

/** The cover of a book on my shelf (AVORA-103 · C): my photo, else Avora's kept cover, else drawn. */
export function useShelfCovers() {
  const { keys, books, field } = useBookshelf();
  const catalogKeys = useMemo(
    () => books.map((book) => {
      const link = field(book, keys.link);
      const ref = catalogRefOf(link);
      return ref === null ? (borrowKeyOf(link) ?? "") : `${ref.source}:${ref.sourceId}`;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field reads keys
    [books, keys.link],
  );
  const catalog = useShelfCatalog(catalogKeys);
  const mine = useMyCovers();
  const keyOf = (book: { id: string }): string => catalogKeys[books.findIndex((item) => item.id === book.id)] ?? "";
  const coverOf = (book: { id: string; title: string }) => {
    const info = catalog.get(keyOf(book)) ?? null;
    const own = mine.get(book.id) ?? null;
    const hasVi = info !== null && info.language !== "vi" && info.titleVi !== null && info.titleVi !== "";
    return {
      title: book.title,
      original: hasVi && info !== null ? info.title : null,
      author: books.find((item) => item.id === book.id) === undefined ? null : field(books.find((item) => item.id === book.id) as ThinkRecord, keys.author),
      url: own?.url ?? coverUrl(info?.coverPath),
      viStrip: hasVi ? book.title : null,
      isMine: own !== null,
      info,
    };
  };
  return { coverOf, keyOf };
}

export type DeviceBook = { key: string; title: string; bytes: number; percent: number | null; recordId: string | null; finished: boolean };

/**
 * AVORA-103 · D — the books kept on THIS device (at most five), with how far each is read.
 * Finished ones (≥ 95 %) come first: they are the ones to let go.
 */
export function useOnDeviceBooks() {
  const { user } = useAuth();
  const list = useQuery({ queryKey: ["books-on-device"], queryFn: booksOnDevice, staleTime: 10_000 });
  const states = useQuery<ReadingState[], Error>({ queryKey: ["book-reading-state", "all"], queryFn: fetchAllReadingStates, enabled: Boolean(user?.id), staleTime: 30_000 });
  const { books } = useBookshelf();
  const { keyOf } = useShelfCovers();
  const items: DeviceBook[] = useMemo(() => {
    const percentOf = new Map((states.data ?? []).map((state) => [state.recordId, state.percent] as const));
    const out = (list.data ?? []).map((item) => {
      const record = books.find((book) => keyOf(book) === item.key) ?? null;
      const percent = record === null ? null : (percentOf.get(record.id) ?? null);
      return { key: item.key, title: record?.title ?? item.title, bytes: item.bytes, percent, recordId: record?.id ?? null, finished: percent !== null && percent >= FINISHED_PERCENT };
    });
    return out.sort((a, b) => Number(b.finished) - Number(a.finished));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf follows books
  }, [list.data, states.data, books]);
  return { items, isPending: list.isPending };
}

