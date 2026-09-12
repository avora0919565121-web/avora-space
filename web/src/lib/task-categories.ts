import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 3B task categories. Private to their owner: a shared 1-1 task carries its creator's
 * label, and the peer simply sees none rather than being shown a shelf that is not theirs.
 */
export type TaskCategory = {
  id: string;
  name: string;
  /** Stable English key on the six seeded shelves; null on anything the person made. */
  slug: string | null;
  color: string;
  isDefault: boolean;
  sortOrder: number;
};

export const TASK_CATEGORY_NAME_MAX_LEN = 50;

export const taskCategoryKeys = {
  all: ["task-categories"] as const,
  list: ["task-categories", "list"] as const,
};

type Row = {
  id: string;
  name: string;
  slug: string | null;
  color: string;
  is_default: boolean;
  sort_order: number;
};

function toCategory(row: Row): TaskCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    isDefault: row.is_default,
    sortOrder: row.sort_order,
  };
}

const COLUMNS = "id, name, slug, color, is_default, sort_order";

function toVietnameseCategoryError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();
  if (code === "23505" || normalized.includes("task_categories_user_name_key") || normalized.includes("duplicate key"))
    return "Bạn đã có hạng mục tên này.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với hạng mục này.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Không lưu được hạng mục. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[task-categories] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseCategoryError(code, message));
}

/** Case-blind, because "Gấp" and "gấp" are the same shelf to the person reading the list. */
export function validateTaskCategoryName(
  raw: string,
  existing: readonly TaskCategory[],
  editingId?: string,
): { name: string | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { name: null, error: "Tên hạng mục không được để trống." };
  if (trimmed.length > TASK_CATEGORY_NAME_MAX_LEN)
    return { name: null, error: `Tên hạng mục quá dài (tối đa ${TASK_CATEGORY_NAME_MAX_LEN} ký tự).` };
  const clash = existing.some(
    (entry) => entry.id !== editingId && entry.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return { name: null, error: "Bạn đã có hạng mục tên này." };
  return { name: trimmed, error: null };
}

export async function fetchTaskCategories(): Promise<TaskCategory[]> {
  const { data, error } = await supabase
    .from("task_categories")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toCategory(row as Row));
}

/** Colours come from the printed chart ramp; terracotta stays reserved for buttons and nav. */
export const TASK_CATEGORY_COLORS: readonly string[] = [
  "#3F8F6B",
  "#C98A3E",
  "#5B7B8A",
  "#8C6A4A",
  "#7D8A4F",
  "#D68A6F",
  "#4E6E7D",
  "#A8926F",
] as const;

export async function createTaskCategory(
  userId: string,
  name: string,
  color: string,
  sortOrder: number,
): Promise<TaskCategory> {
  const { data, error } = await supabase
    .from("task_categories")
    .insert({ user_id: userId, name, color, sort_order: sortOrder })
    .select(COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toCategory(data as Row);
}

export async function renameTaskCategory(categoryId: string, name: string): Promise<TaskCategory> {
  const { data, error } = await supabase
    .from("task_categories")
    .update({ name })
    .eq("id", categoryId)
    .select(COLUMNS)
    .single();
  if (error) throw fail(error.code, error.message);
  return toCategory(data as Row);
}

/**
 * Removes one of the person's own shelves. A seeded default cannot be deleted — its slug is
 * what the standard filters are built on — so the caller should not offer the control.
 */
export async function deleteTaskCategory(categoryId: string): Promise<void> {
  const { error } = await supabase.from("task_categories").delete().eq("id", categoryId);
  if (error) throw fail(error.code, error.message);
}
