import { supabase } from "@/integrations/supabase/client";
import type { GroupRole } from "@/lib/groups";

/**
 * The two kinds of record a group keeps.
 *
 * A meeting note is a decision already made and written down; a poll is one still being made.
 * They share a table and a screen because they answer the same question later — "what did we
 * decide, and when?" — and differ only in whether the answer is settled yet.
 */
export type DecisionKind = "meeting_note" | "poll";

/** Where a record stands. Each kind has its own pair; the database refuses to mix them. */
export type DecisionStatus = "draft" | "finalized" | "open" | "closed";

export type DecisionOption = {
  id: string;
  label: string;
  sortOrder: number;
};

/**
 * One entry in the log.
 *
 * `myVote` is the only thing a person is told about an open poll besides its existence: whether
 * they have answered. `tally` stays null until the poll closes — not hidden by this client, but
 * genuinely absent, because the database refuses to hand over other people's ballots while the
 * poll is open.
 */
export type DecisionEntry = {
  id: string;
  conversationId: string;
  kind: DecisionKind;
  title: string;
  body: string;
  status: DecisionStatus;
  createdBy: string;
  createdAt: string;
  settledAt: string | null;
  settledBy: string | null;
  options: DecisionOption[];
  myVote: string | null;
  tally: Record<string, number> | null;
  totalVotes: number | null;
};

/** A single-use permission to open one note or one poll. */
export type DecisionGrant = {
  id: string;
  conversationId: string;
  granteeId: string;
  kind: DecisionKind;
  grantedBy: string;
  usedAt: string | null;
};

/** React Query cache keys for the decision log surfaces. */
export const decisionKeys = {
  list: (conversationId: string) => ["group-decisions", conversationId] as const,
  grants: (conversationId: string) => ["group-decision-grants", conversationId] as const,
};

/** The database rejects anything longer; the fields stop typing at the same numbers. */
export const DECISION_TITLE_MAX_LENGTH = 200;
export const DECISION_BODY_MAX_LENGTH = 5000;
export const DECISION_OPTION_MAX_LENGTH = 120;
export const DECISION_MIN_OPTIONS = 2;
export const DECISION_MAX_OPTIONS = 10;

/** A settled record is history. Nothing about it can change, including by its author. */
export function isSettled(entry: Pick<DecisionEntry, "status">): boolean {
  return entry.status === "finalized" || entry.status === "closed";
}

/**
 * Whether the result of a poll may be shown at all.
 *
 * This mirrors the database rule rather than deciding it. While a poll is open nobody — not even
 * the person who opened it — can read another's ballot, so there is no tally to render; a screen
 * that guessed one would be inventing it.
 */
export function canSeeResults(entry: Pick<DecisionEntry, "kind" | "status">): boolean {
  return entry.kind === "poll" && entry.status === "closed";
}

/**
 * Whether this person may still choose, or change what they chose.
 *
 * While a poll is open, thinking again is legitimate — the point of asking is to find out what
 * people think, not to catch them at their first instinct. Once it closes the ballot is fixed,
 * because by then the result has been published to the whole room and a late change would
 * rewrite something everyone has already read. The database enforces both halves; this only
 * decides whether the option is offered.
 */
export function canVote(entry: Pick<DecisionEntry, "kind" | "status">): boolean {
  return entry.kind === "poll" && entry.status === "open";
}

/**
 * Whether pressing this option would actually change anything.
 *
 * Re-pressing the option already chosen is not an error and not worth a round trip — the
 * answer is already what the person wants, so the press is simply absorbed.
 */
export function wouldChangeVote(entry: Pick<DecisionEntry, "kind" | "status" | "myVote">, optionId: string): boolean {
  if (!canVote(entry)) return false;
  return entry.myVote !== optionId;
}

/**
 * The quiet line under an open poll, which must say two things at once: the result is not
 * visible yet, and the choice is not final yet. Leaving the second unsaid would make people
 * treat one press as irreversible and hesitate over it.
 */
export function openPollNote(entry: Pick<DecisionEntry, "myVote">): string {
  return entry.myVote === null
    ? "Bạn chưa bình chọn. Kết quả chỉ hiện khi cuộc bình chọn đóng lại."
    : "Đây là lựa chọn của bạn — còn mở thì vẫn đổi được. Kết quả hiện khi cuộc bình chọn đóng lại.";
}

/** Officers may always open a record; everyone else needs an unspent permission. */
export function canOpenDecision(
  role: GroupRole | undefined,
  kind: DecisionKind,
  grants: readonly DecisionGrant[],
  userId: string | undefined,
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (!userId) return false;
  return grants.some(
    (grant) => grant.granteeId === userId && grant.kind === kind && grant.usedAt === null,
  );
}

/** Handing out permissions belongs to the seats that answer for the group. */
export function canDelegate(role: GroupRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** The author closes their own, and officers can close any — a poll left open forever helps nobody. */
export function canSettle(
  entry: Pick<DecisionEntry, "createdBy" | "status">,
  role: GroupRole | undefined,
  userId: string | undefined,
): boolean {
  if (isSettled(entry)) return false;
  if (role === "owner" || role === "admin") return true;
  return Boolean(userId) && entry.createdBy === userId;
}

/** Only the author edits a draft, and only while it is still a draft. */
export function canEditDraft(
  entry: Pick<DecisionEntry, "kind" | "status" | "createdBy">,
  userId: string | undefined,
): boolean {
  return entry.kind === "meeting_note" && entry.status === "draft" && entry.createdBy === userId;
}

/** Whether the compose form has enough to submit. Mirrors the database's own checks. */
export function canSubmitDecision(kind: DecisionKind, title: string, options: readonly string[]): boolean {
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > DECISION_TITLE_MAX_LENGTH) return false;
  if (kind === "meeting_note") return true;
  const filled = options.map((option) => option.trim()).filter((option) => option.length > 0);
  return filled.length >= DECISION_MIN_OPTIONS && filled.length <= DECISION_MAX_OPTIONS;
}

/** Short Vietnamese label for a record's state, as shown beside its title. */
export function decisionStatusLabel(entry: Pick<DecisionEntry, "kind" | "status">): string {
  if (entry.kind === "meeting_note") return entry.status === "draft" ? "Bản nháp" : "Đã khoá";
  return entry.status === "open" ? "Đang mở" : "Đã đóng";
}

/** Maps the decision RPC exceptions to short Vietnamese messages. */
export function toVietnameseDecisionError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("avora_decision_settled_immutable"))
    return "Mục này đã được khoá nên không sửa hay xoá được nữa.";
  if (normalized.includes("avora_decision_already_voted")) return "Bạn đã bình chọn rồi.";
  if (normalized.includes("avora_decision_vote_immutable"))
    return "Phiếu đã bỏ thì không rút lại được.";
  if (normalized.includes("avora_decision_poll_closed"))
    return "Cuộc bình chọn đã đóng nên không đổi phiếu được nữa.";
  if (normalized.includes("avora_decision_not_allowed"))
    return "Bạn cần được chủ nhóm uỷ quyền để tạo mục này.";
  if (normalized.includes("avora_decision_officers_only"))
    return "Chỉ chủ nhóm hoặc quản trị viên mới uỷ quyền được.";
  if (normalized.includes("avora_decision_grant_spent"))
    return "Quyền này đã được dùng nên không thu hồi được nữa.";
  if (normalized.includes("avora_decision_grant_self")) return "Không cần tự uỷ quyền cho chính mình.";
  if (normalized.includes("avora_decision_grantee_not_participant"))
    return "Người này không còn trong nhóm.";
  if (normalized.includes("avora_decision_grant_not_found")) return "Không tìm thấy quyền này.";
  if (normalized.includes("avora_decision_not_yours")) return "Bạn không phải người tạo mục này.";
  if (normalized.includes("avora_decision_not_found")) return "Không tìm thấy mục này.";
  if (normalized.includes("avora_decision_poll_needs_options"))
    return `Cuộc bình chọn cần ít nhất ${DECISION_MIN_OPTIONS} lựa chọn.`;
  if (normalized.includes("avora_decision_poll_max_options"))
    return `Tối đa ${DECISION_MAX_OPTIONS} lựa chọn.`;
  if (normalized.includes("avora_decision_option_foreign"))
    return "Lựa chọn này không thuộc cuộc bình chọn.";
  if (normalized.includes("avora_decision_title_blank")) return "Hãy đặt tiêu đề cho mục này.";
  if (normalized.includes("avora_decision_title_max_len"))
    return `Tiêu đề quá dài (tối đa ${DECISION_TITLE_MAX_LENGTH} ký tự).`;
  if (normalized.includes("avora_decision_body_max_len")) return "Nội dung quá dài.";
  if (normalized.includes("avora_decision_group_only")) return "Chỉ nhóm mới có sổ quyết định.";
  if (normalized.includes("avora_decision_bad_kind")) return "Loại mục không hợp lệ.";
  if (normalized.includes("avora_not_a_participant")) return "Bạn không còn trong nhóm này.";
  if (normalized.includes("avora_not_signed_in")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("failed to fetch")) return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[decisions] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseDecisionError(code, message));
}

type DecisionRow = {
  id: string;
  conversation_id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  created_by: string;
  created_at: string;
  settled_at: string | null;
  settled_by: string | null;
};

type OptionRow = { id: string; decision_id: string; label: string; sort_order: number };
type VoteRow = { decision_id: string; option_id: string; voter_id: string };

/**
 * The group's decision log, newest first.
 *
 * Votes are fetched in the same pass, but what comes back is decided by the database: for an open
 * poll the reader receives only their own ballot, so the tally below is genuinely uncomputable
 * rather than withheld. That is why `tally` is null while a poll is open instead of zeroed — an
 * empty tally and a hidden one look identical on screen, and only one of them is honest.
 */
export async function fetchGroupDecisions(
  conversationId: string,
  userId: string | undefined,
): Promise<DecisionEntry[]> {
  const { data: decisions, error } = await supabase
    .from("group_decisions")
    .select("id, conversation_id, kind, title, body, status, created_by, created_at, settled_at, settled_by")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw fail(error.code, error.message);

  const rows: DecisionRow[] = (decisions ?? []) as DecisionRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [optionsResult, votesResult] = await Promise.all([
    supabase.from("group_decision_options").select("id, decision_id, label, sort_order").in("decision_id", ids),
    supabase.from("group_decision_votes").select("decision_id, option_id, voter_id").in("decision_id", ids),
  ]);
  if (optionsResult.error) throw fail(optionsResult.error.code, optionsResult.error.message);
  if (votesResult.error) throw fail(votesResult.error.code, votesResult.error.message);

  const optionRows: OptionRow[] = (optionsResult.data ?? []) as OptionRow[];
  const voteRows: VoteRow[] = (votesResult.data ?? []) as VoteRow[];

  return rows.map((row) => {
    const options = optionRows
      .filter((option) => option.decision_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((option) => ({ id: option.id, label: option.label, sortOrder: option.sort_order }));

    const votes = voteRows.filter((vote) => vote.decision_id === row.id);
    const mine = userId ? (votes.find((vote) => vote.voter_id === userId) ?? null) : null;
    const settled = row.status === "finalized" || row.status === "closed";

    let tally: Record<string, number> | null = null;
    if (settled && row.kind === "poll") {
      tally = {};
      for (const option of options) tally[option.id] = 0;
      for (const vote of votes) tally[vote.option_id] = (tally[vote.option_id] ?? 0) + 1;
    }

    return {
      id: row.id,
      conversationId: row.conversation_id,
      kind: row.kind as DecisionKind,
      title: row.title,
      body: row.body,
      status: row.status as DecisionStatus,
      createdBy: row.created_by,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      settledBy: row.settled_by,
      options,
      myVote: mine?.option_id ?? null,
      tally,
      totalVotes: tally === null ? null : votes.length,
    };
  });
}

/** The single-use permissions currently on record for this group. */
export async function fetchDecisionGrants(conversationId: string): Promise<DecisionGrant[]> {
  const { data, error } = await supabase
    .from("group_decision_grants")
    .select("id, conversation_id, grantee_id, kind, granted_by, used_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false });
  if (error) throw fail(error.code, error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    granteeId: row.grantee_id,
    kind: row.kind as DecisionKind,
    grantedBy: row.granted_by,
    usedAt: row.used_at,
  }));
}

/** Opens a note or a poll. Spends a single-use permission when the caller is not an officer. */
export async function createDecision(input: {
  conversationId: string;
  kind: DecisionKind;
  title: string;
  body: string;
  options: string[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_group_decision", {
    p_conversation_id: input.conversationId,
    p_kind: input.kind,
    p_title: input.title.trim(),
    p_body: input.body.trim(),
    p_options:
      input.kind === "poll"
        ? input.options.map((option) => option.trim()).filter((option) => option.length > 0)
        : null,
  });
  if (error) throw fail(error.code, error.message);
  const row = data as unknown as DecisionRow | null;
  if (!row) throw new Error("Không tạo được mục này. Thử lại nhé.");
  return row.id;
}

/** Saves a draft note. Refused by the database once the note has been locked. */
export async function updateDraft(decisionId: string, title: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("update_meeting_note_draft", {
    p_decision_id: decisionId,
    p_title: title.trim(),
    p_body: body.trim(),
  });
  if (error) throw fail(error.code, error.message);
}

/** "Kết thúc & khoá": the deliberate act that turns writing into record. */
export async function finalizeNote(decisionId: string): Promise<void> {
  const { error } = await supabase.rpc("finalize_meeting_note", { p_decision_id: decisionId });
  if (error) throw fail(error.code, error.message);
}

/**
 * Records this person's choice, replacing whatever they chose before.
 *
 * One person holds exactly one ballot — the database keys it that way — so changing a vote
 * moves that single row rather than adding a second. "The last vote counts" is therefore true
 * by construction, not by a tie-break rule sitting somewhere else.
 */
export async function castVote(decisionId: string, optionId: string): Promise<void> {
  const { error } = await supabase.rpc("cast_group_vote", {
    p_decision_id: decisionId,
    p_option_id: optionId,
  });
  if (error) throw fail(error.code, error.message);
}

/** Closing a poll is what makes its result visible, to everyone at once. */
export async function closePoll(decisionId: string): Promise<void> {
  const { error } = await supabase.rpc("close_group_poll", { p_decision_id: decisionId });
  if (error) throw fail(error.code, error.message);
}

/** Hands one member the right to open one note or one poll. */
export async function grantPermission(
  conversationId: string,
  granteeId: string,
  kind: DecisionKind,
): Promise<void> {
  const { error } = await supabase.rpc("grant_group_decision_permission", {
    p_conversation_id: conversationId,
    p_grantee_id: granteeId,
    p_kind: kind,
  });
  if (error) throw fail(error.code, error.message);
}

/** Takes back a permission that has not been spent. A spent one is history, not a setting. */
export async function revokePermission(grantId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_group_decision_permission", { p_grant_id: grantId });
  if (error) throw fail(error.code, error.message);
}
