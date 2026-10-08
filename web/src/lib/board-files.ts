import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all-rows";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import { logError } from "@/lib/log";

/** A file attached to one cell of a Bảng (AVORA-61 · D · Tệp). */
export type BoardCellFile = {
  id: string;
  tableId: string;
  recordId: string;
  columnKey: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  uploadedBy: string;
  createdAt: string;
};

type Row = {
  id: string;
  table_id: string;
  record_id: string;
  column_key: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  uploaded_by: string;
  created_at: string;
};

const COLUMNS = "id, table_id, record_id, column_key, storage_path, file_name, mime_type, byte_size, uploaded_by, created_at";
const BUCKET = "board-files";

export const boardFileKeys = {
  all: ["board-files"] as const,
  table: (tableId: string) => ["board-files", tableId] as const,
};

function toFile(row: Row): BoardCellFile {
  return {
    id: row.id,
    tableId: row.table_id,
    recordId: row.record_id,
    columnKey: row.column_key,
    storagePath: row.storage_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

function fail(code: string | undefined, message: string): Error {
  logError("board-files", { code, message });
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return new Error("Chỉ người tải lên hoặc chủ Bảng làm được việc này.");
  }
  if (/exceeded|too large|payload/i.test(message)) return new Error("Tệp quá lớn (tối đa 25 MB).");
  return new Error("Không xử lý được tệp. Vui lòng thử lại.");
}

/** Every file of one Bảng, for counting and listing per cell. */
export async function fetchBoardFiles(tableId: string): Promise<BoardCellFile[]> {
  try {
    const rows = await fetchAllRows<Row>((from, to) =>
      supabase.from("think_hub_cell_files").select(COLUMNS).eq("table_id", tableId).order("created_at").order("id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { code?: string; message: string } | null }>,
    );
    return rows.map(toFile);
  } catch (caught: unknown) {
    const e = caught as { code?: string; message?: string };
    throw fail(e.code, e.message ?? "");
  }
}

/** Uploads into `<table>/<record>/…` then records the row; the bucket and the row both check the board. */
export async function uploadBoardFile(input: { tableId: string; recordId: string; columnKey: string; file: File }): Promise<BoardCellFile> {
  if (input.file.size > MAX_ATTACHMENT_BYTES) throw new Error("Tệp quá lớn (tối đa 25 MB).");
  const safe = input.file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "tep";
  const path = `${input.tableId}/${input.recordId}/${crypto.randomUUID()}-${safe}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || "application/octet-stream",
    upsert: false,
  });
  if (uploadError) throw fail(undefined, uploadError.message);
  const { data, error } = await supabase
    .from("think_hub_cell_files")
    .insert({
      table_id: input.tableId,
      record_id: input.recordId,
      column_key: input.columnKey,
      storage_path: path,
      file_name: input.file.name.slice(0, 255) || "tệp",
      mime_type: (input.file.type || "application/octet-stream").slice(0, 255),
      byte_size: input.file.size,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw fail(error.code, error.message);
  }
  return toFile(data as Row);
}

/** Removes the row first (RLS decides who may), then the stored object. */
export async function deleteBoardFile(file: BoardCellFile): Promise<void> {
  const { data, error } = await supabase.from("think_hub_cell_files").delete().eq("id", file.id).select("id");
  if (error) throw fail(error.code, error.message);
  if ((data ?? []).length === 0) throw fail("42501", "permission denied");
  await supabase.storage.from(BUCKET).remove([file.storagePath]);
}

/** A short-lived link to open a file in a new tab. */
export async function signedBoardFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || data === null) throw fail(undefined, error?.message ?? "no url");
  return data.signedUrl;
}

/** How many files each cell holds, keyed `${recordId}:${columnKey}`. */
export function fileCountsByCell(files: readonly BoardCellFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const key = `${file.recordId}:${file.columnKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
