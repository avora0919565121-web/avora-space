import { useCallback, useMemo, useState, type ReactNode } from "react";

import { PasteTaskDialog } from "@/components/chat/PasteTaskDialog";
import { JOURNAL_TITLE, type ConversationSummary } from "@/lib/chat";
import { readClipboard, type PastedContent } from "@/lib/paste-intake";
import { useConversations } from "@/lib/use-conversations";

/** The Diary among the viewer's conversations — where pasted photos and files are kept. */
export function findJournal(conversations: readonly ConversationSummary[] | undefined): ConversationSummary | undefined {
  return conversations?.find((item) => item.kind === "personal");
}

/**
 * "Tạo việc từ nội dung copy", usable from anywhere (AVORA-35 / F).
 *
 * One source of truth for the paste flow that used to live inside Kết nối: the tab and the corner
 * bubble both call `start()`, which reads the clipboard in the same tap (browsers only hand it
 * over during a user gesture) and opens the same dialog. The Diary is found from the shared
 * conversations cache, so no Kết nối screen needs to be open.
 *
 * `dialog` must be rendered once by the caller; it is null until the Diary is known.
 */
export function usePasteTask(): {
  open: boolean;
  isReading: boolean;
  start: () => Promise<void>;
  dialog: ReactNode;
} {
  const { data: conversations } = useConversations();
  const journal = useMemo(() => findJournal(conversations), [conversations]);
  const [open, setOpen] = useState<boolean>(false);
  const [initialPaste, setInitialPaste] = useState<PastedContent | null>(null);
  const [isReading, setIsReading] = useState<boolean>(false);

  const start = useCallback(async (): Promise<void> => {
    setIsReading(true);
    try {
      // Unreadable (refused, empty, unsupported) comes back as null: the dialog opens anyway.
      setInitialPaste(await readClipboard());
    } finally {
      setIsReading(false);
      setOpen(true);
    }
  }, []);

  const dialog: ReactNode =
    journal === undefined ? null : (
      <PasteTaskDialog
        open={open}
        onOpenChange={setOpen}
        journalId={journal.conversationId}
        journalName={JOURNAL_TITLE}
        initialPaste={initialPaste}
      />
    );

  return { open, isReading, start, dialog };
}
