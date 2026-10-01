import { conversationTitle, type ConversationSummary } from "@/lib/chat-cache";

/** Where a new standalone table can live: the Diary, or one 1-1 / group conversation. */
export type TablePlace = {
  /** Null = personal (Diary). */
  conversationId: string | null;
  label: string;
};

export const PERSONAL_PLACE: TablePlace = { conversationId: null, label: "Của tôi" };

function placeOf(item: ConversationSummary): TablePlace {
  return {
    conversationId: item.conversationId,
    label: item.kind === "group" ? `Nhóm ${conversationTitle(item)}` : `1-1 với ${conversationTitle(item)}`,
  };
}

/**
 * The "Ở đâu" choices for a new table (AVORA-35 / D).
 *
 * Opened from inside one conversation (`?noi=<id>`), the table belongs to that conversation: only
 * the Diary and that one conversation are offered, so a table meant for a 1-1 with A can never
 * land in group B by a slip. Opened from "+" on Kế hoạch (no origin), every 1-1 and group is
 * listed — that is the one place to file a table somewhere else.
 *
 * An origin that is not among the viewer's conversations (a stale link) falls back to the full list.
 */
export function tablePlaces(
  conversations: readonly ConversationSummary[],
  originConversationId: string | null,
): TablePlace[] {
  if (originConversationId !== null) {
    const origin = conversations.find(
      (item) => item.conversationId === originConversationId && (item.kind === "direct" || item.kind === "group"),
    );
    if (origin !== undefined) return [PERSONAL_PLACE, placeOf(origin)];
  }
  const list: TablePlace[] = [PERSONAL_PLACE];
  for (const item of conversations) if (item.kind === "direct") list.push(placeOf(item));
  for (const item of conversations) if (item.kind === "group") list.push(placeOf(item));
  return list;
}
