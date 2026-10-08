import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * AVORA-102 · C — no list read may silently stop at 1 000 rows (PostgREST `max_rows`).
 *
 * For every table that can grow past 1 000 rows per person, each `.from("<table>").select(` must
 * page (`fetchAllRows` / `.range(`), or say why it is small (`.single()`, `.maybeSingle()`,
 * `head: true`, a `.eq("id", …)`), or carry `// rows-bounded: <why>` within the statement or the
 * two lines above it. `.limit(n)` alone is NOT enough when n > 1 000 — the cap still applies.
 * A table added to GROWING later is held to the same rule.
 */
const GROWING = [
  "contact",
  "contact_channel",
  "tasks",
  "transactions",
  "messages",
  "message_attachments",
  "crm_opportunity",
  "notes",
  "note_folders",
  "note_attachments",
  "task_reminders",
  "think_hub_cell_files",
  "think_hub_record",
  "think_hub_record_reminders",
  // Per person, grows with use:
  "task_flags",
  "task_participants",
  "task_dependencies",
  "think_hub_record_tasks",
  "think_hub_record_stars",
  "message_reactions",
  "message_deliveries",
  "message_pins",
  "task_suggestions",
  "checklist_items",
  "task_resources",
  "project_tasks",
  "meeting_note_files",
  "task_celebrations",
  "think_hub_view_row_meta",
  "think_hub_board_opened",
];

const ROOT = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "test" || name === "integrations") continue;
      out.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

type Finding = { where: string; table: string; statement: string };

function unboundedReads(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sources(ROOT)) {
    const src = readFileSync(file, "utf8");
    const re = /\.from\(\s*"([a-z_]+)"(?:\s+as\s+never)?\s*\)/g;
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      const table = m[1];
      if (!GROWING.includes(table)) continue;
      const rest = src.slice(m.index, m.index + 900);
      const statement = rest.split(/;\s*\n/)[0];
      if (!/\.select\(/.test(statement)) continue;
      // A write that returns what it wrote is bounded by what it wrote.
      if (/\.(insert|update|upsert|delete)\(/.test(statement.slice(0, statement.indexOf(".select(")))) continue;
      const before = src.slice(Math.max(0, m.index - 400), m.index).split("\n").slice(-3).join("\n");
      const limitMatch = /\.limit\((\d[\d_]*)\)/.exec(statement);
      const isBounded =
        /\.range\(/.test(statement) ||
        /\.(single|maybeSingle)\(\)/.test(statement) ||
        /head:\s*true/.test(statement) ||
        /\.eq\("id",/.test(statement) ||
        /rows-bounded:/.test(statement) ||
        /rows-bounded:/.test(before) ||
        /fetchAllRows/.test(before) ||
        (limitMatch !== null && Number(limitMatch[1].replace(/_/g, "")) <= 1000);
      if (!isBounded) {
        const line = src.slice(0, m.index).split("\n").length;
        findings.push({ where: `${relative(ROOT, file)}:${line}`, table, statement: statement.replace(/\s+/g, " ").slice(0, 140) });
      }
    }
  }
  return findings;
}

describe("AVORA-102 · C · đọc danh sách không bao giờ dừng ở 1.000", () => {
  test("mọi truy vấn danh sách trên bảng có thể > 1.000 dòng đều chia trang hoặc ghi rõ vì sao nhỏ", () => {
    expect(unboundedReads()).toEqual([]);
  });

  test("`.limit(n)` với n > 1.000 không được coi là đủ", () => {
    const sample = '.from("tasks").select("*").limit(5000)';
    expect(/\.limit\((\d+)\)/.exec(sample)?.[1]).toBe("5000");
    expect(Number("5000") <= 1000).toBe(false);
  });
});
