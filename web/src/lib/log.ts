/**
 * The one place the app writes to the console (RFC-AVORA-TRUST-001 §24.6, §24.21).
 *
 * Only three things ever leave: the scope, a machine code, and the error's class name. No
 * message text, request or response body, email, amount, PIN or token — a log is read by
 * people who were never meant to see the data, and error messages routinely quote it
 * ("Key (email)=(…) already exists"). The one exception is a message that is itself a code
 * the app raised on purpose (`avora_*`), which is how most server refusals are named.
 */

const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const APP_CODE_PATTERN = /^avora_[a-z0-9_]{1,80}$/i;
const NAME_PATTERN = /^[A-Za-z]{1,40}$/;

type LogFields = { scope: string; code: string; name: string | null };

function field(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[key];
}

/** The loggable part of an error; everything else is dropped. Exported for tests. */
export function describeError(scope: string, error: unknown): LogFields {
  const rawCode = field(error, "code");
  const rawMessage = field(error, "message");
  const rawName = error instanceof Error ? error.name : field(error, "name");

  const code = typeof rawCode === "string" && CODE_PATTERN.test(rawCode) ? rawCode : null;
  const appCode = typeof rawMessage === "string" && APP_CODE_PATTERN.test(rawMessage.trim()) ? rawMessage.trim() : null;
  const name = typeof rawName === "string" && NAME_PATTERN.test(rawName) ? rawName : null;

  const safeScope = CODE_PATTERN.test(scope) ? scope : "app";
  return { scope: safeScope, code: [code, appCode].filter((part) => part !== null).join(" ") || "unknown", name };
}

/** Records that something failed, and where — never what it was carrying. */
export function logError(scope: string, error: unknown): void {
  const { scope: safeScope, code, name } = describeError(scope, error);
  console.error(`[${safeScope}] ${code}${name !== null && name !== "Error" ? ` (${name})` : ""}`);
}
