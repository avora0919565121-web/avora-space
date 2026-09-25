import { isDeletedFor, TASK_DESCRIPTION_MAX_LEN, type TaskItem } from "@/lib/tasks";
import type { ContextMessage, TaskContextSnapshot } from "@/lib/task-context";

/**
 * Turning something copied from outside AVORA into a personal task.
 *
 * The person pastes; AVORA sorts what arrived — words go into the task's description, files are
 * kept once as a Diary note — and fills nothing else in. Title, deadline and the rest stay empty
 * for the person to write. Nothing here creates a task on its own: the dialog only saves when
 * its owner presses the button.
 */

/** How much of the pasted text the task keeps as its record of origin. */
export const ORIGIN_CONTENT_MAX_LEN = 8000;

export type PastedContent = {
  text: string;
  files: File[];
};

export const EMPTY_PASTE: PastedContent = { text: "", files: [] };

export function isPasteEmpty(paste: PastedContent): boolean {
  return paste.text.trim() === "" && paste.files.length === 0;
}

/** Reads a paste event (or a drop). Plain text only: formatting from another app is noise here. */
export function pasteFromDataTransfer(data: Pick<DataTransfer, "getData" | "files">): PastedContent {
  return {
    text: data.getData("text/plain") ?? "",
    files: Array.from(data.files ?? []),
  };
}

/** A file pasted from the clipboard often has no name of its own. */
function clipboardFileName(type: string, index: number): string {
  const extension = type.split("/")[1]?.split("+")[0] ?? "bin";
  return `noi-dung-dan-${index + 1}.${extension}`;
}

/**
 * Reads the clipboard directly, for the button press that opens the dialog.
 *
 * Returns null when the browser will not hand it over (no permission, no API, an empty
 * clipboard) — the dialog then asks for an ordinary paste instead, which always works.
 */
export async function readClipboard(): Promise<PastedContent | null> {
  const clipboard: Clipboard | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard === undefined) return null;
  try {
    if (typeof clipboard.read === "function") {
      const items = await clipboard.read();
      let text = "";
      const files: File[] = [];
      for (const item of items) {
        const fileType = item.types.find((type) => type !== "text/plain" && type !== "text/html");
        if (fileType !== undefined) {
          const blob = await item.getType(fileType);
          files.push(new File([blob], clipboardFileName(fileType, files.length), { type: fileType }));
        } else if (item.types.includes("text/plain")) {
          text += await (await item.getType("text/plain")).text();
        }
      }
      const paste: PastedContent = { text, files };
      return isPasteEmpty(paste) ? null : paste;
    }
    if (typeof clipboard.readText === "function") {
      const text = await clipboard.readText();
      return text.trim() === "" ? null : { text, files: [] };
    }
  } catch (error) {
    // Permission refused or nothing readable — expected, and the paste box covers it.
    console.info(`[paste-intake] clipboard not readable: ${error instanceof Error ? error.name : "unknown"}`);
  }
  return null;
}

/**
 * What the description starts as: the pasted words, trimmed to what a description can hold.
 * The person edits it before saving; `isTrimmed` lets the dialog say that part was left out.
 */
export function descriptionFromPaste(text: string): { description: string; isTrimmed: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= TASK_DESCRIPTION_MAX_LEN) return { description: trimmed, isTrimmed: false };
  return { description: trimmed.slice(0, TASK_DESCRIPTION_MAX_LEN), isTrimmed: true };
}

/**
 * The context a pasted task carries.
 *
 * It points at the journal (a personal task may not have a conversation of its own) and, when
 * files were pasted, at the one Diary note that holds them — that is how "Xem trong ngữ cảnh"
 * opens the files later. The pasted words and file names are copied in as they were.
 */
export function buildPasteSnapshot(input: {
  journalId: string;
  journalName: string;
  text: string;
  fileNames: readonly string[];
  /** The Diary note holding the files; null when only words were pasted. */
  fileNote: ContextMessage | null;
  description: string;
  now?: Date;
}): TaskContextSnapshot {
  const now = input.now ?? new Date();
  return {
    conversationType: "personal",
    conversationId: input.journalId,
    conversationName: input.journalName,
    originalMessageId: input.fileNote?.id ?? null,
    originalMessageText: input.fileNote?.content ?? "",
    originalMessageSenderId: input.fileNote?.senderId ?? null,
    originalMessageSenderName: input.fileNote === null ? "" : "Bạn",
    originalMessageCreatedAt: input.fileNote?.createdAt ?? null,
    userResponse: input.description,
    snapshotCreatedAt: now.toISOString(),
    origin: {
      type: "external_paste",
      content: input.text.trim().slice(0, ORIGIN_CONTENT_MAX_LEN),
      fileNames: [...input.fileNames],
    },
  };
}

export function isPastedTask(task: TaskItem): boolean {
  return task.type === "personal" && task.contextSnapshot?.origin?.type === "external_paste";
}

/** Nguồn tạo việc: this person's pasted tasks, newest first, leaving out what they binned. */
export function pasteSourceTasks(tasks: readonly TaskItem[], userId: string | undefined): TaskItem[] {
  if (userId === undefined) return [];
  return tasks
    .filter((task) => task.creatorId === userId && isPastedTask(task) && !isDeletedFor(task, userId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
