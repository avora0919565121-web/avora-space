import { isSharedTask, isTaskAssignee, type TaskItem } from "@/lib/tasks";

/**
 * Whose hands a task is in, from the reader's point of view — and nothing else.
 *
 * A list that mixes "I have to do this" with "someone else has to do this" reads as one
 * undifferentiated pile of obligation, which is exactly the feeling this product exists to
 * remove. So every row says, in its own weight, whether the next move is the reader's.
 *
 * This is deliberately NOT the same question as `taskTier`. The tier ranks how strong a claim
 * a task makes and is used for ordering; this one only asks who is carrying it, and is used
 * for nothing but how a row looks and how it is read aloud. Ordering, filtering and every
 * count stay exactly as they were.
 */
export type TaskVoice = "mine" | "theirs";

/**
 * `mine` — the reader's own to-do, or shared work they were asked to carry.
 * `theirs` — shared work somebody else is carrying: what the reader asked for, or what a
 * group task asked of another member.
 *
 * A task with no signed-in reader is `theirs`: claiming otherwise would put a stranger's
 * work in bold.
 */
export function taskVoice(task: TaskItem, userId: string | undefined): TaskVoice {
  if (userId === undefined) return "theirs";
  if (!isSharedTask(task)) return task.creatorId === userId ? "mine" : "theirs";
  return isTaskAssignee(task, userId) ? "mine" : "theirs";
}

/**
 * The words behind the weight.
 *
 * Bold-versus-light is a hint, never the fact. Screen readers and anyone who cannot tell two
 * type weights apart get the same distinction spelled out, which is why every row carrying a
 * voice also carries this sentence.
 */
export const TASK_VOICE_HINT: Record<TaskVoice, string> = {
  mine: "Việc bạn đang giữ",
  theirs: "Việc người khác đang giữ",
};

/**
 * How a title is set, by whose work it is.
 *
 * The reader's own work is ink at semibold — the weight the rest of AVORA reserves for what
 * matters now. Someone else's work is lighter, italic and warm grey: still perfectly legible,
 * still exactly where it was in the order, but visibly not the reader's move. Italic does the
 * work colour alone cannot, since muted grey is also what this product uses for finished and
 * for binned rows.
 *
 * Finished and binned rows keep their own treatment and ignore the voice: a closed task is
 * nobody's next move, so putting it in bold would be a lie about what is still owed.
 */
export const TASK_VOICE_TITLE_CLASS: Record<TaskVoice, string> = {
  mine: "font-semibold text-foreground",
  theirs: "font-normal italic text-muted-foreground",
};
