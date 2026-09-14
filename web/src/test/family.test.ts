import { describe, expect, it, vi } from "vitest";

// Pure-logic tests; importing the module pulls the client in, and it refuses to construct
// without real credentials.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  FAMILY_RELATION_OPTIONS,
  familyRelationLabel,
  isFamily,
  isFamilyRelationType,
  toFamilyIndex,
  type FamilyRelation,
} from "@/lib/family";
import { GUIDANCE_TEXT } from "@/lib/guidance";

const SPOUSE = "u-spouse";
const MOTHER = "u-mother";
const STRANGER = "u-stranger";

describe("the five kinds", () => {
  /**
   * A fixed list rather than free text, because this record exists to be read by a rule: a
   * notification exception cannot act on "mẹ nuôi ❤️" typed by hand.
   */
  it("offers exactly five, and no way to type another", () => {
    expect(FAMILY_RELATION_OPTIONS).toHaveLength(5);
    expect(FAMILY_RELATION_OPTIONS.map((option) => option.value)).toEqual([
      "spouse",
      "parent",
      "parent_in_law",
      "child",
      "other",
    ]);
  });

  it("names each kind in Vietnamese", () => {
    expect(familyRelationLabel("spouse")).toBe("Vợ/Chồng");
    expect(familyRelationLabel("parent")).toBe("Ba mẹ");
    expect(familyRelationLabel("parent_in_law")).toBe("Ba mẹ vợ/chồng");
    expect(familyRelationLabel("child")).toBe("Con");
    expect(familyRelationLabel("other")).toBe("Gia đình khác");
  });

  /**
   * Adoptive parents and children live inside `parent` and `child` on purpose — in law and in
   * practice they carry the same lasting responsibility, and separate kinds would ask people
   * to rank their own family.
   */
  it("says plainly that adoption counts, on both the parent and the child", () => {
    const parent = FAMILY_RELATION_OPTIONS.find((option) => option.value === "parent");
    const child = FAMILY_RELATION_OPTIONS.find((option) => option.value === "child");
    expect(parent?.note).toContain("nuôi");
    expect(child?.note).toContain("nuôi");
  });

  it("recognises only the five when reading a stored value", () => {
    expect(isFamilyRelationType("spouse")).toBe(true);
    expect(isFamilyRelationType("co-worker")).toBe(false);
    expect(isFamilyRelationType("")).toBe(false);
  });
});

describe("reading the viewer's own record", () => {
  const relations: FamilyRelation[] = [
    { relatedUserId: SPOUSE, relationType: "spouse" },
    { relatedUserId: MOTHER, relationType: "parent" },
  ];

  it("indexes by person so one contact's mark needs no search", () => {
    const index = toFamilyIndex(relations);
    expect(index.get(SPOUSE)).toBe("spouse");
    expect(index.get(MOTHER)).toBe("parent");
    expect(index.get(STRANGER)).toBeUndefined();
  });

  /** The question the mute exception asks in Prompt 10. */
  it("answers whether someone is family, whatever the kind", () => {
    const index = toFamilyIndex(relations);
    expect(isFamily(index, SPOUSE)).toBe(true);
    expect(isFamily(index, MOTHER)).toBe(true);
    expect(isFamily(index, STRANGER)).toBe(false);
  });

  it("treats an absent sender as not family rather than throwing", () => {
    const index = toFamilyIndex(relations);
    expect(isFamily(index, null)).toBe(false);
    expect(isFamily(index, undefined)).toBe(false);
  });

  it("finds nobody in an empty record", () => {
    expect(isFamily(toFamilyIndex([]), SPOUSE)).toBe(false);
  });
});

describe("the one-time explanation", () => {
  /**
   * The distinction the wording has to carry: family here means lasting responsibility, not
   * "someone who matters to me this month". The mute exception only makes sense under the
   * first reading.
   */
  it("separates lasting responsibility from temporary importance", () => {
    const text = GUIDANCE_TEXT.family_flag_tag;
    expect(text).toContain("trách nhiệm lâu dài");
    expect(text).toContain("nuôi hợp pháp");
    expect(text).toContain("nhất thời");
  });
});
