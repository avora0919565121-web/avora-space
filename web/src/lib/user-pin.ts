import { supabase } from "@/integrations/supabase/client";

/**
 * User PIN (ADR-019): a permanent identifier used to route invitations — not a secret.
 *
 * `A-` + 8 characters. Letters and digits only, without the ones people confuse when reading a
 * PIN aloud or copying it by hand (0/O, 1/I/L). At least 4 of the 8 are letters, and the first
 * and last are letters. The database checks exactly the same rules; this copy exists so the form
 * can say what is wrong while the person is still typing.
 */
export const PIN_PREFIX = "A-";
export const PIN_BODY_LENGTH = 8;
export const PIN_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const PIN_DIGITS = "23456789";
const PIN_ALPHABET = PIN_LETTERS + PIN_DIGITS;
const MIN_LETTERS = 4;

/** Kept identical to `private.user_pin_problem` on the server. */
const BLOCKED =
  /(FUCK|FUK|CUNT|SEX|XXX|CAC|DCM|DKM|DMM|DJT|DM2|CUT|DEM|BUCU|META|VISA|GRAB|SAMSUNG|SHOPEE|VNPAY|MBBANK|VCB|TPBANK|ACB|MASTERCARD|AMEX|NVIDIA|TESLA|UBER|ADMN|ROOT)/;

export type PinProblem = "format" | "confusing" | "edges" | "letters" | "blocked";
export type PinAvailability = "ok" | "taken" | PinProblem;

export const PIN_RULES: readonly string[] = [
  "Bắt đầu bằng A- và 8 ký tự sau đó",
  "Chỉ chữ cái và số, không dùng 0, O, 1, I, L",
  "Ít nhất 4 chữ cái trong 8 ký tự",
  "Ký tự đầu và cuối là chữ cái",
];

/** The 8 characters after `A-`, upper-cased, whatever the person typed around them. */
export function pinBody(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/\s+/g, "");
  const body = cleaned.startsWith(PIN_PREFIX) ? cleaned.slice(PIN_PREFIX.length) : cleaned.replace(/^A(?=.{8}$)/, "");
  return body.replace(/[^A-Z0-9]/g, "").slice(0, PIN_BODY_LENGTH);
}

export function toPin(body: string): string {
  return `${PIN_PREFIX}${body}`;
}

/** Which rule the 8 characters break first, or null when they are a valid PIN body. */
export function pinProblem(body: string): PinProblem | null {
  if (body.length !== PIN_BODY_LENGTH) return "format";
  if (/[01OIL]/.test(body)) return "confusing";
  if (![...body].every((char) => PIN_ALPHABET.includes(char))) return "format";
  if (!PIN_LETTERS.includes(body[0]) || !PIN_LETTERS.includes(body[PIN_BODY_LENGTH - 1])) return "edges";
  if ([...body].filter((char) => PIN_LETTERS.includes(char)).length < MIN_LETTERS) return "letters";
  if (BLOCKED.test(body)) return "blocked";
  return null;
}

export function pinProblemMessage(problem: PinAvailability): string {
  if (problem === "ok") return "PIN này dùng được.";
  if (problem === "taken") return "PIN này đã có người dùng. Thử một biến thể khác nhé.";
  if (problem === "format") return "Cần đủ 8 ký tự, chỉ chữ cái và số.";
  if (problem === "confusing") return "Không dùng 0, O, 1, I, L — những ký tự dễ đọc nhầm.";
  if (problem === "edges") return "Ký tự đầu và cuối cần là chữ cái.";
  if (problem === "letters") return "Cần ít nhất 4 chữ cái trong 8 ký tự.";
  return "PIN này chứa từ không phù hợp hoặc trùng tên thương hiệu. Chọn cách viết khác nhé.";
}

function randomIndex(size: number, random: () => number): number {
  return Math.floor(random() * size) % size;
}

function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] / 0x1_0000_0000;
}

/**
 * A fresh PIN that meets every rule: letters at both ends, at least 4 letters overall, nothing
 * confusable, nothing blocked. Retries the rare draw that trips the filter.
 */
export function generatePinBody(random: () => number = cryptoRandom): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const chars: string[] = [PIN_LETTERS[randomIndex(PIN_LETTERS.length, random)]];
    for (let index = 1; index < PIN_BODY_LENGTH - 1; index += 1) {
      chars.push(PIN_ALPHABET[randomIndex(PIN_ALPHABET.length, random)]);
    }
    chars.push(PIN_LETTERS[randomIndex(PIN_LETTERS.length, random)]);
    const body = chars.join("");
    if (pinProblem(body) === null) return body;
  }
  // Unreachable in practice; a fixed, valid fallback keeps the contract.
  return "AVRAMNPQ";
}

export const userPinKeys = {
  mine: (userId: string) => ["user-pin", userId] as const,
};

function fail(code: string | undefined, message: string): Error {
  console.error(`[user-pin] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_pin_taken")) return new Error(pinProblemMessage("taken"));
  if (normalized.includes("avora_pin_permanent")) return new Error("Tài khoản này đã có PIN — PIN không đổi được.");
  if (normalized.includes("avora_pin_confusing")) return new Error(pinProblemMessage("confusing"));
  if (normalized.includes("avora_pin_edges")) return new Error(pinProblemMessage("edges"));
  if (normalized.includes("avora_pin_letters")) return new Error(pinProblemMessage("letters"));
  if (normalized.includes("avora_pin_blocked")) return new Error(pinProblemMessage("blocked"));
  if (normalized.includes("avora_pin_format")) return new Error(pinProblemMessage("format"));
  if (normalized.includes("avora_not_signed_in")) return new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  if (normalized.includes("failed to fetch")) return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  return new Error("Không lưu được PIN. Thử lại nhé.");
}

/** The signed-in person's PIN, or null while they have none. */
export async function fetchMyPin(): Promise<string | null> {
  const { data, error } = await supabase.from("user_pins").select("pin").maybeSingle();
  if (error) throw fail(error.code, error.message);
  return data?.pin ?? null;
}

/** Free, taken, or the rule it breaks — never who owns it. */
export async function checkPin(pin: string): Promise<PinAvailability> {
  const { data, error } = await supabase.rpc("check_user_pin", { p_pin: pin });
  if (error) throw fail(error.code, error.message);
  const value = data === "ok" || data === "taken" ? data : String(data ?? "").replace("avora_pin_", "");
  return (["ok", "taken", "format", "confusing", "edges", "letters", "blocked"] as const).includes(
    value as PinAvailability,
  )
    ? (value as PinAvailability)
    : "format";
}

/** Sets the caller's PIN, once and for good. */
export async function claimPin(pin: string, source: "chosen" | "generated"): Promise<string> {
  const { data, error } = await supabase.rpc("claim_user_pin", { p_pin: pin, p_source: source });
  if (error) throw fail(error.code, error.message);
  return typeof data === "string" ? data : pin;
}
