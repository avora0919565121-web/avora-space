import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** Where a new standalone table can live: the Diary, or one 1-1 / group conversation. */
export type TablePlace = {
  /** Null = personal (Diary). */
  conversationId: string | null;
  label: string;
};

type NewTableDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; purpose: string; conversationId: string | null }) => Promise<void>;
  isWorking: boolean;
  /** The places offered; the first is the default unless `initialConversationId` names another. */
  places: readonly TablePlace[];
  initialConversationId?: string | null;
};

const PERSONAL_VALUE = "__personal__";

/**
 * Names a new standalone table, says where it lives, and optionally what it is for.
 *
 * A project's root table is never made here — it comes with the project. Sub-tables grow from a
 * Hạng mục. Purpose is free text and may stay blank: a table can exist before its reason is clear.
 */
export function NewTableDialog({
  open,
  onOpenChange,
  onCreate,
  isWorking,
  places,
  initialConversationId = null,
}: NewTableDialogProps) {
  const [name, setName] = useState<string>("");
  const [purpose, setPurpose] = useState<string>("");
  const [place, setPlace] = useState<string>(PERSONAL_VALUE);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPurpose("");
    setNotice(null);
    const wanted = initialConversationId ?? null;
    setPlace(
      wanted !== null && places.some((entry) => entry.conversationId === wanted) ? wanted : PERSONAL_VALUE,
    );
  }, [open, initialConversationId, places]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setNotice("Bảng cần một cái tên.");
        return;
      }
      setNotice(null);
      try {
        await onCreate({ name: trimmed, purpose, conversationId: place === PERSONAL_VALUE ? null : place });
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
    },
    [name, purpose, place, onCreate, onOpenChange],
  );

  const fieldClass =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";
  const shared = place !== PERSONAL_VALUE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Bảng mới</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Đặt tên theo đúng thứ bạn đang theo dõi — "Công trình", "Nhà cung cấp", "Đơn hàng".
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="think-table-name" className="text-[13px] font-medium text-muted-foreground">
              Tên bảng
            </label>
            <input
              id="think-table-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={80}
              placeholder="Nhà cung cấp"
              className={fieldClass}
            />
          </div>

          {places.length > 1 ? (
            <div>
              <label htmlFor="think-table-place" className="text-[13px] font-medium text-muted-foreground">
                Ở đâu
              </label>
              <select
                id="think-table-place"
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                className={fieldClass}
              >
                {places.map((entry) => (
                  <option key={entry.conversationId ?? PERSONAL_VALUE} value={entry.conversationId ?? PERSONAL_VALUE}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {shared ? "Mọi người trong cuộc trò chuyện này sẽ đọc được bảng." : "Chỉ mình bạn thấy bảng này."}
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="think-table-purpose" className="text-[13px] font-medium text-muted-foreground">
              Mục đích <span className="font-normal">(không bắt buộc)</span>
            </label>
            <input
              id="think-table-purpose"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              maxLength={2000}
              placeholder="Bảng này giúp bạn nghĩ về điều gì?"
              className={fieldClass}
            />
          </div>

          {notice !== null ? (
            <p role="alert" className="text-[13.5px] text-destructive">
              {notice}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Để sau
            </Button>
            <Button type="submit" disabled={isWorking}>
              {isWorking ? "Đang tạo…" : "Tạo bảng"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
