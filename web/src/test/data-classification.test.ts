import { describe, expect, it } from "vitest";

import TYPES_SOURCE from "../integrations/supabase/types.ts?raw";
import { DATA_CLASSIFICATION, tablesInGeneratedTypes, unclassifiedTables } from "@/lib/data-classification";

const FAKE_TABLE = `      zz_unclassified_probe: {
        Row: {
          id: string
        }
        Insert: {
          id?: string
        }
        Update: {
          id?: string
        }
        Relationships: []
      }
`;

describe("data classification (RFC §24.3)", () => {
  it("reads the tables out of the generated types", () => {
    const tables = tablesInGeneratedTypes(TYPES_SOURCE);
    expect(tables.length).toBeGreaterThan(40);
    expect(tables).toContain("messages");
    expect(tables).toContain("transactions");
  });

  it("classifies every table in types.ts", () => {
    expect(unclassifiedTables(TYPES_SOURCE)).toEqual([]);
  });

  it("goes red when a table is added without a classification", () => {
    const withProbe = TYPES_SOURCE.replace(/(\n {2}public: \{\n {4}Tables: \{\n)/, `$1${FAKE_TABLE}`);
    expect(withProbe).not.toBe(TYPES_SOURCE);
    expect(unclassifiedTables(withProbe)).toEqual(["zz_unclassified_probe"]);
  });

  it("marks the columns the RFC names explicitly", () => {
    expect(DATA_CLASSIFICATION.messages.columns.content).toBe("sensitive");
    expect(DATA_CLASSIFICATION.transactions.columns.amount).toBe("sensitive");
    expect(DATA_CLASSIFICATION.transactions.domain).toBe("finance");
    // ADR-019: a PIN identifies someone; it is not a secret.
    expect(DATA_CLASSIFICATION.user_pins.columns.pin).toBe("internal");
    expect(DATA_CLASSIFICATION.group_invite_links.columns.token).toBe("secret");
  });
});
