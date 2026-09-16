import { vi } from "vitest";

// Pure-logic tests; importing the module pulls the Supabase client in, and it refuses to
// construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  buildImportRows,
  buildInviteCandidates,
  buildTemplateCsv,
  canImportRow,
  defaultChoice,
  findDuplicate,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  mapHeaderRow,
  mergeIntoBusiness,
  mergeIntoIndividual,
  normalizeEmail,
  normalizeHeader,
  normalizePhone,
  parseDelimitedText,
  rowToBusinessDraft,
  rowToIndividualDraft,
  SAMPLE_MARKER,
  summarizeRows,
  toIsoDate,
  type ImportRow,
} from "@/lib/contact-import";
import type { Contact } from "@/lib/contacts";

const ME = "u-me";

function person(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    ownerUserId: ME,
    contactType: "individual",
    phone: null,
    email: null,
    note: null,
    linkedUserId: null,
    employerContactId: null,
    dateOfBirth: null,
    relationshipTag: null,
    taxCode: null,
    businessAddress: null,
    representativeName: null,
    representativePhone: null,
    representativeEmail: null,
    industry: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function company(overrides: Partial<Contact> & { id: string; name: string }): Contact {
  return person({ ...overrides, contactType: "business", taxCode: overrides.taxCode ?? "0301234567" });
}

/** A file as text, header first, the way a spreadsheet exports it. */
function csv(...lines: string[]): string[][] {
  return parseDelimitedText(lines.join("\r\n"));
}

const HEADER = IMPORT_COLUMNS.join(",");

/** One valid person line, with only the named cells filled in. */
function line(cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>): string {
  return IMPORT_COLUMNS.map((column) => cells[column] ?? "").join(",");
}

function rowsOf(table: string[][], contacts: readonly Contact[] = []): ImportRow[] {
  const result = buildImportRows(table, contacts);
  if (result.kind === "refused") throw new Error(`refused: ${result.reason}`);
  return result.rows;
}

describe("the template a person fills in", () => {
  it("carries every column the importer reads, in order", () => {
    const table = parseDelimitedText(buildTemplateCsv());
    expect(table[0]).toEqual([...IMPORT_COLUMNS]);
  });

  /** Excel on a Vietnamese machine reads a bare UTF-8 file as Latin-1 without this. */
  it("starts with a byte order mark so Excel opens Vietnamese names correctly", () => {
    expect(buildTemplateCsv().startsWith("\uFEFF")).toBe(true);
    expect(buildTemplateCsv()).toContain("Nguyễn Văn An");
  });

  it("shows one person and one company as worked examples", () => {
    const rows = rowsOf(parseDelimitedText(buildTemplateCsv()));
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe("individual");
    expect(rows[1].kind).toBe("business");
  });

  /**
   * The warning lives in the rows themselves, not in a banner above the header: a note before
   * the header line would make the template unreadable by its own importer.
   */
  it("marks the examples as rows to delete, and refuses to import them", () => {
    const rows = rowsOf(parseDelimitedText(buildTemplateCsv()));
    expect(buildTemplateCsv()).toContain(SAMPLE_MARKER);
    expect(rows.every((row) => row.isSample)).toBe(true);
    expect(rows.every((row) => !canImportRow(row))).toBe(true);
  });

  it("says which rows are examples so the screen can point at them", () => {
    const counts = summarizeRows(rowsOf(parseDelimitedText(buildTemplateCsv())));
    expect(counts.sample).toBe(2);
    expect(counts.valid).toBe(0);
  });
});

describe("reading a delimited file", () => {
  it("keeps a comma that is inside quotes out of the cell split", () => {
    const table = parseDelimitedText('a,b\r\n"Hà Nội, Việt Nam",2');
    expect(table[1]).toEqual(["Hà Nội, Việt Nam", "2"]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(parseDelimitedText('a\r\n"nói ""xin chào"""')[1]).toEqual(['nói "xin chào"']);
  });

  /** Excel on a Vietnamese Windows writes CSV with semicolons, not commas. */
  it("works out the delimiter from the header instead of assuming a comma", () => {
    const table = parseDelimitedText("loai;ten;dien_thoai\r\nca_nhan;Anh;0912345678");
    expect(table[1]).toEqual(["ca_nhan", "Anh", "0912345678"]);
  });

  it("ignores blank lines left at the end of a file", () => {
    expect(parseDelimitedText("a,b\r\n1,2\r\n\r\n\r\n")).toHaveLength(2);
  });

  it("reads a file with Unix line endings the same as one from Excel", () => {
    expect(parseDelimitedText("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("matching up the columns", () => {
  it("accepts headings written with accents and capitals", () => {
    expect(normalizeHeader("  Điện Thoại ")).toBe("dien_thoai");
    expect(normalizeHeader("Mã số thuế")).toBe("ma_so_thue");
    expect(normalizeHeader("NGÀY_SINH")).toBe("ngay_sinh");
  });

  it("finds the columns wherever they sit in the file", () => {
    const positions = mapHeaderRow(["ten", "khong_biet", "loai"]);
    expect(positions.ten).toBe(0);
    expect(positions.loai).toBe(2);
  });

  it("reads the cells by heading, not by position", () => {
    const rows = rowsOf(csv("ten,loai,email", "Chị Hoa,ca_nhan,hoa@example.com"));
    expect(rows[0].name).toBe("Chị Hoa");
    expect(rows[0].fields.email).toBe("hoa@example.com");
  });

  it("refuses a file that is missing the two columns everything depends on", () => {
    const result = buildImportRows(csv("ho_ten,so_dien_thoai", "Anh,0912345678"), []);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toContain("thiếu cột loai hoặc ten");
  });

  it("refuses an empty file rather than showing an empty table", () => {
    expect(buildImportRows([], []).kind).toBe("refused");
  });
});

describe("what makes a row importable", () => {
  it("needs a type, and says so when the column is blank", () => {
    const rows = rowsOf(csv(HEADER, line({ ten: "Anh", dien_thoai: "0912345678" })));
    expect(rows[0].kind).toBeNull();
    expect(rows[0].problems[0]).toContain("Thiếu cột loai");
    expect(canImportRow(rows[0])).toBe(false);
  });

  it("rejects a type it does not recognise, quoting what was written", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "cong_ty", ten: "Anh", dien_thoai: "0912345678" })));
    expect(rows[0].kind).toBeNull();
    expect(rows[0].problems[0]).toContain('"cong_ty"');
    expect(canImportRow(rows[0])).toBe(false);
  });

  it("accepts a type written with accents, the way a person types it", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "Cá nhân", ten: "Anh", dien_thoai: "0912345678" })));
    expect(rows[0].kind).toBe("individual");
  });

  it("requires a name whatever the type", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "ca_nhan", dien_thoai: "0912345678" })));
    expect(rows[0].problems).toContain("Thiếu tên.");
  });

  it("requires a person to have a phone or an email", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "ca_nhan", ten: "Anh" })));
    expect(rows[0].problems).toContain("Cá nhân cần ít nhất số điện thoại hoặc email.");
    expect(canImportRow(rows[0])).toBe(false);
  });

  it("accepts a person with only an email", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "ca_nhan", ten: "Anh", email: "a@example.com" })));
    expect(canImportRow(rows[0])).toBe(true);
  });

  it("requires a company's tax code and representative", () => {
    const rows = rowsOf(
      csv(HEADER, line({ loai: "doanh_nghiep", ten: "Công ty A", dien_thoai: "02838220011" })),
    );
    expect(rows[0].problems).toContain("Doanh nghiệp cần mã số thuế.");
    expect(rows[0].problems).toContain("Doanh nghiệp cần người đại diện.");
  });

  /** A company may be reachable through its representative rather than its own line. */
  it("accepts a company reachable only through its representative", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({
          loai: "doanh_nghiep",
          ten: "Công ty A",
          ma_so_thue: "0301234567",
          nguoi_dai_dien: "Chị Bích",
          email_dai_dien: "bich@example.com",
        }),
      ),
    );
    expect(canImportRow(rows[0])).toBe(true);
  });

  it("refuses a company with no channel at all", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({
          loai: "doanh_nghiep",
          ten: "Công ty A",
          ma_so_thue: "0301234567",
          nguoi_dai_dien: "Chị Bích",
        }),
      ),
    );
    expect(rows[0].problems).toContain("Doanh nghiệp cần ít nhất một số điện thoại hoặc email.");
  });

  /**
   * Collected rather than reported one at a time: someone who has to reopen the spreadsheet
   * should be able to fix the whole row in one pass.
   */
  it("lists everything wrong with a row at once", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "doanh_nghiep" })));
    expect(rows[0].problems.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a broken row in the table so nothing disappears silently", () => {
    const rows = rowsOf(
      csv(HEADER, line({ loai: "ca_nhan", ten: "Tốt", email: "t@example.com" }), line({ ten: "Xấu" })),
    );
    expect(rows).toHaveLength(2);
    expect(summarizeRows(rows)).toMatchObject({ valid: 1, invalid: 1 });
  });

  it("numbers the rows the way the spreadsheet does, header included", () => {
    const rows = rowsOf(
      csv(HEADER, line({ loai: "ca_nhan", ten: "A", email: "a@e.com" }), line({ loai: "ca_nhan", ten: "B", email: "b@e.com" })),
    );
    expect(rows.map((row) => row.lineNumber)).toEqual([2, 3]);
  });
});

describe("a birthday that came out of a spreadsheet", () => {
  it("reads both the ISO form and the day-first form Vietnamese files use", () => {
    expect(toIsoDate("1990-03-15")).toBe("1990-03-15");
    expect(toIsoDate("15/03/1990")).toBe("1990-03-15");
    expect(toIsoDate("5.3.1990")).toBe("1990-03-05");
  });

  it("refuses a date that does not exist", () => {
    expect(toIsoDate("31/02/1990")).toBeNull();
    expect(toIsoDate("hôm qua")).toBeNull();
  });

  /** Dropping it quietly would import a row that looks complete with its one date missing. */
  it("makes the row an error rather than quietly dropping an unreadable date", () => {
    const rows = rowsOf(
      csv(HEADER, line({ loai: "ca_nhan", ten: "A", email: "a@e.com", ngay_sinh: "hôm qua" })),
    );
    expect(rows[0].problems[0]).toContain("Ngày sinh không đọc được");
    expect(canImportRow(rows[0])).toBe(false);
  });

  it("leaves a blank birthday alone", () => {
    const rows = rowsOf(csv(HEADER, line({ loai: "ca_nhan", ten: "A", email: "a@e.com" })));
    expect(canImportRow(rows[0])).toBe(true);
    expect(rowToIndividualDraft(rows[0]).dateOfBirth).toBe("");
  });
});

describe("spotting someone already in the book", () => {
  it("treats the international and local forms of a number as the same phone", () => {
    expect(normalizePhone("+84 912 345 678")).toBe(normalizePhone("0912345678"));
    expect(normalizePhone("091-234-5678")).toBe("0912345678");
  });

  it("compares emails without regard to capitals", () => {
    expect(normalizeEmail("  Hoa@Example.COM ")).toBe("hoa@example.com");
  });

  it("matches on a phone written differently in the file", () => {
    const match = findDuplicate(
      { ...blankFields(), dien_thoai: "+84 912 345 678" },
      "individual",
      [person({ id: "c1", name: "Chị Hoa", phone: "0912345678" })],
    );
    expect(match).toMatchObject({ contactId: "c1", on: "phone", canMerge: true });
  });

  it("matches on email when the phone is new", () => {
    const match = findDuplicate(
      { ...blankFields(), dien_thoai: "0999999999", email: "HOA@example.com" },
      "individual",
      [person({ id: "c1", name: "Chị Hoa", email: "hoa@example.com" })],
    );
    expect(match).toMatchObject({ contactId: "c1", on: "email" });
  });

  it("finds nobody when neither channel is known", () => {
    expect(
      findDuplicate({ ...blankFields(), dien_thoai: "0900000001" }, "individual", [
        person({ id: "c1", name: "Ai đó", phone: "0912345678" }),
      ]),
    ).toBeNull();
  });

  /** A blank cell is not a match — otherwise every contact with no email would collide. */
  it("does not match a blank cell against a contact with nothing written down", () => {
    expect(findDuplicate(blankFields(), "individual", [person({ id: "c1", name: "Trống" })])).toBeNull();
  });

  /** Pouring a person's details into a company row would produce nonsense. */
  it("refuses to offer a merge across the two kinds of contact", () => {
    const match = findDuplicate(
      { ...blankFields(), dien_thoai: "02838220011" },
      "business",
      [person({ id: "c1", name: "Chị Hoa", phone: "02838220011" })],
    );
    expect(match).toMatchObject({ canMerge: false });
  });

  it("defaults a matched row to being skipped, and an unmatched one to being created", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" }),
        line({ loai: "ca_nhan", ten: "Người Mới", dien_thoai: "0900000001" }),
      ),
      [person({ id: "c1", name: "Chị Hoa", phone: "0912345678" })],
    );
    expect(defaultChoice(rows[0])).toBe("skip");
    expect(defaultChoice(rows[1])).toBe("create");
  });

  it("counts the duplicates for the line above the table", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({ loai: "ca_nhan", ten: "Chị Hoa", dien_thoai: "0912345678" }),
        line({ loai: "ca_nhan", ten: "Người Mới", dien_thoai: "0900000001" }),
      ),
      [person({ id: "c1", name: "Chị Hoa", phone: "0912345678" })],
    );
    expect(summarizeRows(rows)).toMatchObject({ valid: 2, invalid: 0, duplicate: 1 });
  });
});

describe("the size a file is allowed to be", () => {
  it("accepts a file right at the limit", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS }, (_unused, index) =>
      line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
    );
    expect(buildImportRows(csv(HEADER, ...body), []).kind).toBe("rows");
  });

  it("refuses one row past it, and says how many it found", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_unused, index) =>
      line({ loai: "ca_nhan", ten: `Người ${index}`, email: `n${index}@example.com` }),
    );
    const result = buildImportRows(csv(HEADER, ...body), []);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toContain(String(MAX_IMPORT_ROWS + 1));
      expect(result.reason).toContain(String(MAX_IMPORT_ROWS));
    }
  });
});

describe("turning a row into something the server accepts", () => {
  it("sends a person's own columns and nothing else", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({
          loai: "ca_nhan",
          ten: " Chị Hoa ",
          dien_thoai: "0912345678",
          email: "hoa@example.com",
          ghi_chu: "Gặp ở hội chợ",
          ngay_sinh: "15/03/1990",
          moi_quan_he: "Đối tác",
        }),
      ),
    );
    expect(rowToIndividualDraft(rows[0])).toEqual({
      name: "Chị Hoa",
      phone: "0912345678",
      email: "hoa@example.com",
      dateOfBirth: "1990-03-15",
      relationshipTag: "Đối tác",
      note: "Gặp ở hội chợ",
      employerContactId: null,
    });
  });

  it("sends a company's tax code, representative and address", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({
          loai: "doanh_nghiep",
          ten: "Công ty An Phát",
          ma_so_thue: "0301234567",
          nguoi_dai_dien: "Chị Bích",
          dien_thoai: "02838220011",
          dia_chi: "12 Lê Lợi",
          nganh_nghe: "Bán lẻ",
        }),
      ),
    );
    expect(rowToBusinessDraft(rows[0])).toMatchObject({
      name: "Công ty An Phát",
      taxCode: "0301234567",
      representativeName: "Chị Bích",
      businessAddress: "12 Lê Lợi",
      industry: "Bán lẻ",
    });
  });

  /** The `loai` column is the person's own explicit statement of which kind this is. */
  it("files each row under the type its own column named", () => {
    const rows = rowsOf(
      csv(
        HEADER,
        line({ loai: "ca_nhan", ten: "Người", email: "n@example.com" }),
        line({
          loai: "doanh_nghiep",
          ten: "Công ty",
          ma_so_thue: "0301234567",
          nguoi_dai_dien: "Chị Bích",
          email: "c@example.com",
        }),
      ),
    );
    expect(rows.map((row) => row.kind)).toEqual(["individual", "business"]);
  });
});

describe("merging into someone already there", () => {
  const existing = person({
    id: "c1",
    name: "Chị Hoa",
    phone: "0912345678",
    note: "Ghi chú cũ",
  });

  function importedRow(cells: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>>): ImportRow {
    return rowsOf(csv(HEADER, line({ loai: "ca_nhan", ten: "Chị Hoa", ...cells })))[0];
  }

  it("fills in a field that was empty", () => {
    const draft = mergeIntoIndividual(existing, importedRow({ email: "hoa@example.com" }));
    expect(draft.email).toBe("hoa@example.com");
  });

  /**
   * `update_contact` replaces every column it is given, so the merge has to carry the existing
   * values through untouched — a patch of only the blank fields would blank out the rest.
   */
  it("never overwrites a field that already had something in it", () => {
    const draft = mergeIntoIndividual(
      existing,
      importedRow({ dien_thoai: "0999999999", ghi_chu: "Ghi chú mới" }),
    );
    expect(draft.phone).toBe("0912345678");
    expect(draft.note).toBe("Ghi chú cũ");
  });

  it("keeps the name and every other field the contact already had", () => {
    const draft = mergeIntoIndividual(
      person({ id: "c2", name: "Tên Cũ", phone: "0912345678", relationshipTag: "Bạn bè" }),
      importedRow({ email: "x@example.com", moi_quan_he: "Đối tác" }),
    );
    expect(draft.name).toBe("Tên Cũ");
    expect(draft.relationshipTag).toBe("Bạn bè");
  });

  it("fills a company's missing representative without touching its tax code", () => {
    const draft = mergeIntoBusiness(
      company({ id: "b1", name: "Công ty A", taxCode: "0301234567" }),
      rowsOf(
        csv(
          HEADER,
          line({
            loai: "doanh_nghiep",
            ten: "Công ty A",
            ma_so_thue: "9999999999",
            nguoi_dai_dien: "Chị Bích",
            email: "a@example.com",
          }),
        ),
      )[0],
    );
    expect(draft.taxCode).toBe("0301234567");
    expect(draft.representativeName).toBe("Chị Bích");
  });
});

describe("who gets offered an invitation afterwards", () => {
  it("offers the people just written down", () => {
    const candidates = buildInviteCandidates([
      person({ id: "c1", name: "Chị Hoa", phone: "0912345678" }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ contactId: "c1", method: "sms" });
  });

  /** A company does not sign in to AVORA, so it is never asked to. */
  it("leaves companies out entirely", () => {
    expect(buildInviteCandidates([company({ id: "b1", name: "Công ty A", phone: "02838220011" })])).toEqual(
      [],
    );
  });

  it("leaves out anyone already on AVORA", () => {
    expect(
      buildInviteCandidates([
        person({ id: "c1", name: "Đã dùng", phone: "0912345678", linkedUserId: "u-other" }),
      ]),
    ).toEqual([]);
  });

  /** Email carries a full sentence and a link, and costs the sender nothing. */
  it("prefers email when both channels exist", () => {
    const candidates = buildInviteCandidates([
      person({ id: "c1", name: "Cả hai", phone: "0912345678", email: "ca@example.com" }),
    ]);
    expect(candidates[0].method).toBe("email");
    expect(candidates[0].methods).toEqual(["email", "sms"]);
  });

  /**
   * The same rule `create_contact_invite` enforces: a channel with no address is not offered,
   * so a person can never pick one that is certain to be refused.
   */
  it("offers only the channel the contact actually has", () => {
    const [phoneOnly] = buildInviteCandidates([
      person({ id: "c1", name: "Chỉ số", phone: "0912345678" }),
    ]);
    expect(phoneOnly.methods).toEqual(["sms"]);

    const [emailOnly] = buildInviteCandidates([
      person({ id: "c2", name: "Chỉ email", email: "e@example.com" }),
    ]);
    expect(emailOnly.methods).toEqual(["email"]);
  });

  it("skips someone with no channel at all rather than offering a dead button", () => {
    expect(buildInviteCandidates([person({ id: "c1", name: "Trống" })])).toEqual([]);
  });
});

function blankFields(): Record<(typeof IMPORT_COLUMNS)[number], string> {
  const fields = {} as Record<(typeof IMPORT_COLUMNS)[number], string>;
  for (const column of IMPORT_COLUMNS) fields[column] = "";
  return fields;
}
