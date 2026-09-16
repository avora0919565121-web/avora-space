import { vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  decodeQuotedPrintable,
  joinQuotedPrintableLines,
  labelWords,
  parseVcards,
  splitVcardBlocks,
  unescapeVcardText,
} from "@/lib/contact-vcard";
import { extraChannelsOf, suggestedLabelOf } from "@/lib/contact-candidates";

/** One card, written the way an export actually writes it: CRLF between lines. */
function card(...lines: string[]): string {
  return ["BEGIN:VCARD", ...lines, "END:VCARD"].join("\r\n") + "\r\n";
}

describe("finding the cards in a file", () => {
  it("reads every card in one file, not just the first", () => {
    const file =
      card("VERSION:3.0", "FN:Một", "TEL:0912345678") +
      card("VERSION:3.0", "FN:Hai", "TEL:0987000111") +
      card("VERSION:3.0", "FN:Ba", "TEL:0900111222");

    expect(splitVcardBlocks(file)).toHaveLength(3);
    expect(parseVcards(file).candidates.map((entry) => entry.name)).toEqual([
      "Một",
      "Hai",
      "Ba",
    ]);
  });

  /** A transfer that truncates the file should cost the last person, not the whole import. */
  it("still reads the last card when END:VCARD is missing", () => {
    const file =
      card("VERSION:3.0", "FN:Đầy đủ", "TEL:0912345678") +
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bị cắt\r\nTEL:0987000111\r\n";

    expect(parseVcards(file).candidates.map((entry) => entry.name)).toEqual([
      "Đầy đủ",
      "Bị cắt",
    ]);
  });

  /** Line endings are a property of the file, never grounds to lose an address book. */
  it("reads a file saved with plain newlines", () => {
    const file = "BEGIN:VCARD\nVERSION:3.0\nFN:Chị Hoa\nTEL:0912345678\nEND:VCARD\n";
    const result = parseVcards(file);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].name).toBe("Chị Hoa");
    expect(result.candidates[0].phones).toEqual(["0912345678"]);
  });

  it("finds nothing in a file that is not a phone book", () => {
    const result = parseVcards("ten,dien_thoai\nHoa,0912345678\n");
    expect(result.total).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  /**
   * The whole reason cards are cut apart before parsing: the library refuses a file outright
   * when any card in it is malformed.
   */
  it("keeps the readable cards when one card in the middle is broken", () => {
    const file =
      card("VERSION:3.0", "FN:Trước", "TEL:0912345678") +
      "BEGIN:VCARD\r\nkhông phải thẻ\r\n" +
      card("VERSION:3.0", "FN:Sau", "TEL:0987000111");

    const result = parseVcards(file);
    expect(result.candidates.map((entry) => entry.name)).toEqual(["Trước", "Sau"]);
    expect(result.skipped).toBe(1);
  });

  /**
   * A card left unterminated must not eat the person written after it. The split therefore
   * stops at the next BEGIN as well as at END, so a truncated card costs only itself.
   */
  it("does not swallow the next card when one is missing its END", () => {
    const file =
      card("VERSION:3.0", "FN:Trước", "TEL:0912345678") +
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Thiếu đuôi\r\nTEL:0900000000\r\n" +
      card("VERSION:3.0", "FN:Sau", "TEL:0987000111");

    expect(parseVcards(file).candidates.map((entry) => entry.name)).toEqual([
      "Trước",
      "Thiếu đuôi",
      "Sau",
    ]);
  });

  /** A version we do not know is still a legible name and number. */
  it("reads a card whose VERSION is unfamiliar or missing", () => {
    const file =
      card("VERSION:9.9", "FN:Lạ đời", "TEL:0912345678") +
      card("FN:Không ghi bản", "TEL:0987000111");

    expect(parseVcards(file).candidates.map((entry) => entry.name)).toEqual([
      "Lạ đời",
      "Không ghi bản",
    ]);
  });
});

describe("reading one person out of a card", () => {
  /** The requirement that matters most: every number, not merely the first. */
  it("keeps every TEL and every EMAIL line", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "FN:Nguyễn Văn An",
        "TEL;type=CELL:0912345678",
        "TEL;type=HOME:02838220011",
        "TEL;type=WORK:0987000111",
        "EMAIL;type=WORK:an.work@example.com",
        "EMAIL;type=HOME:an.home@example.com",
      ),
    );

    expect(result.candidates[0].phones).toEqual(["0912345678", "02838220011", "0987000111"]);
    expect(result.candidates[0].emails).toEqual([
      "an.work@example.com",
      "an.home@example.com",
    ]);
  });

  it("unfolds a long line the way the format says to", () => {
    const file =
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Người Có Tên Rất Dài Bị Gấp Dòng Trong File Xuấ\r\n t Ra\r\nTEL:0912345678\r\nEND:VCARD\r\n";

    expect(parseVcards(file).candidates[0].name).toBe(
      "Người Có Tên Rất Dài Bị Gấp Dòng Trong File Xuất Ra",
    );
  });

  it("puts back the escapes the format requires", () => {
    expect(unescapeVcardText("Công ty A\\, TNHH")).toBe("Công ty A, TNHH");
    expect(unescapeVcardText("12 Lê Lợi\\; Quận 1")).toBe("12 Lê Lợi; Quận 1");
    expect(unescapeVcardText("dòng 1\\ndòng 2")).toBe("dòng 1\ndòng 2");

    const result = parseVcards(
      card("VERSION:3.0", "FN:Trần Văn B\\, Jr.", "TEL:0912345678"),
    );
    expect(result.candidates[0].name).toBe("Trần Văn B, Jr.");
  });

  it("falls back to the structured name when there is no display name", () => {
    const result = parseVcards(card("VERSION:3.0", "N:Nguyễn;An;;;", "TEL:0912345678"));
    expect(result.candidates[0].name).toBe("Nguyễn An");
  });

  it("ignores a line with nothing in it", () => {
    const result = parseVcards(
      card("VERSION:3.0", "FN:Hoa", "TEL:0912345678", "TEL:", "EMAIL:"),
    );
    expect(result.candidates[0].phones).toEqual(["0912345678"]);
    expect(result.candidates[0].emails).toEqual([]);
  });

  it("says a value came from a phone book file", () => {
    const result = parseVcards(card("VERSION:3.0", "FN:Hoa", "TEL:0912345678"));
    expect(result.candidates[0].source).toBe("import_vcf");
  });
});

describe("quoted-printable, which Android still exports", () => {
  it("decodes a Vietnamese name as bytes rather than characters", () => {
    expect(decodeQuotedPrintable("=C4=90=E1=BA=B7ng =C4=90=E1=BB=A9c B=C3=ACnh")).toBe(
      "Đặng Đức Bình",
    );
  });

  it("reads a whole card written that way", () => {
    const result = parseVcards(
      card(
        "VERSION:2.1",
        "N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C4=90=E1=BA=B7ng;=C4=90=E1=BB=A9c;;;",
        "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C4=90=E1=BA=B7ng =C4=90=E1=BB=A9c B=C3=ACnh",
        "TEL;CELL:0987654321",
      ),
    );

    expect(result.candidates[0].name).toBe("Đặng Đức Bình");
    expect(result.candidates[0].phones).toEqual(["0987654321"]);
  });

  /**
   * Android wraps these lines with a trailing "=" and no leading space, which is not the
   * folding the parser knows: unjoined, the name is truncated and its tail becomes a property.
   */
  it("joins a soft line break back together", () => {
    const result = parseVcards(
      card(
        "VERSION:2.1",
        "FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C4=90=E1=BA=B7ng =C4=90=E1=BB=A9c B=C3=AC=",
        "nh",
        "TEL;CELL:0987654321",
      ),
    );

    expect(result.candidates[0].name).toBe("Đặng Đức Bình");
  });

  /** A blanket join would eat the "=" that pads the end of a base64 photo. */
  it("leaves a base64 photo line alone", () => {
    const joined = joinQuotedPrintableLines(
      ["PHOTO;ENCODING=BASE64;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=", "TEL:0912345678"].join(
        "\r\n",
      ),
    );

    expect(joined.split("\r\n")).toHaveLength(2);
    expect(joined).toContain("TEL:0912345678");
  });

  it("keeps a photo out of the contact entirely", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "FN:Có ảnh",
        "TEL:0912345678",
        "PHOTO;ENCODING=BASE64;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=",
      ),
    );

    const entry = result.candidates[0];
    expect(entry.name).toBe("Có ảnh");
    expect(JSON.stringify(entry)).not.toContain("9j/4AAQ");
  });
});

describe("what the card suggests, and only suggests", () => {
  it("proposes a company when the card says so outright", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "FN:Công ty Cổ phần Sen Vàng",
        "ORG:Công ty Cổ phần Sen Vàng;Kinh doanh",
        "X-ABShowAs:COMPANY",
        "TEL;type=WORK:19001234",
      ),
    );

    expect(result.candidates[0].suggestedType).toBe("business");
  });

  it("proposes a company when an organisation stands alone", () => {
    const result = parseVcards(
      card("VERSION:3.0", "FN:Công ty TNHH An Phát", "ORG:Công ty TNHH An Phát;", "TEL:02838220011"),
    );

    expect(result.candidates[0].suggestedType).toBe("business");
  });

  /** An employer written next to a person's name is not a company contact. */
  it("does not call a person a company because their employer is listed", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "N:Nguyễn;An;;;",
        "FN:Nguyễn Văn An",
        "ORG:Công ty TNHH An Phát;",
        "TEL;type=CELL:0912345678",
      ),
    );

    expect(result.candidates[0].suggestedType).toBeNull();
  });

  it("leaves the question open when the card says nothing", () => {
    const result = parseVcards(card("VERSION:3.0", "FN:Chị Hoa", "TEL:0912345678"));
    expect(result.candidates[0].suggestedType).toBeNull();
  });

  it("turns TYPE= into a name the person can read", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "FN:Nhiều số",
        "TEL;type=CELL:0912345678",
        "TEL;type=WORK:02838220011",
        "TEL;type=FAX:0283999999",
      ),
    );

    const entry = result.candidates[0];
    expect(suggestedLabelOf(entry, "phone", "0912345678")).toBe("Cá nhân");
    expect(suggestedLabelOf(entry, "phone", "02838220011")).toBe("Cơ quan");
  });

  /** A fax is not "other" in words — an invented label reads like somebody decided something. */
  it("suggests nothing rather than a label meaning nothing", () => {
    expect(labelWords("other")).toBeNull();

    const result = parseVcards(
      card("VERSION:3.0", "FN:Có fax", "TEL;type=CELL:0912345678", "TEL;type=FAX:0283999999"),
    );
    expect(suggestedLabelOf(result.candidates[0], "phone", "0283999999")).toBeNull();
  });

  it("reads a vCard 4 type list as well as the older spelling", () => {
    const result = parseVcards(
      card("VERSION:4.0", "FN:Bốn chấm không", 'TEL;TYPE="work,voice":02838220011'),
    );

    expect(suggestedLabelOf(result.candidates[0], "phone", "02838220011")).toBe("Cơ quan");
  });

  /** The label must follow its value through de-duplication, not its position. */
  it("keeps a label with its own number when a duplicate is dropped", () => {
    const result = parseVcards(
      card(
        "VERSION:3.0",
        "FN:Trùng số",
        "TEL;type=CELL:0912345678",
        "TEL;type=CELL:+84 912 345 678",
        "TEL;type=WORK:02838220011",
      ),
    );

    const [entry] = result.candidates;
    const extras = extraChannelsOf({
      ...entry,
      phones: ["0912345678", "02838220011"],
    });

    expect(extras).toEqual([{ kind: "phone", value: "02838220011", label: "Cơ quan" }]);
  });

  it("carries no label at all for a source that has none", () => {
    const result = parseVcards(
      card("VERSION:3.0", "FN:Không nhãn", "TEL:0912345678", "TEL:0987000111"),
    );

    expect(extraChannelsOf(result.candidates[0])).toEqual([
      { kind: "phone", value: "0987000111", label: null },
    ]);
  });
});

describe("a phone book of real size", () => {
  it("reads five thousand cards", () => {
    const file = Array.from({ length: 5000 }, (_unused, index) =>
      card("VERSION:3.0", `FN:Người ${index}`, `TEL:09${String(index).padStart(8, "0")}`),
    ).join("");

    const result = parseVcards(file);
    expect(result.total).toBe(5000);
    expect(result.candidates).toHaveLength(5000);
    expect(result.skipped).toBe(0);
    expect(result.candidates[4999].name).toBe("Người 4999");
  });

  it("counts the cards it could not read instead of hiding them", () => {
    const file =
      card("VERSION:3.0", "FN:Đọc được", "TEL:0912345678") + "BEGIN:VCARD\r\nkhông phải thẻ\r\n";

    const result = parseVcards(file);
    expect(result.total).toBe(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  /**
   * A card with a number but no name is legible — it is simply not a contact. It is handed on
   * unnamed rather than counted as damage, and the shared pipeline drops it there, exactly as
   * it drops a nameless phone-book entry.
   */
  it("does not call a nameless card unreadable", () => {
    const result = parseVcards(
      card("VERSION:3.0", "FN:Có tên", "TEL:0912345678") +
        card("VERSION:3.0", "TEL:0900000000"),
    );

    expect(result.skipped).toBe(0);
    expect(result.candidates.map((entry) => entry.name)).toEqual(["Có tên", ""]);
  });
});
