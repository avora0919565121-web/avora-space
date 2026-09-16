import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the Supabase client in, and it refuses to
// construct without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { buildImportRows, canImportRow, IMPORT_COLUMNS } from "@/lib/contact-import";
import {
  applyColumnMapping,
  autoMapColumns,
  COLUMN_LABELS,
  COLUMN_SYNONYMS,
  fileColumns,
  headerSignature,
  MAPPING_ORDER,
  MAPPING_ORDER_BUSINESS,
  mappingStorageKey,
  missingRequired,
  sanitizeMapping,
  unusedColumns,
  type ColumnMapping,
} from "@/lib/contact-import-mapping";

const ME = "u-me";

describe("recognising somebody else's headings", () => {
  /**
   * The whole reason this layer exists: a file exported from anywhere else. None of these
   * headings is ours, and every one of them was previously refused at the door.
   */
  it("matches a file that uses none of the template's names", () => {
    const mapping = autoMapColumns(["Họ tên", "SĐT", "E-mail", "Ghi chú"]);

    expect(mapping.ten).toBe("Họ tên");
    expect(mapping.dien_thoai).toBe("SĐT");
    expect(mapping.email).toBe("E-mail");
    expect(mapping.ghi_chu).toBe("Ghi chú");
  });

  it("matches English headings from a foreign CRM", () => {
    const mapping = autoMapColumns(["Full Name", "Phone Number", "Email", "Date of Birth"]);

    expect(mapping.ten).toBe("Full Name");
    expect(mapping.dien_thoai).toBe("Phone Number");
    expect(mapping.email).toBe("Email");
    expect(mapping.ngay_sinh).toBe("Date of Birth");
  });

  /**
   * Accents, case and punctuation are normalised rather than listed, so the dictionary does not
   * need an entry per spelling of the same word.
   */
  it("reads a heading however it was punctuated or accented", () => {
    for (const heading of ["SĐT", "sdt", "S.Đ.T", "  Sđt  ", "S-Đ-T"]) {
      expect(autoMapColumns([heading]).dien_thoai, heading).toBe(heading.trim());
    }
  });

  it("still recognises our own template", () => {
    const mapping = autoMapColumns([...IMPORT_COLUMNS]);

    for (const column of IMPORT_COLUMNS) expect(mapping[column], column).toBe(column);
  });

  /**
   * A guess is made only on a word we know. Scoring near-misses would pre-fill a plausible
   * wrong answer on a screen most people click straight through, and put phone numbers in the
   * note field of two thousand contacts.
   */
  it("leaves a heading nobody can interpret alone", () => {
    const mapping = autoMapColumns(["Trường 1", "Cột B", "xyz"]);

    expect(mapping).toEqual({});
  });

  it("does not stretch a vague heading into a field", () => {
    // "Liên hệ" could be the phone or the email; guessing either would be inventing.
    expect(autoMapColumns(["Liên hệ"]).dien_thoai).toBeUndefined();
    expect(autoMapColumns(["Liên hệ"]).email).toBeUndefined();
  });

  /** One column cannot fill two fields, or "Email" would become both email and email 2. */
  it("gives each of the file's columns to at most one field", () => {
    const mapping = autoMapColumns(["Tên", "Email"]);
    const used = Object.values(mapping);

    expect(new Set(used).size).toBe(used.length);
    expect(mapping.email).toBe("Email");
    expect(mapping.email_2).toBeUndefined();
  });

  it("matches a second phone and email as their own fields", () => {
    const mapping = autoMapColumns(["Họ tên", "Phone", "Phone 2", "Email", "Email 2"]);

    expect(mapping.dien_thoai).toBe("Phone");
    expect(mapping.dien_thoai_2).toBe("Phone 2");
    expect(mapping.email).toBe("Email");
    expect(mapping.email_2).toBe("Email 2");
  });

  it("matches the company paperwork a business export carries", () => {
    const mapping = autoMapColumns([
      "Tên",
      "Mã số thuế",
      "Người đại diện",
      "Representative Phone",
      "Địa chỉ",
      "Lĩnh vực",
    ]);

    expect(mapping.ma_so_thue).toBe("Mã số thuế");
    expect(mapping.nguoi_dai_dien).toBe("Người đại diện");
    expect(mapping.dien_thoai_dai_dien).toBe("Representative Phone");
    expect(mapping.dia_chi).toBe("Địa chỉ");
    expect(mapping.nganh_nghe).toBe("Lĩnh vực");
  });

  /** Every field has a name on screen and a way to be recognised — no silent gaps. */
  it("can name and look for every field the importer writes", () => {
    for (const column of IMPORT_COLUMNS) {
      expect(COLUMN_LABELS[column], column).toBeTruthy();
      expect(COLUMN_SYNONYMS[column].length, column).toBeGreaterThan(0);
    }
    expect([...MAPPING_ORDER, ...MAPPING_ORDER_BUSINESS].sort()).toEqual([...IMPORT_COLUMNS].sort());
  });
});

describe("the file's own columns", () => {
  it("lists the headings as written, blanks dropped", () => {
    expect(fileColumns(["Họ tên", "", "  ", "SĐT"])).toEqual(["Họ tên", "SĐT"]);
  });

  /** Only the first of a repeated heading is offered, because that is the one read from. */
  it("offers a repeated heading once", () => {
    expect(fileColumns(["Email", "email", "EMAIL"])).toEqual(["Email"]);
  });

  it("names the columns nothing is being read from", () => {
    const mapping: ColumnMapping = { ten: "Họ tên" };

    expect(unusedColumns(["Họ tên", "Điểm tín dụng", "Mã NV"], mapping)).toEqual([
      "Điểm tín dụng",
      "Mã NV",
    ]);
  });
});

describe("what has to be answered", () => {
  it("asks for a name and nothing else", () => {
    expect(missingRequired({})).toEqual(["ten"]);
    expect(missingRequired({ ten: "Họ tên" })).toEqual([]);
  });

  /**
   * The point of raising it here: without a name column every single row would fail validation
   * one by one at the preview, for a reason that belongs to the file as a whole.
   */
  it("catches the missing name before the file is read row by row", () => {
    const table = [
      ["Điện thoại", "Email"],
      ["0912345678", "a@example.com"],
    ];
    const mapping = autoMapColumns(table[0]);

    expect(missingRequired(mapping)).toEqual(["ten"]);
  });
});

describe("rewriting the file under our headings", () => {
  const table = [
    ["Họ tên", "SĐT", "Ghi chú"],
    ["Chị Hoa", "0912345678", "khách quen"],
    ["Anh Bình", "0987000111", ""],
  ];

  it("hands the shared pipeline a table it cannot tell from the template", () => {
    const mapped = applyColumnMapping(table, autoMapColumns(table[0]), "individual");

    expect(mapped[0]).toEqual([...IMPORT_COLUMNS]);

    const result = buildImportRows(mapped);
    if (result.kind !== "rows") throw new Error(result.reason);
    expect(result.rows.map((row) => row.name)).toEqual(["Chị Hoa", "Anh Bình"]);
    expect(result.rows.every((row) => canImportRow(row))).toBe(true);
    expect(result.rows[0].fields.dien_thoai).toBe("0912345678");
    expect(result.rows[0].fields.ghi_chu).toBe("khách quen");
  });

  /** A file of people says nowhere that they are people; the one answer covers the file. */
  it("fills the type column for a file that has none", () => {
    const mapped = applyColumnMapping(table, autoMapColumns(table[0]), "individual");

    expect(mapped[1][IMPORT_COLUMNS.indexOf("loai")]).toBe("ca_nhan");

    const asCompanies = applyColumnMapping(table, autoMapColumns(table[0]), "business");
    expect(asCompanies[1][IMPORT_COLUMNS.indexOf("loai")]).toBe("doanh_nghiep");
  });

  /**
   * A file that does have a type column keeps its own values, blanks included: a row whose
   * type was left empty is a row somebody has to look at, not one for us to decide.
   */
  it("never overrides a type the file states itself", () => {
    const stated = [
      ["Tên", "Loại", "Phone"],
      ["Chị Hoa", "ca_nhan", "0912345678"],
      ["Ai đó", "", "0987000111"],
    ];
    const mapped = applyColumnMapping(stated, autoMapColumns(stated[0]), "business");
    const at = IMPORT_COLUMNS.indexOf("loai");

    expect(mapped[1][at]).toBe("ca_nhan");
    expect(mapped[2][at]).toBe("");
  });

  it("reads the column a person chose by hand", () => {
    const odd = [
      ["Cột A", "Cột B"],
      ["Chị Hoa", "0912345678"],
    ];
    // Nothing was recognised, so both answers are somebody's.
    expect(autoMapColumns(odd[0])).toEqual({});

    const mapped = applyColumnMapping(odd, { ten: "Cột A", dien_thoai: "Cột B" }, "individual");
    const result = buildImportRows(mapped);
    if (result.kind !== "rows") throw new Error(result.reason);

    expect(result.rows[0].name).toBe("Chị Hoa");
    expect(result.rows[0].fields.dien_thoai).toBe("0912345678");
  });

  it("leaves a field nobody mapped empty rather than shifting the columns along", () => {
    const mapped = applyColumnMapping(table, { ten: "Họ tên" }, "individual");

    expect(mapped[1][IMPORT_COLUMNS.indexOf("ten")]).toBe("Chị Hoa");
    expect(mapped[1][IMPORT_COLUMNS.indexOf("email")]).toBe("");
    expect(mapped[1][IMPORT_COLUMNS.indexOf("ghi_chu")]).toBe("");
  });

  it("copes with rows shorter than the header", () => {
    const ragged = [["Họ tên", "SĐT", "Email"], ["Chị Hoa", "0912345678"], ["Anh Bình"]];
    const mapped = applyColumnMapping(ragged, autoMapColumns(ragged[0]), "individual");

    expect(mapped[1][IMPORT_COLUMNS.indexOf("email")]).toBe("");
    expect(mapped[2][IMPORT_COLUMNS.indexOf("dien_thoai")]).toBe("");
  });

  /** Held by heading name, so next month's export with reordered columns still works. */
  it("follows a heading that has moved to another position", () => {
    const moved = [
      ["Ghi chú", "SĐT", "Họ tên"],
      ["khách quen", "0912345678", "Chị Hoa"],
    ];
    const mapped = applyColumnMapping(
      moved,
      { ten: "Họ tên", dien_thoai: "SĐT", ghi_chu: "Ghi chú" },
      "individual",
    );

    expect(mapped[1][IMPORT_COLUMNS.indexOf("ten")]).toBe("Chị Hoa");
    expect(mapped[1][IMPORT_COLUMNS.indexOf("dien_thoai")]).toBe("0912345678");
  });

  it("returns a header-only table for a file with no rows", () => {
    expect(applyColumnMapping([["Họ tên"]], { ten: "Họ tên" }, "individual")).toEqual([
      [...IMPORT_COLUMNS],
    ]);
  });
});

/**
 * Identifying a layout.
 *
 * Reading and writing the remembered choice needs real storage and lives in the browser suite;
 * what can be checked here is the part that decides whether two files are the same layout.
 */
describe("identifying a layout", () => {
  const header = ["Họ tên", "SĐT", "Ghi chú"];

  /** The same report exported with its columns shuffled is the same report. */
  it("gives the same signature whatever order the headings come in", () => {
    expect(headerSignature(header)).toBe(headerSignature(["SĐT", "Ghi chú", "Họ tên"]));
  });

  it("gives a different signature to a different file", () => {
    expect(headerSignature(header)).not.toBe(headerSignature(["Name", "Phone"]));
    expect(headerSignature(header)).not.toBe(headerSignature(["Họ tên", "SĐT"]));
  });

  it("ignores punctuation in the headings, as the matching does", () => {
    expect(headerSignature(["Họ tên", "S.Đ.T"])).toBe(headerSignature(["họ_tên", "sđt"]));
  });

  /** Two people sharing a laptop do not share a CRM export. */
  it("keys storage by account as well as layout", () => {
    const signature = headerSignature(header);

    expect(mappingStorageKey(ME, signature)).toContain(ME);
    expect(mappingStorageKey(ME, signature)).not.toBe(mappingStorageKey("u-other", signature));
  });

  /**
   * A remembered mapping is believed only as far as this file allows: last month's export may
   * have lost a column, and a mapping pointing at a heading that is gone would silently read
   * the wrong cells.
   */
  it("drops a remembered column the file no longer has", () => {
    expect(sanitizeMapping({ ten: "Họ tên", dien_thoai: "SĐT" }, ["Họ tên"])).toEqual({
      ten: "Họ tên",
    });
  });

  /** Stored under the old spelling, shown under this file's: the same column either way. */
  it("re-spells a remembered heading the way this file writes it", () => {
    expect(sanitizeMapping({ dien_thoai: "SĐT" }, ["S.Đ.T"])).toEqual({ dien_thoai: "S.Đ.T" });
  });
});
