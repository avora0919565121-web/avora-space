import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LongDialogBody, LongDialogFooter, LongDialogHeader, longDialogContentClass } from "@/components/ui/long-dialog";
import { TimeField } from "@/components/tasks/TimeField";
import { Switch } from "@/components/ui/switch";
import {
  ALL_WEEKDAYS,
  CUSTOM_DRAFT,
  HABIT_KIND_LABEL,
  HABIT_NAME_MAX,
  HABIT_SUGGESTIONS,
  MAX_WINDOWS,
  WEEKDAY_SHORT,
  WHEN_AWAY_LABEL,
  draftOf,
  validateDraft,
  type Habit,
  type HabitDraft,
  type HabitKind,
} from "@/lib/habits";
import { createHabit, updateHabit } from "@/lib/use-habits";
import { cn } from "@/lib/utils";

/** Enter never sends (ADR rule): it only leaves the field alone. */
function holdEnter(event: React.KeyboardEvent<HTMLInputElement>): void {
  if (event.key === "Enter") event.preventDefault();
}

function nextWindowTime(windows: readonly { time: string }[]): string {
  const last = windows[windows.length - 1]?.time ?? "07:00";
  const [h, m] = last.split(":").map(Number);
  const next = Math.min(23, (h ?? 7) + 3);
  return `${String(next).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

/**
 * `Tạo thói quen` / `Sửa thói quen` (đặc tả mục 3): a neutral suggestion or one's own name, the
 * kind, the days, at least one time window (each with its own reminder), and the reminder switch.
 * Give it a fresh `key` each time it opens: the form starts from its props.
 */
export function HabitEditor({ open, onOpenChange, habit, initial, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; habit?: Habit | null; initial?: HabitDraft; onSaved?: (id: string) => void }) {
  const isEdit = habit !== undefined && habit !== null;
  const [draft, setDraft] = useState<HabitDraft>(() => (isEdit ? draftOf(habit) : (initial ?? { ...CUSTOM_DRAFT, windows: CUSTOM_DRAFT.windows.map((window) => ({ ...window })) })));
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);


  const patch = (next: Partial<HabitDraft>): void => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };

  const pick = (id: string): void => {
    setPicked(id);
    if (id === "custom") {
      patch({ ...CUSTOM_DRAFT, windows: CUSTOM_DRAFT.windows.map((window) => ({ ...window })), weekdays: [...ALL_WEEKDAYS] });
      return;
    }
    const suggestion = HABIT_SUGGESTIONS.find((item) => item.id === id);
    if (suggestion !== undefined) patch({ ...suggestion.draft, windows: suggestion.draft.windows.map((window) => ({ ...window })), weekdays: [...suggestion.draft.weekdays] });
  };

  const setKind = (kind: HabitKind): void => patch({ kind, targetMinutes: kind === "timed" ? (draft.targetMinutes ?? 15) : null });

  const toggleDay = (day: number): void => {
    patch({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((item) => item !== day) : [...draft.weekdays, day].sort((a, b) => a - b) });
  };

  const save = (): void => {
    const problem = validateDraft(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (isEdit) {
      updateHabit(habit.id, draft);
      toast.success("Đã lưu thói quen.");
      onSaved?.(habit.id);
    } else {
      const id = createHabit(draft);
      toast.success(`Đã tạo “${draft.name.trim()}”.`);
      onSaved?.(id);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(longDialogContentClass, "max-w-[520px]")} data-habit-editor="">
        <LongDialogHeader>
          <DialogTitle className="text-[18px]">{isEdit ? "Sửa thói quen" : "Tạo thói quen"}</DialogTitle>
          <DialogDescription className="text-[13px]">Chọn một giờ cụ thể — nghĩ trước lúc làm giúp bắt đầu dễ hơn.</DialogDescription>
        </LongDialogHeader>
        <LongDialogBody className="space-y-5">
          {!isEdit ? (
            <section aria-label="Gợi ý">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Gợi ý</h3>
              <div className="flex flex-wrap gap-1.5">
                {HABIT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    aria-pressed={picked === suggestion.id}
                    onClick={() => pick(suggestion.id)}
                    className={cn(
                      "press h-10 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors",
                      picked === suggestion.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-secondary",
                    )}
                  >
                    {suggestion.draft.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={picked === "custom"}
                  onClick={() => pick("custom")}
                  className={cn(
                    "press h-10 rounded-full border border-dashed px-3.5 text-[13.5px] font-medium transition-colors",
                    picked === "custom" ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-secondary",
                  )}
                >
                  Thói quen của tôi
                </button>
              </div>
              {picked !== null && picked !== "custom" ? (
                <p className="mt-1.5 text-[12px] text-muted-foreground">{HABIT_SUGGESTIONS.find((item) => item.id === picked)?.hint}</p>
              ) : null}
            </section>
          ) : null}

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-foreground">Tên</span>
            <input
              value={draft.name}
              maxLength={HABIT_NAME_MAX}
              onChange={(event) => patch({ name: event.target.value })}
              onKeyDown={holdEnter}
              placeholder="Ví dụ: Đi bộ sau bữa tối"
              enterKeyHint="done"
              className="h-12 w-full rounded-[10px] border border-border bg-card px-3 text-[16px] text-foreground outline-none md:text-[15px] focus:border-foreground/40"
            />
          </label>

          <section aria-label="Loại">
            <span className="mb-1.5 block text-[13px] font-semibold text-foreground">Loại</span>
            <div role="radiogroup" aria-label="Loại thói quen" className="grid grid-cols-2 gap-1 rounded-[12px] bg-secondary p-1">
              {(["timed", "check"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === kind}
                  onClick={() => setKind(kind)}
                  className={cn("press h-11 rounded-[9px] text-[14px] font-medium transition-colors", draft.kind === kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                >
                  {HABIT_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {draft.kind === "timed" ? "Có đồng hồ đếm ngược khi bắt đầu." : "Quan trọng là đúng khung giờ và đã làm hay chưa."}
            </p>
            {draft.kind === "timed" ? (
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  aria-label="Số phút"
                  value={draft.targetMinutes ?? ""}
                  onChange={(event) => patch({ targetMinutes: event.target.value === "" ? null : Math.round(Number(event.target.value)) })}
                  onKeyDown={holdEnter}
                  className="h-11 w-24 rounded-[10px] border border-border bg-card px-3 text-[16px] tabular text-foreground outline-none md:text-[15px] focus:border-foreground/40"
                />
                <span className="text-[14px] text-muted-foreground">phút</span>
              </label>
            ) : null}
            {draft.kind === "timed" ? (
              <div className="mt-3" data-habit-when-away="">
                <span id="habit-when-away" className="mb-1.5 block text-[13px] font-semibold text-foreground">Khi rời Avora</span>
                <div role="radiogroup" aria-labelledby="habit-when-away" className="grid grid-cols-2 gap-1 rounded-[12px] bg-secondary p-1">
                  {(["keep", "stop"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={draft.whenAway === value}
                      data-when-away={value}
                      onClick={() => patch({ whenAway: value })}
                      className={cn("press h-11 rounded-[9px] text-[14px] font-medium transition-colors", draft.whenAway === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                    >
                      {WHEN_AWAY_LABEL[value]}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  {draft.whenAway === "keep"
                    ? "Khoá màn hình, mở app khác hay đóng Avora, đồng hồ vẫn chạy. Quay lại, bạn chọn ghi Đã làm hay bỏ phiên."
                    : "Rời màn đồng hồ, khoá màn hình hay chuyển app là đồng hồ dừng."}
                </p>
              </div>
            ) : null}
          </section>

          <section aria-label="Ngày trong tuần">
            <span className="mb-1.5 block text-[13px] font-semibold text-foreground">Ngày trong tuần</span>
            <div className="grid grid-cols-7 gap-1">
              {ALL_WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={draft.weekdays.includes(day)}
                  aria-label={day === 7 ? "Chủ nhật" : `Thứ ${day + 1}`}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "press h-11 rounded-[10px] border text-[13px] font-semibold transition-colors",
                    draft.weekdays.includes(day) ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              ))}
            </div>
          </section>

          <section aria-label="Khung giờ">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground">Khung giờ trong ngày</span>
              <span className="text-[12px] text-muted-foreground">Chuông = nhắc khung này</span>
            </div>
            <ul className="space-y-1.5">
              {draft.windows.map((window, index) => (
                <li key={index} data-habit-window-row={index} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1" data-habit-time="">
                    <TimeField
                      id={`habit-window-${index}`}
                      ariaLabel={`Khung giờ ${index + 1}`}
                      value={window.time}
                      onChange={(next) => patch({ windows: draft.windows.map((item, at) => (at === index ? { ...item, time: next } : item)) })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={window.remind}
                    aria-label={window.remind ? `Đang nhắc lúc ${window.time}` : `Không nhắc lúc ${window.time}`}
                    onClick={() => patch({ windows: draft.windows.map((item, at) => (at === index ? { ...item, remind: !item.remind } : item)) })}
                    className={cn("press flex h-11 w-11 items-center justify-center rounded-[10px] border", window.remind ? "border-border bg-card text-foreground" : "border-dashed border-border text-muted-foreground")}
                  >
                    {window.remind ? <Bell className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> : <BellOff className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Bỏ khung ${window.time}`}
                    disabled={draft.windows.length <= 1}
                    onClick={() => patch({ windows: draft.windows.filter((_, at) => at !== index) })}
                    className="press flex h-11 w-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-secondary disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {draft.windows.length < MAX_WINDOWS ? (
              <button
                type="button"
                onClick={() => patch({ windows: [...draft.windows, { time: nextWindowTime(draft.windows), remind: true }] })}
                className="press mt-2 flex h-11 items-center gap-1.5 rounded-[10px] px-2 text-[14px] font-medium text-foreground hover:bg-secondary"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Thêm khung giờ
              </button>
            ) : null}
          </section>

          <label className="flex min-h-11 items-center justify-between gap-3">
            <span>
              <span className="block text-[14px] font-semibold text-foreground">Nhắc</span>
              <span className="block text-[12px] text-muted-foreground">Im lặng khi bạn đang tập trung, tắt thông báo hay vào ngày nghỉ.</span>
            </span>
            <Switch checked={draft.remindersOn} onCheckedChange={(checked) => patch({ remindersOn: checked })} aria-label="Nhắc thói quen" />
          </label>

          {error !== null ? <p role="alert" className="text-[13px] font-medium text-foreground">{error}</p> : null}
        </LongDialogBody>
        <LongDialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} className="press h-11 rounded-[10px] px-4 text-[14px] font-medium text-muted-foreground hover:bg-secondary">
            Huỷ
          </button>
          <button type="button" onClick={save} className="press h-11 rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground">
            {isEdit ? "Lưu" : "Tạo thói quen"}
          </button>
        </LongDialogFooter>
      </DialogContent>
    </Dialog>
  );
}
