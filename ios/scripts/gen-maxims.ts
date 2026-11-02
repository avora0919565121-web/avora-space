// Sinh ios/AVORAIOS/Data/Maxims.swift từ danh sách danh ngôn của web (một nguồn duy nhất).
// Chạy: bun ios/scripts/gen-maxims.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MAXIM_SECTIONS } from "../../web/src/lib/daily-thought-maxims";

const esc = (s: string) => JSON.stringify(s); // JSON string literal is a valid Swift literal for these lines
const out = resolve(import.meta.dir, "../AVORAIOS/Data/Maxims.swift");
mkdirSync(dirname(out), { recursive: true });

let body = "// TỰ SINH bởi ios/scripts/gen-maxims.ts từ web/src/lib/daily-thought-maxims.ts — đừng sửa tay.\n\n";
body += "enum Maxims {\n    nonisolated static let sections: [(theme: String, lines: [String])] = [\n";
for (const s of MAXIM_SECTIONS) {
  body += `        (${esc(s.theme)}, [\n`;
  for (const l of s.lines) body += `            ${esc(l)},\n`;
  body += "        ]),\n";
}
body += "    ]\n}\n";
writeFileSync(out, body);
console.log("wrote", out, MAXIM_SECTIONS.reduce((n, s) => n + s.lines.length, 0), "lines");
