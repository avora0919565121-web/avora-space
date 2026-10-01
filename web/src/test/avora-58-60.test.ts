import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { Connection } from "@/lib/connections";
import type { Contact } from "@/lib/contacts";
import { GUIDE_CARDS } from "@/lib/guide-content";
import { GUIDANCE_KEYS, GUIDANCE_TEXT } from "@/lib/guidance";
import { personCardView } from "@/lib/person-card";
import { TASK_HUB_SECTIONS } from "@/lib/task-hub";
import { taskOwnership } from "@/lib/task-owner";
import type { TaskItem } from "@/lib/tasks";

const names: Record<string, string> = { me: "Thiện", lan: "Lan", minh: "Minh" };
const nameOf = (id: string | null): string => (id === null ? "Người dùng AVORA" : (names[id] ?? "Người dùng AVORA"));

function task(part: Partial<TaskItem>): TaskItem {
  return {
    id: "t",
    type: "group-shared",
    creatorId: "me",
    assigneeId: null,
    status: "confirmed",
    conversationId: "c1",
    ...part,
  } as TaskItem;
}

describe("AVORA-58", () => {
  it("58.1: the guide uses the names on screen", () => {
    const plan = GUIDE_CARDS.find((card) => card.id === "plan");
    const settings = GUIDE_CARDS.find((card) => card.id === "settings");
    expect(plan?.lines).toContain("Cùng dữ liệu xem được dạng Bảng, Theo trạng thái hoặc Cây.");
    expect(settings?.lines[0]).toMatch(/Đăng xuất mọi thiết bị khác khi lỡ đăng nhập ở máy lạ\.$/);
    expect(GUIDE_CARDS.flatMap((card) => card.lines).join(" ")).not.toMatch(/Kanban|Sơ đồ/);
  });
});

describe("AVORA-59 · B — whose task", () => {
  it("my own task", () => {
    expect(taskOwnership(task({ type: "personal" }), "me", nameOf)).toEqual({ line: "Của tôi", isMine: true });
  });
  it("given to me", () => {
    expect(taskOwnership(task({ creatorId: "lan", assigneeId: "me" }), "me", nameOf)).toEqual({ line: "Của tôi · từ Lan", isMine: true });
  });
  it("59.2: I gave it, not accepted yet / accepted", () => {
    expect(taskOwnership(task({ assigneeId: "lan", status: "pending_confirmation" }), "me", nameOf)).toEqual({ line: "Giao Lan · chờ nhận", isMine: false });
    expect(taskOwnership(task({ assigneeId: "lan", status: "confirmed" }), "me", nameOf).line).toBe("Giao Lan");
  });
  it("a group task between two others", () => {
    expect(taskOwnership(task({ creatorId: "lan", assigneeId: "minh" }), "me", nameOf)).toEqual({ line: "Lan → Minh", isMine: false });
  });
  it("an old 1-1 row with no assignee recorded resolves the peer", () => {
    const old = task({ type: "1-1-shared", creatorId: "me", assigneeId: null, status: "pending_confirmation" });
    expect(taskOwnership(old, "me", nameOf, () => "lan").line).toBe("Giao Lan · chờ nhận");
    const mine = task({ type: "1-1-shared", creatorId: "lan", assigneeId: null });
    expect(taskOwnership(mine, "me", nameOf).line).toBe("Của tôi · từ Lan");
  });
  it("59.4: never an email, never 'Người khác'", () => {
    const line = taskOwnership(task({ creatorId: "x@y.com", assigneeId: "me" }), "me", nameOf).line;
    expect(line).toBe("Của tôi · từ Người dùng AVORA");
    expect(line).not.toMatch(/@|Người khác/);
  });
});

describe("AVORA-59 · A — Lịch acts in place", () => {
  it("the calendar line invites acting there", () => {
    expect(TASK_HUB_SECTIONS.find((section) => section.id === "calendar")?.description).toBe("Chạm một việc để xem và làm luôn.");
  });
});

describe("AVORA-60 · C — person card", () => {
  const connections = new Map<string, Connection>([["lan", { userId: "lan", displayName: "Lan", pin: "A-LAN12345", createdAt: "" }]]);
  const contact = (part: Partial<Contact>): Contact => ({ id: "k1", name: "Lan Nguyễn", phone: "+84901234567", linkedUserId: "lan", ...part }) as Contact;

  it("60.5: someone not in my Liên hệ shows no phone (so no Gọi)", () => {
    const view = personCardView({ userId: "minh", name: "Minh" }, "me", connections, [contact({})]);
    expect(view.phone).toBeNull();
    expect(view.contactId).toBeNull();
    expect(view.isFriend).toBe(false);
  });
  it("the phone comes only from my own contact linked to that person", () => {
    const view = personCardView({ userId: "lan" }, "me", connections, [contact({})]);
    expect(view.phone).toBe("+84901234567");
    expect(view.pin).toBe("A-LAN12345");
    expect(view.isFriend).toBe(true);
  });
  it("a name that looks like an email is never shown", () => {
    const view = personCardView({ userId: "zz", name: "zz@mail.com" }, "me", new Map(), []);
    expect(view.name).toBe("Người dùng AVORA");
  });
  it("my own card", () => {
    const view = personCardView({ userId: "me", name: "Thiện" }, "me", connections, [contact({ linkedUserId: "me" })], "A-ME000001");
    expect(view.isSelf).toBe(true);
    expect(view.pin).toBe("A-ME000001");
    expect(view.phone).toBeNull();
  });
});

describe("AVORA-60 · D — one `+`", () => {
  it("the hold hint for Nhiệm vụ exists", () => {
    expect(GUIDANCE_KEYS).toContain("task_plus_hold");
    expect(GUIDANCE_TEXT.task_plus_hold).toBe("Giữ nút + để chọn loại.");
  });
});

/**
 * 60.2: a field smaller than 16px makes iPhone zoom in on focus and stay zoomed. Every
 * input / textarea / select in the app either says ≥16px on a phone or only shrinks from `md:` up.
 */
describe("AVORA-60 · A — no field below 16px on a phone", () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "test") walk(full);
      } else if (full.endsWith(".tsx")) files.push(full);
    }
  };
  walk(root);

  const SMALL = /(?<![\w:\-[])text-(\[(\d+(?:\.\d+)?)px\]|xs|sm)(?![\w\-\]])/g;
  const tagEnd = (source: string, from: number): number => {
    let depth = 0;
    for (let index = from; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0 && source[index - 1] !== "=") return index;
    }
    return source.length;
  };

  it("60.2: every text field is ≥16px below md", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<(input|textarea|select|Input|Textarea)\b/g)) {
        const start = match.index ?? 0;
        const chunk = source.slice(start, tagEnd(source, start + match[0].length));
        if (match[1] === "input" && /type="(checkbox|radio|range|file|hidden|color)"/.test(chunk)) continue;
        for (const small of chunk.matchAll(SMALL)) {
          const px = small[2] !== undefined ? Number.parseFloat(small[2]) : 0;
          if (small[2] !== undefined && px >= 16) continue;
          const line = source.slice(0, start).split("\n").length;
          offenders.push(`${path.relative(root, file)}:${line} ${small[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("60.2: shared field classes (`const FIELD = …` used on a field) are ≥16px below md too", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/const\s+(\w+)\s*(?::\s*string)?\s*=\s*\n?\s*"([^"]*)"/g)) {
        const [, name, cls] = match;
        const usedOnField =
          new RegExp(`<(input|textarea|select|Input|Textarea)\\b[^>]*?\\b${name}\\b`, "s").test(source);
        if (!usedOnField) continue;
        for (const small of cls.matchAll(SMALL)) {
          if (small[2] !== undefined && Number.parseFloat(small[2]) >= 16) continue;
          offenders.push(`${path.relative(root, file)} ${name} ${small[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the viewport never auto-zooms and resizes with the keyboard", () => {
    const html = readFileSync(path.resolve(root, "../index.html"), "utf8");
    expect(html).toMatch(/maximum-scale=1/);
    expect(html).toMatch(/interactive-widget=resizes-content/);
  });

  it("no full-screen height uses 100vh / h-screen", () => {
    const offenders = files.filter((file) => /\b(h-screen|min-h-screen)\b|100vh/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
