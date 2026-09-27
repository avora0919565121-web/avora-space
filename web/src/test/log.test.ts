import { afterEach, describe, expect, it, vi } from "vitest";

import { describeError, logError } from "@/lib/log";

const EMAIL = "an.nguyen@example.com";
const AMOUNT = "12.500.000";
const PIN = "K7QM2X";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.secret";
const MESSAGE_TEXT = "Chuyển khoản cho chị Hoa trước thứ Sáu";

function captured(): string {
  const spy = vi.mocked(console.error);
  return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

describe("logError (RFC §24.6, §24.21)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never writes message text, amounts, emails, PINs or tokens", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaky = Object.assign(
      new Error(`duplicate key: Key (email)=(${EMAIL}) amount ${AMOUNT} pin ${PIN} token ${TOKEN} "${MESSAGE_TEXT}"`),
      { code: "23505", details: EMAIL, hint: TOKEN, body: { amount: AMOUNT } },
    );
    logError("contacts", leaky);
    logError("finance", { code: "42501", message: `amount=${AMOUNT} for ${EMAIL}` });
    logError("chat", MESSAGE_TEXT);

    const output = captured();
    for (const secret of [EMAIL, AMOUNT, PIN, TOKEN, MESSAGE_TEXT, "Key (email)"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[contacts] 23505");
    expect(output).toContain("[finance] 42501");
    expect(output).toContain("[chat] unknown");
  });

  it("keeps the app's own avora_* codes, which name a refusal without quoting data", () => {
    expect(describeError("chat", { code: "P0001", message: "avora_contact_unavailable" }).code).toBe(
      "P0001 avora_contact_unavailable",
    );
  });

  it("refuses a code or scope that is really data", () => {
    expect(describeError("x", { code: EMAIL }).code).toBe("unknown");
    expect(describeError(`scope ${EMAIL}`, new Error("x")).scope).toBe("app");
  });

  it("keeps the error class name, not its message", () => {
    const fields = describeError("paste-intake", new DOMException(MESSAGE_TEXT, "NotAllowedError"));
    expect(fields.name).toBe("NotAllowedError");
    expect(JSON.stringify(fields)).not.toContain(MESSAGE_TEXT);
  });
});
