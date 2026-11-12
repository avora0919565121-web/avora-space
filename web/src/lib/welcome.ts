/**
 * Nhà mới (VMT 12/11) — the one welcome a newcomer sees: "Bạn muốn Avora là nơi để làm gì?".
 *
 * It replaces the five things that used to stack up on the first sign-in (PIN countdown, gesture card,
 * Bắt đầu, Điều khoản, máy chính). The answer only orders the first steps on Avora Space: no room is
 * hidden, nothing leaves this device, nothing is tracked (VMT 12/11: không theo dõi người dùng).
 */

export type WelcomeChoice = "porch" | "talk" | "promise" | "self" | "keep" | "spend";

/** House wording, in the order of the rooms on the tool-belt. */
export const WELCOME_CHOICES: readonly { id: WelcomeChoice; label: string; room: string }[] = [
  { id: "porch", label: "Mỗi sáng nhìn ngày của mình cho rõ.", room: "Avora Space" },
  { id: "talk", label: "Trò chuyện với chính mình, với người thân, với nhóm.", room: "Kết nối" },
  { id: "promise", label: "Giữ lời hứa: việc nào cũng có người nhận và hạn.", room: "Nhiệm vụ" },
  { id: "self", label: "Dành thời gian cho mình: thói quen, đọc sách.", room: "Nhiệm vụ · Thư phòng" },
  { id: "keep", label: "Cất giữ giấy tờ, mật khẩu, tài sản cho an toàn.", room: "Két sắt" },
  { id: "spend", label: "Ghi chi tiêu của gia đình.", room: "Két sắt" },
];

export type StartStepKey = "journal" | "friend" | "task" | "habit" | "book" | "vault" | "spend" | "pin";

/** Which first steps each choice brings forward. */
const STEPS_OF: Record<WelcomeChoice, readonly StartStepKey[]> = {
  porch: ["task"],
  talk: ["journal", "friend"],
  promise: ["task"],
  self: ["habit", "book"],
  keep: ["vault"],
  spend: ["spend"],
};

/** Nothing chosen (or the welcome skipped): the three steps Avora Space always offered. */
const DEFAULT_STEPS: readonly StartStepKey[] = ["journal", "task", "friend"];

/**
 * The first steps to show, in order: what the person chose first, then the PIN (only while it is
 * missing — it is how family finds them). At most four, so the card stays a card.
 */
export function startSteps(choices: readonly WelcomeChoice[], needsPin: boolean): StartStepKey[] {
  const picked: StartStepKey[] = [];
  // One step from each choice first, then the second ones — so every choice is answered before any twice.
  const lists = choices.length === 0 ? [DEFAULT_STEPS] : WELCOME_CHOICES.filter((c) => choices.includes(c.id)).map((c) => STEPS_OF[c.id]);
  const rounds = Math.max(...lists.map((list) => list.length));
  const from = choices.length === 0 ? DEFAULT_STEPS : Array.from({ length: rounds }, (_, i) => lists.flatMap((list) => (list[i] === undefined ? [] : [list[i]]))).flat();
  for (const key of from) if (!picked.includes(key)) picked.push(key);
  const head = picked.slice(0, needsPin ? 3 : 4);
  return needsPin ? [...head, "pin"] : head;
}

/**
 * CC-02: whether Avora Space knows yet if the Bắt đầu card shows and how many steps it holds. Until
 * then the blocks under the greeting wait (a quiet placeholder holds their place), so the card never
 * lands ~1.5 s later and pushes "Cần chú ý hôm nay" down under a finger about to tap it.
 * A failed load counts as known: the block says so itself. The Két sắt step is not waited for: its
 * status comes after proving the device (seconds), and a newcomer rarely has a code yet.
 */
export function isStartSettled(known: { conversations: boolean; tasks: boolean; pin: boolean; habits: boolean }, choices: readonly WelcomeChoice[]): boolean {
  if (!known.conversations || !known.tasks || !known.pin) return false;
  // Thói quen only matters when the person asked for it (its step is one of theirs).
  return known.habits || !startSteps(choices, true).includes("habit");
}

/**
 * QA01-01: the "Viết dòng đầu tiên vào Nhật ký" step opens Nhật ký (ghi nhanh) itself, never whatever
 * view the device opened last — on a new device that is Sổ ghi chép (long notes).
 */
export function journalStepPath(journalId: string | null): string {
  return journalId === null ? "/tin-nhan" : `/tin-nhan/${journalId}?xem=nhat-ky`;
}

/** The welcome is for newcomers: an account made in the last 14 days. Unknown age → not new. */
export function isRecentAccount(createdAt: string | null | undefined, now: Date = new Date()): boolean {
  if (createdAt == null || createdAt === "") return false;
  const made = new Date(createdAt).getTime();
  return Number.isFinite(made) && now.getTime() - made <= 14 * 86_400_000;
}

const KEY = "avora.welcome";

export type WelcomeState = { seen: boolean; choices: WelcomeChoice[] };

function isChoice(value: unknown): value is WelcomeChoice {
  return WELCOME_CHOICES.some((choice) => choice.id === value);
}

/** Read from this device only. A missing or unreadable record counts as "not seen yet". */
export function readWelcome(userId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): WelcomeState {
  try {
    const raw = storage?.getItem(`${KEY}:${userId}`) ?? null;
    if (raw === null) return { seen: false, choices: [] };
    const parsed = JSON.parse(raw) as { choices?: unknown };
    const choices = Array.isArray(parsed.choices) ? parsed.choices.filter(isChoice) : [];
    return { seen: true, choices };
  } catch {
    return { seen: false, choices: [] };
  }
}

export function saveWelcome(userId: string, choices: readonly WelcomeChoice[], storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(`${KEY}:${userId}`, JSON.stringify({ choices }));
  } catch {
    // Without storage the welcome may show once more; never an error.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
