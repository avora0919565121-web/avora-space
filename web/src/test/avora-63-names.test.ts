import { describe, expect, it } from "vitest";

import {
  countIssues,
  decodeContactFile,
  decodeQuotedPrintableIn,
  findNameIssues,
  repairCp1258,
  repairMojibake,
  suspectSyllables,
  tidyNameSuggestion,
  type NameRepairInput,
} from "@/lib/contact-name-repair";

// Windows-1258 keeps the base letters and writes tones as combining bytes.
const CP1258: Record<string, number> = { "ê": 0xea, "â": 0xe2, "ô": 0xf4, "ă": 0xe3, "ơ": 0xf5, "ư": 0xfd, "đ": 0xf0, "Đ": 0xd0, "\u0300": 0xcc, "\u0301": 0xec, "\u0303": 0xde, "\u0309": 0xd2, "\u0323": 0xf2 };

function cp1258(text: string): Uint8Array {
  // Compose the vowel bases first (ê, â, ô, ă, ơ, ư), keep tones as combining marks.
  const parts = text.normalize("NFD").replace(/e\u0302/g, "ê").replace(/a\u0302/g, "â").replace(/o\u0302/g, "ô").replace(/a\u0306/g, "ă").replace(/o\u031b/g, "ơ").replace(/u\u031b/g, "ư").replace(/d\u0335/g, "đ");
  const bytes: number[] = [];
  for (const character of parts) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (CP1258[character] !== undefined) bytes.push(CP1258[character]);
    else throw new Error(`no byte for ${character} (${code.toString(16)})`);
  }
  return Uint8Array.from(bytes);
}

const contact = (id: string, name: string, extra: Partial<NameRepairInput> = {}): NameRepairInput => ({ id, name, phone: null, linkedUserId: null, ...extra });

describe("63.1 · files are read in the encoding they were written in", () => {
  it("a Windows-1258 vCard with Vietnamese names", () => {
    const bytes = cp1258("BEGIN:VCARD\r\nVERSION:2.1\r\nFN:Nguyễn Văn Hùng\r\nEND:VCARD\r\n");
    const { text, encoding } = decodeContactFile(bytes);
    expect(encoding).toBe("windows-1258");
    expect(text).toContain("Nguyễn Văn Hùng");
  });

  it("a Windows-1252 CSV (Excel) with the letters 1252 can hold", () => {
    // Excel on a Western Windows saves "Lê Thị Hà" with what 1252 has: ê and à as single bytes.
    const text = "Ten,So\r\nLê Thi Hà,0901234567\r\nPhan Thanh Tâm,0912\r\n";
    const bytes = Uint8Array.from([...text].map((character) => character.codePointAt(0) ?? 0));
    const decoded = decodeContactFile(bytes);
    expect(decoded.text).toContain("Lê Thi Hà");
    expect(decoded.text).toContain("Phan Thanh Tâm");
    expect(decoded.encoding).not.toBe("utf-8");
  });

  it("UTF-8 stays UTF-8, with or without a BOM", () => {
    const utf8 = new TextEncoder().encode("Nguyễn Thị Ánh");
    expect(decodeContactFile(utf8)).toEqual({ text: "Nguyễn Thị Ánh", encoding: "utf-8" });
    expect(decodeContactFile(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8])).text).toBe("Nguyễn Thị Ánh");
  });

  it("quoted-printable honours the line's CHARSET", () => {
    expect(decodeQuotedPrintableIn("Nguy=E1=BB=85n", "UTF-8")).toBe("Nguyễn");
    expect(decodeQuotedPrintableIn("L=EA", "windows-1252")).toBe("Lê");
  });
});

describe("63.2 · broken characters come back", () => {
  it("NguyÃªn VÄƒn A → Nguyên Văn A, ticked", () => {
    expect(repairMojibake("NguyÃªn VÄƒn A")).toBe("Nguyên Văn A");
    const [issue] = findNameIssues([contact("1", "NguyÃªn VÄƒn A")], () => null);
    expect(issue).toMatchObject({ kind: "broken", suggestion: "Nguyên Văn A", preselected: true });
  });

  it("a Windows-1258 name read as 1252 comes back too (Trýòc → Trước, ÐoaÌn → Đoàn)", () => {
    expect(repairCp1258("Trýõìc")).toBe("Trước");
    expect(repairCp1258("ÐoaÌn")).toBe("Đoàn");
    const [issue] = findNameIssues([contact("1", "Phýõòng")], () => null);
    expect(issue).toMatchObject({ kind: "broken", suggestion: "Phượng", preselected: true });
  });

  it("half a repair (letters already lost to ?) is not offered", () => {
    const [issue] = findNameIssues([contact("1", "Ð? Th? Bích")], () => null);
    expect(issue).toMatchObject({ kind: "broken", suggestion: null, preselected: false });
  });

  it("a real ý / ì / ò is never taken for a broken file", () => {
    expect(findNameIssues([contact("1", "Lê Thuý Ngân"), contact("2", "Hồ Thị Thuỳ"), contact("3", "Lò Văn Hòa")], () => null)).toEqual([]);
  });

  it("a name already turned into ? is listed for a hand fix, not guessed", () => {
    const [issue] = findNameIssues([contact("1", "Nguy?n V?n A")], () => null);
    expect(issue).toMatchObject({ kind: "broken", suggestion: null, preselected: false });
  });
});

describe("63.3 · case and spaces", () => {
  it("all lower / all upper get a capital per word; a deliberate mix is left alone", () => {
    expect(tidyNameSuggestion("nguyễn văn a")).toBe("Nguyễn Văn A");
    expect(tidyNameSuggestion("NGUYỄN VĂN A")).toBe("Nguyễn Văn A");
    expect(tidyNameSuggestion("iPhone Shop")).toBeNull();
    expect(tidyNameSuggestion("McDonald")).toBeNull();
    expect(tidyNameSuggestion("ABC Corp")).toBeNull();
  });

  it("keeps brackets and initials as written, and squeezes spaces", () => {
    expect(tidyNameSuggestion("(Em Hieu)  Hung")).toBe("(Em Hieu) Hung");
    expect(tidyNameSuggestion("A. Bac")).toBeNull();
    expect(tidyNameSuggestion("  Trần   Bình ")).toBe("Trần Bình");
  });

  it("is ticked in the list", () => {
    const [issue] = findNameIssues([contact("1", "NGUYỄN VĂN A")], () => null);
    expect(issue).toMatchObject({ kind: "case", suggestion: "Nguyễn Văn A", preselected: true });
  });
});

describe("63.4 · possible typos are only flagged", () => {
  it("Nguyênx Thiện goes to Có thể gõ sai with no suggestion", () => {
    expect(suspectSyllables("Nguyênx Thiện")).toEqual(["Nguyênx"]);
    const [issue] = findNameIssues([contact("1", "Nguyênx Thiện")], () => null);
    expect(issue).toMatchObject({ kind: "typo", suggestion: null, preselected: false });
  });

  it("two tone marks in one syllable, and silly repeats, are caught; real names are not", () => {
    expect(suspectSyllables("Hùng Phạm")).toEqual([]);
    expect(suspectSyllables("Nguyễn Thị Ngọc Ánh")).toEqual([]);
    expect(suspectSyllables("Trầnn Bìnhhh")).toEqual(["Trầnn", "Bìnhhh"]);
    expect(suspectSyllables("Nguyễ́n")).toEqual(["Nguyễ́n"]);
    expect(suspectSyllables("John Smith")).toEqual([]);
    // Acronyms and brands are not typos.
    expect(suspectSyllables("Anh Lộc | NMA Lighting")).toEqual([]);
    expect(suspectSyllables("Chị Hà BĐS GĐ")).toEqual([]);
  });
});

describe("63.5 · missing accents only from a trustworthy source", () => {
  it("linked to an AVORA friend → that display name", () => {
    const [issue] = findNameIssues([contact("1", "Hung", { linkedUserId: "u1" })], (id) => (id === "u1" ? "Phạm Văn Hùng" : null));
    expect(issue).toMatchObject({ kind: "accents", suggestion: "Phạm Văn Hùng", source: "avora", preselected: false });
  });

  it("not linked to anyone → listed, no guess between Hùng and Hưng", () => {
    const [issue] = findNameIssues([contact("1", "Hung")], () => null);
    expect(issue).toMatchObject({ kind: "accents", suggestion: null });
  });

  it("the same number saved elsewhere with accents → that name", () => {
    const issues = findNameIssues(
      [contact("1", "Tran Binh", { phone: "+84901" }), contact("2", "Trần Bình", { phone: "+84901" })],
      () => null,
    );
    expect(issues).toEqual([expect.objectContaining({ contactId: "1", kind: "accents", suggestion: "Trần Bình", source: "phone" })]);
  });
});

describe("the groups", () => {
  it("each name lands in at most one group, and clean names in none", () => {
    const issues = findNameIssues(
      [contact("1", "NguyÃªn A"), contact("2", "le van b"), contact("3", "Nguyênx"), contact("4", "Hung"), contact("5", "Phạm Văn Hùng")],
      () => null,
    );
    expect(countIssues(issues)).toEqual({ broken: 1, case: 1, typo: 1, accents: 1 });
  });
});
