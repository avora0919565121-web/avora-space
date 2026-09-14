import { supabase } from "@/integrations/supabase/client";

/**
 * Marking a contact as family.
 *
 * One-directional by design. This is your own record of who matters in a lasting way — not a
 * claim about them that they have to accept. Asking for confirmation would turn "my mother"
 * into a negotiation, and a refusal into an insult; the other person is never told and sees
 * nothing.
 *
 * Five fixed kinds rather than free text, because the point of this record is to be read by a
 * rule: a notification exception cannot act on "mẹ nuôi ❤️" typed by hand.
 */
export type FamilyRelationType = "spouse" | "parent" | "parent_in_law" | "child" | "other";

export type FamilyRelation = {
  relatedUserId: string;
  relationType: FamilyRelationType;
};

/**
 * The five kinds, in the order they are offered.
 *
 * Adoptive parents and children sit inside `parent` and `child` rather than in kinds of their
 * own: in law and in practice they carry the same lasting responsibility, and separating them
 * would ask people to rank their own family.
 */
export const FAMILY_RELATION_OPTIONS: readonly {
  value: FamilyRelationType;
  label: string;
  note: string;
}[] = [
  { value: "spouse", label: "Vợ/Chồng", note: "Người bạn đời" },
  { value: "parent", label: "Ba mẹ", note: "Ruột hoặc nuôi được pháp luật công nhận" },
  { value: "parent_in_law", label: "Ba mẹ vợ/chồng", note: "Bên gia đình bạn đời" },
  { value: "child", label: "Con", note: "Ruột hoặc nuôi được pháp luật công nhận" },
  { value: "other", label: "Gia đình khác", note: "Anh chị em, họ hàng gần" },
] as const;

export const familyKeys = {
  all: ["family-relations"] as const,
  list: ["family-relations", "list"] as const,
};

/** The Vietnamese label for a stored kind. */
export function familyRelationLabel(type: FamilyRelationType): string {
  return FAMILY_RELATION_OPTIONS.find((option) => option.value === type)?.label ?? "Gia đình";
}

/** Anything not one of the five reads as `other` rather than crashing the screen. */
export function isFamilyRelationType(value: string): value is FamilyRelationType {
  return FAMILY_RELATION_OPTIONS.some((option) => option.value === value);
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[family] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("family_relations_not_self"))
    return new Error("Bạn không thể tự đánh dấu chính mình.");
  if (normalized.includes("family_relations_type_valid"))
    return new Error("Loại quan hệ không hợp lệ.");
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  if (normalized.includes("row-level security"))
    return new Error("Bạn chỉ đánh dấu được người đã từng trò chuyện riêng với bạn.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không lưu được đánh dấu. Vui lòng thử lại.");
}

type FamilyRow = { related_user_id: string; relation_type: string };

/**
 * Everyone this person has marked as family.
 *
 * RLS restricts the rows to their own, so there is no filter here to forget — the query
 * cannot return anyone else's record of their family.
 */
export async function fetchFamilyRelations(): Promise<FamilyRelation[]> {
  const { data, error } = await supabase
    .from("family_relations")
    .select("related_user_id, relation_type");
  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => {
    const entry = row as FamilyRow;
    return {
      relatedUserId: entry.related_user_id,
      relationType: isFamilyRelationType(entry.relation_type) ? entry.relation_type : "other",
    };
  });
}

/** Marks a contact as family, or changes which kind. */
export async function setFamilyRelation(
  userId: string,
  relatedUserId: string,
  relationType: FamilyRelationType,
): Promise<void> {
  const { error } = await supabase
    .from("family_relations")
    .upsert(
      { user_id: userId, related_user_id: relatedUserId, relation_type: relationType },
      { onConflict: "user_id,related_user_id" },
    );
  if (error) throw fail(error.code, error.message);
}

/** Removes the mark. Available at any time, to the only person who can see it. */
export async function clearFamilyRelation(relatedUserId: string): Promise<void> {
  const { error } = await supabase
    .from("family_relations")
    .delete()
    .eq("related_user_id", relatedUserId);
  if (error) throw fail(error.code, error.message);
}

/** Rows to a lookup by person, for reading one contact's mark without a per-row search. */
export function toFamilyIndex(
  relations: readonly FamilyRelation[],
): ReadonlyMap<string, FamilyRelationType> {
  return new Map(relations.map((entry) => [entry.relatedUserId, entry.relationType]));
}

/**
 * Whether this person is family to the viewer.
 *
 * The question Prompt 10's mute exception asks. Kept here rather than inlined there so both
 * the screen and the notification rule read the same answer from the same place.
 */
export function isFamily(
  index: ReadonlyMap<string, FamilyRelationType>,
  userId: string | null | undefined,
): boolean {
  if (userId === null || userId === undefined) return false;
  return index.has(userId);
}
