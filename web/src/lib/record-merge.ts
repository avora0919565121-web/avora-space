import type { ColumnDef, ExtensionValue, RecordPatch, RecordPriority } from "@/lib/think-hub";

/**
 * KT-09 · QA06-01 / QA06-02 — a Hạng mục form is saved field by field.
 *
 * The form keeps the version it was opened with. Saving sends only the fields the person changed
 * since then; everything else on the row — including what someone else saved meanwhile — stays as
 * the server has it. When both changed the same field, "Vẫn lưu của tôi" takes this person's value
 * for that field, and the conflict box names it before they choose.
 */

/** The form as the person types it — every field a string, as the inputs speak. */
export type RecordDraft = {
  title: string;
  status: string;
  priority: RecordPriority;
  category: string;
  nextActionDate: string;
  /** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input speaks it. */
  remindAt: string;
  tags: string;
  notes: string;
  extension: Record<string, string>;
};

export type CoreField = "title" | "status" | "priority" | "category" | "nextActionDate" | "remindAt" | "tags" | "notes";
/** A built-in field, or `ext:<column key>` for one of the table's own columns. */
export type FieldKey = CoreField | `ext:${string}`;

export const CORE_FIELDS: readonly CoreField[] = ["title", "status", "priority", "category", "nextActionDate", "remindAt", "tags", "notes"];

/** The labels the form itself shows, so the conflict box speaks the same words. */
export const CORE_FIELD_LABELS: Readonly<Record<CoreField, string>> = {
  title: "Tiêu đề",
  status: "Trạng thái",
  priority: "Độ ưu tiên",
  category: "Phân loại",
  nextActionDate: "Ngày cần làm tiếp",
  remindAt: "Nhắc tôi xem lại",
  tags: "Nhãn",
  notes: "Ghi chú",
};

function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** One field as it would be saved — whitespace and blanks read the way `buildPatch` writes them. */
function normalized(draft: RecordDraft, key: FieldKey): string {
  if (key.startsWith("ext:")) return (draft.extension[key.slice(4)] ?? "").trim();
  switch (key as CoreField) {
    case "title":
      return draft.title.trim();
    case "status":
      return draft.status.trim();
    case "priority":
      return draft.priority;
    case "category":
      return draft.category.trim();
    case "nextActionDate":
      return draft.nextActionDate;
    case "remindAt":
      return draft.remindAt;
    case "tags":
      return JSON.stringify(splitTags(draft.tags));
    case "notes":
      return draft.notes.trim();
  }
  return "";
}

function fieldKeys(columns: readonly ColumnDef[]): FieldKey[] {
  return [...CORE_FIELDS, ...columns.map((column) => `ext:${column.key}` as const)];
}

/** The fields whose saved value differs between two versions of the form. */
export function changedFields(from: RecordDraft, to: RecordDraft, columns: readonly ColumnDef[]): FieldKey[] {
  return fieldKeys(columns).filter((key) => normalized(from, key) !== normalized(to, key));
}

/**
 * The patch to send: only the fields changed since `base`, taken from `full` (the whole form,
 * already checked). The cell map is written whole by the server, so it is rebuilt on top of
 * `latestExtension` — the cells as the server has them now — with only this person's changed
 * cells replaced. Returns `{}` when nothing changed.
 */
export function changedPatch(
  base: RecordDraft,
  mine: RecordDraft,
  full: RecordPatch,
  columns: readonly ColumnDef[],
  latestExtension: Readonly<Record<string, ExtensionValue>>,
): RecordPatch {
  const changed = changedFields(base, mine, columns);
  const patch: { -readonly [K in keyof RecordPatch]: RecordPatch[K] } = {};
  const cells: Record<string, ExtensionValue> = { ...latestExtension };
  let anyCell = false;
  for (const key of changed) {
    if (key.startsWith("ext:")) {
      const column = key.slice(4);
      // A file cell holds nothing itself (its files live in their own rows): absent means "leave it".
      if (full.extensionFields === undefined || !(column in full.extensionFields)) continue;
      cells[column] = full.extensionFields[column];
      anyCell = true;
      continue;
    }
    const core = key as CoreField;
    (patch as Record<string, unknown>)[core] = full[core];
  }
  if (anyCell) patch.extensionFields = cells;
  return patch;
}

/** Plain names for a list of fields: "Tiêu đề, Ghi chú và Hạn". */
export function fieldNames(keys: readonly FieldKey[], columns: readonly ColumnDef[]): string {
  const names = keys.map((key) =>
    key.startsWith("ext:") ? (columns.find((column) => column.key === key.slice(4))?.label ?? key.slice(4)) : CORE_FIELD_LABELS[key as CoreField],
  );
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} và ${names[names.length - 1]}`;
}

/**
 * What "Vẫn lưu của tôi" will do, in one line, worked out from the version the form opened with
 * (`base`), what the person has typed now (`mine`) and the row as the server has it (`latest`).
 */
export function conflictSummary(input: {
  base: RecordDraft;
  mine: RecordDraft;
  latest: RecordDraft | null;
  columns: readonly ColumnDef[];
  byName: string | null;
  byMe: boolean;
  /** True while the server's row is still being read (then `latest` is null). */
  loading?: boolean;
}): { replaced: FieldKey[]; kept: FieldKey[]; text: string } {
  const { base, mine, latest, columns } = input;
  const who = input.byMe ? "bạn (ở nơi khác)" : input.byName !== null && input.byName.trim() !== "" ? input.byName.trim() : "người kia";
  const mineChanged = changedFields(base, mine, columns);
  if (latest === null && input.loading === true) {
    return { replaced: [], kept: [], text: `Đang xem ${who} đã sửa ô nào…` };
  }
  if (latest === null) {
    return { replaced: [], kept: [], text: `Chưa xem được ${who} đã sửa ô nào. Bấm "Vẫn lưu của tôi" sẽ tải lại trước khi lưu.` };
  }
  const theirs = changedFields(base, latest, columns);
  const replaced = mineChanged.filter((key) => theirs.includes(key) && normalized(mine, key) !== normalized(latest, key));
  const kept = theirs.filter((key) => !mineChanged.includes(key));
  if (mineChanged.length === 0) {
    return { replaced, kept, text: `Bạn chưa đổi ô nào — bản của ${who} giữ nguyên.` };
  }
  const parts: string[] = [];
  if (replaced.length > 0) parts.push(`Sẽ thay ${fieldNames(replaced, columns)} của ${who} bằng bản của bạn.`);
  if (kept.length > 0) parts.push(`${fieldNames(kept, columns)} ${who} vừa sửa vẫn giữ nguyên.`);
  if (replaced.length === 0) parts.push(`Chỉ lưu ${fieldNames(mineChanged, columns)} bạn đã đổi.`);
  return { replaced, kept, text: parts.join(" ") };
}
