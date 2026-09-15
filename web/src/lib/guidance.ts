import { supabase } from "@/integrations/supabase/client";

/**
 * Explanations that are worth reading once and then never again.
 *
 * A hint that reappears every time stops being help and becomes furniture — people learn to
 * look past it, including the one time it mattered. So each of these is shown until the person
 * says they have read it, and then it is gone for good.
 */
export const GUIDANCE_KEYS = [
  "task_important_flag",
  "task_duration_field",
  "family_flag_tag",
  "task_output_value",
] as const;

export type GuidanceKey = (typeof GUIDANCE_KEYS)[number];

/**
 * Why "important" is not the same as "urgent" or "a lot of work".
 *
 * This is the one misunderstanding the old label caused: the tab used to say "Khẩn cấp", so
 * anything without a deadline looked like it did not belong. Calling your mother takes four
 * minutes and has no deadline at all, and it is still one of the more important things on the
 * list.
 */
export const GUIDANCE_TEXT: Record<GuidanceKey, string> = {
  task_important_flag:
    "Quan trọng không phải vì gấp hay tốn nhiều công sức — ví dụ: gọi điện hỏi thăm mẹ chỉ mất vài phút, không có hạn nào, nhưng vẫn đáng đánh dấu quan trọng.",
  task_duration_field:
    "Thời lượng dự kiến giúp bạn thấy việc nào tốn nhiều thời gian/sức lực để chủ động sắp xếp trước — không cần chính xác, không biết rõ thì chọn Nhẹ hoặc Nặng theo cảm nhận.",
  family_flag_tag:
    "Gia đình ở đây là mối quan hệ có trách nhiệm lâu dài (vợ/chồng, con cái, cha mẹ — kể cả nuôi hợp pháp), khác với việc chỉ đánh dấu ai đó quan trọng nhất thời.",
  task_output_value:
    "Kết quả là điều việc này mang lại khi hoàn thành — một con số, một sản phẩm, hay một điều bạn rút ra. Không bắt buộc: bỏ trống vẫn đánh dấu xong được. Có kết quả thì việc sẽ xuất hiện ở mục Báo cáo và có thể chuyển vào Nhật ký.",
};

export const guidanceKeys = {
  all: ["guidance"] as const,
  list: ["guidance", "dismissed"] as const,
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[guidance] ${code ?? "unknown"}: ${message}`);
  if (code === "42501" || message.toLowerCase().includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  return new Error("Không lưu được. Vui lòng thử lại.");
}

/** Which explanations this person has already dismissed. */
export async function fetchDismissedGuidance(): Promise<GuidanceKey[]> {
  const { data, error } = await supabase.from("dismissed_guidance").select("guidance_key");
  if (error) throw fail(error.code, error.message);
  const known = new Set<string>(GUIDANCE_KEYS);
  return (data ?? [])
    .map((row) => (row as { guidance_key: string }).guidance_key)
    .filter((key): key is GuidanceKey => known.has(key));
}

/**
 * Records that an explanation has been read. Retrying is harmless: the row is keyed by
 * (person, key), so dismissing twice is the same as dismissing once.
 */
export async function dismissGuidance(userId: string, key: GuidanceKey): Promise<void> {
  const { error } = await supabase
    .from("dismissed_guidance")
    .upsert({ user_id: userId, guidance_key: key }, { onConflict: "user_id,guidance_key" });
  if (error) throw fail(error.code, error.message);
}

/** Whether an explanation still has something to say to this person. */
export function shouldShowGuidance(dismissed: readonly GuidanceKey[], key: GuidanceKey): boolean {
  return !dismissed.includes(key);
}
