import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CARD_ROW_ORDER,
  cardDay,
  footerLine,
  monthWeeks,
  quickDays,
  reminderOffset,
  repeatLine,
  saveLabel,
  whenLine,
} from "@/lib/task-card";
import { RECURRENCE_LABELS, TASK_RECURRENCES } from "@/lib/task-schedule";

/** AVORA-104 · PHẦN 2 (ADR-075) — one task card, statically and in its pure rules. */
const SRC = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FILES = walk(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, "utf8") }));

describe("2.3 · one TaskCard renders every task form", () => {
  it("the four old forms are gone", () => {
    for (const name of ["TaskComposer", "TaskDetailSheet", "TaskEditComposer", "EditSuggestionDialog"]) {
      expect(existsSync(path.join(SRC, "components/tasks", `${name}.tsx`))).toBe(false);
      expect(FILES.filter((entry) => new RegExp(`\\b${name}\\b`).test(entry.text)).map((entry) => entry.file)).toEqual([]);
    }
  });

  it("only TaskCard draws a task's name field and its Ngày diễn ra", () => {
    const owners = FILES.filter((entry) => /aria-label="Tên việc"|placeholder="Việc cần làm là gì\?"/.test(entry.text)).map((entry) => entry.file);
    expect(owners).toEqual(["components/tasks/TaskCard.tsx"]);
  });

  it("every place that creates a task opens TaskCard", () => {
    const creators = FILES.filter((entry) => /onCreateMine=\{/.test(entry.text));
    expect(creators.length).toBeGreaterThanOrEqual(8);
    for (const entry of creators) expect(entry.text, entry.file).toMatch(/<TaskCard\b/);
  });

  it("Các bước live in the card, not in TaskPrepPanel any more", () => {
    const prep = FILES.find((entry) => entry.file === "components/tasks/TaskPrepPanel.tsx")?.text ?? "";
    expect(prep).not.toMatch(/ChecklistBlock|useChecklist\b/);
  });
});

describe("2.2 · rows and words", () => {
  it("ten rows in the VMT order", () => {
    expect(CARD_ROW_ORDER).toEqual(["title", "steps", "my-day", "reminder", "when", "repeat", "presence", "assign", "files", "note"]);
  });

  it("Lặp lại offers Ngày làm việc", () => {
    expect(TASK_RECURRENCES).toContain("weekdays");
    expect(RECURRENCE_LABELS.weekdays).toBe("Ngày làm việc");
    expect(repeatLine("weekdays", null)).toBe("Ngày làm việc");
    expect(repeatLine("custom", { interval: 2, frequency: "weekly" })).toBe("Mỗi 2 tuần");
    expect(repeatLine("none", null)).toBeNull();
  });

  it("days and times read the same in every row", () => {
    expect(cardDay("2026-10-09")).toBe("T6, 09/10");
    expect(whenLine("2026-10-09", "10:00", "11:00")).toBe("T6, 09/10 · 10:00–11:00");
    expect(whenLine("2026-10-09", "", "")).toBe("T6, 09/10");
    expect(quickDays("2026-10-09").map((entry) => entry.day)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12"]);
  });

  it("a month is Monday-first weeks", () => {
    const weeks = monthWeeks(2026, 9);
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("footer, save corner, reminder distance", () => {
    expect(footerLine("2026-10-08T03:00:00Z", "bạn", "từ Hạng mục")).toBe("Tạo 08/10 bởi bạn · từ Hạng mục");
    expect(saveLabel("saving")).toBe("Đang lưu…");
    expect(saveLabel("saved")).toBe("Đã lưu ✓");
    expect(saveLabel("error")).toBe("Chưa lưu được");
    expect(reminderOffset("2026-10-09T01:30:00Z", "2026-10-09T03:00:00Z")).toBe(90);
    expect(reminderOffset("2026-10-09T04:00:00Z", "2026-10-09T03:00:00Z")).toBeNull();
  });
});
