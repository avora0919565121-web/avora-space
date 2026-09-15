import { ensureJournalConversation, sendMessage } from "@/lib/chat";
import type { DailyThoughtView } from "@/lib/daily-thoughts";

/** Long enough for a real reflection, short of an essay — the composer's own ceiling. */
export const THOUGHT_NOTE_MAX_LEN = 4000;

/**
 * What the journal receives when someone answers the day's thought.
 *
 * The line being answered is quoted above the answer, because a reflection read back a month
 * later has to carry what it was reflecting ON. The speaker comes along when there is one;
 * the reference never does, exactly as on screen.
 */
export function thoughtNoteContent(thought: DailyThoughtView, note: string): string {
  const quoted = thought.speaker === null ? `“${thought.text}”` : `“${thought.text}” — ${thought.speaker}`;
  return `${quoted}\n\n${note.trim()}`;
}

/**
 * Keeps a reflection on the day's thought, in the reader's own journal and nowhere else.
 *
 * The journal is the one thread nobody else can read, which is the only place a thought this
 * private belongs. An empty note is refused rather than sent: silence is a legitimate answer
 * to a thought, and it should leave no entry at all.
 *
 * Returns the journal's conversation id, so the caller can offer to open it.
 */
export async function saveThoughtNote(
  userId: string,
  thought: DailyThoughtView,
  note: string,
): Promise<string> {
  const trimmed = note.trim();
  if (trimmed === "") throw new Error("Chưa có gì để lưu.");
  if (trimmed.length > THOUGHT_NOTE_MAX_LEN)
    throw new Error(`Lời bình dài quá ${THOUGHT_NOTE_MAX_LEN} ký tự.`);
  const conversationId = await ensureJournalConversation();
  await sendMessage(conversationId, userId, thoughtNoteContent(thought, trimmed));
  return conversationId;
}
