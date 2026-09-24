import { BookOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth";
import type { DailyThoughtView } from "@/lib/daily-thoughts";
import { saveThoughtNote, THOUGHT_NOTE_MAX_LEN } from "@/lib/thought-note";

/**
 * Answering the day's thought, in one's own words.
 *
 * Closed until asked for, and it stays closed: a thought that arrives with an open text box
 * beside it is homework, and this page is not here to set any. The link that opens it is a
 * single quiet line, so a reader who only wants to read the line sees nothing else.
 *
 * What is written goes to the journal — the one thread nobody else can read — and nowhere
 * near a task, a report or another person. No new screen, either: a reflection interrupted by
 * navigation is a reflection abandoned.
 */
export function ThoughtNote({
  thought,
  thoughtKey = null,
}: {
  thought: DailyThoughtView;
  /** Which day's thought this answers, so the journal line can remember it. */
  thoughtKey?: string | null;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [note, setNote] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const canSave = note.trim() !== "" && !isSaving;

  const save = async (): Promise<void> => {
    if (user === null || user === undefined) return;
    setIsSaving(true);
    try {
      const conversationId = await saveThoughtNote(user.id, thought, note, thoughtKey);
      // Cleared and closed on success: the page returns to being a page to read, and the
      // words now live where they were sent rather than in two places at once.
      setNote("");
      setIsOpen(false);
      toast.success("Đã lưu vào Nhật ký.", {
        action: { label: "Mở", onClick: () => navigate(`/tin-nhan/${conversationId}`) },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được. Bạn thử lại nhé.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="press mt-2 text-[12.5px] font-medium text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
      >
        Viết lời bình
      </button>
    );
  }

  return (
    <div className="rise-in mt-2.5">
      <label htmlFor="thought-note" className="mb-1 block text-[11px] font-medium text-muted-foreground">
        Lời bình của bạn — chỉ bạn đọc được
      </label>
      <textarea
        id="thought-note"
        value={note}
        autoFocus
        rows={3}
        maxLength={THOUGHT_NOTE_MAX_LEN}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Câu này khiến bạn nghĩ đến điều gì?"
        className="w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2 text-[14px] leading-6 text-foreground outline-none transition-colors placeholder:text-task-idle focus:border-muted-foreground"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="press flex h-11 items-center gap-2 rounded-[10px] bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <BookOpen className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          )}
          Lưu vào Nhật ký
        </button>
        <button
          type="button"
          onClick={() => {
            setNote("");
            setIsOpen(false);
          }}
          className="press h-11 rounded-[10px] px-3 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Để sau
        </button>
      </div>
    </div>
  );
}
