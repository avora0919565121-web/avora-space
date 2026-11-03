/**
 * Kệ sách / trình đọc › Ghi chép: địa chỉ mang một "yêu cầu một lần" (`?ghi-chep=<id>` mở một ghi
 * chép, `?sach=<id>&ten=…&trich=…&cho=…&o=…` bắt đầu một ghi chép về sách).
 *
 * 112-G · lưu ý 2 (lỗi 01/11, 100 bản ghi chép): yêu cầu được đọc đúng một lần, rồi **xoá khỏi địa
 * chỉ ngay** (thay địa chỉ, không thêm bước lùi). Lớp chặn trùng 5 giây ở Messages chỉ là lớp phụ.
 */
export const NOTES_ASK_PARAMS = ["ghi-chep", "sach", "ten", "trich", "cho", "o"] as const;

export type NotesAsk =
  | { noteId: string }
  | { book: { recordId: string; title: string; excerpt?: { text: string; where: string | null; locator: string | null } } };

/** Reads the ask (or null) and the address without it. Other params are kept as they are. */
export function takeNotesAsk(params: URLSearchParams): { ask: NotesAsk | null; key: string; rest: URLSearchParams } {
  const rest = new URLSearchParams(params);
  for (const key of NOTES_ASK_PARAMS) rest.delete(key);
  const key = NOTES_ASK_PARAMS.map((name) => params.get(name) ?? "").join("\u0001");
  const noteId = params.get("ghi-chep");
  if (noteId !== null && noteId !== "") return { ask: { noteId }, key, rest };
  const book = params.get("sach");
  if (book === null || book === "") return { ask: null, key, rest };
  // AVORA-77 · D3: `trich=` carries a passage chosen in the reader (≤ 2000 chars) and `cho=` its chapter.
  const excerpt = params.get("trich");
  const locator = params.get("o") ?? "";
  return {
    ask: {
      book: {
        recordId: book,
        title: params.get("ten") ?? "Sách",
        excerpt:
          excerpt === null || excerpt.trim() === ""
            ? undefined
            : { text: excerpt.slice(0, 2000), where: params.get("cho") ?? null, locator: /^\d{1,5}:\d{1,6}$/.test(locator) ? locator : null },
      },
    },
    key,
    rest,
  };
}

/** True when the address still carries any part of an ask. */
export function hasNotesAsk(params: URLSearchParams): boolean {
  return NOTES_ASK_PARAMS.some((name) => params.has(name));
}
