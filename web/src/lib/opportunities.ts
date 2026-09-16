import { supabase } from "@/integrations/supabase/client";

/**
 * A contact someone is actively trying to turn into business.
 *
 * A private ledger, not shared data. An opportunity belongs to exactly one person — the one
 * tracking it — and stays invisible to everyone else even when it is tied to a group
 * conversation: the group is discussing work, not jointly watching somebody's sales funnel.
 *
 * Deliberately NOT a contact field. Most contacts are never opportunities, a contact can be
 * followed as more than one piece of business at a time, and a stage written onto `contact`
 * would put a sales word on a family member's row.
 */
export type OpportunityStage = "lead" | "tiem_nang" | "dang_cham_soc" | "doi_tac" | "khong_thanh";

export type Opportunity = {
  id: string;
  ownerUserId: string;
  contactId: string;
  title: string;
  stage: OpportunityStage;
  /** Nothing to estimate yet is the normal state of a new lead, so this is often null. */
  estimatedValue: number | null;
  conversationId: string | null;
  /** Reserved. The Dự án module does not exist yet, so nothing writes this. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
};

type OpportunityRow = {
  id: string;
  owner_user_id: string;
  contact_id: string;
  title: string;
  stage: string;
  estimated_value: number | null;
  conversation_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

export const opportunityKeys = {
  all: ["opportunities"] as const,
  list: ["opportunities", "list"] as const,
};

/**
 * The five stages, in the order a deal usually travels.
 *
 * Order here is for reading — the stage picker and any future board column layout. It is NOT a
 * sequence anything enforces: re-reading a customer and stepping back from "đang chăm sóc" to
 * "tiềm năng" is ordinary judgement, not a mistake to block.
 */
export const OPPORTUNITY_STAGES: readonly OpportunityStage[] = [
  "lead",
  "tiem_nang",
  "dang_cham_soc",
  "doi_tac",
  "khong_thanh",
];

const STAGE_LABELS: Record<OpportunityStage, string> = {
  lead: "Mới ghi nhận",
  tiem_nang: "Tiềm năng",
  dang_cham_soc: "Đang chăm sóc",
  doi_tac: "Đối tác",
  khong_thanh: "Không thành",
};

/** What a stage is called on screen. */
export function stageLabel(stage: OpportunityStage): string {
  return STAGE_LABELS[stage];
}

/**
 * Whether this stage still needs attention.
 *
 * Both endings are closed, for opposite reasons: a partner has been won and a lost deal has
 * been let go, and neither is waiting on anybody. This is what the address book badge is
 * counting — "still in play", not "has ever been an opportunity".
 */
export function isOpenStage(stage: OpportunityStage): boolean {
  return stage !== "doi_tac" && stage !== "khong_thanh";
}

function isOpportunityStage(value: string): value is OpportunityStage {
  return (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    contactId: row.contact_id,
    title: row.title,
    // An unreadable stage falls back to 'lead' rather than throwing: a row that exists is worth
    // showing, and 'lead' is the one stage that claims no progress has been made.
    stage: isOpportunityStage(row.stage) ? row.stage : "lead",
    estimatedValue: row.estimated_value,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The database's Vietnamese refusals, kept where a person can act on them. */
export function toVietnameseOpportunityError(code: string | undefined, message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("cơ hội cần một tiêu đề")) return "Cơ hội cần một tiêu đề.";
  if (normalized.includes("giá trị dự kiến không thể là số âm"))
    return "Giá trị dự kiến không thể là số âm.";
  if (normalized.includes("chỉ đánh dấu được cơ hội trên liên hệ của chính bạn"))
    return "Đây không phải liên hệ của bạn.";
  if (normalized.includes("cơ hội phải gắn với liên hệ của chính bạn"))
    return "Đây không phải liên hệ của bạn.";
  if (normalized.includes("chỉ chủ cơ hội mới được")) return "Đây không phải cơ hội của bạn.";
  if (normalized.includes("chỉ gắn được cuộc trò chuyện mà bạn là thành viên"))
    return "Bạn không còn trong cuộc trò chuyện này.";
  if (normalized.includes("không tìm thấy cuộc trò chuyện")) return "Cuộc trò chuyện này không còn nữa.";
  if (normalized.includes("không tìm thấy cơ hội")) return "Cơ hội này không còn nữa.";
  if (normalized.includes("không tìm thấy liên hệ")) return "Liên hệ này không còn nữa.";
  if (normalized.includes("giai đoạn không hợp lệ")) return "Giai đoạn này không hợp lệ.";
  if (normalized.includes("chưa đăng nhập"))
    return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (code === "42501" || normalized.includes("permission denied"))
    return "Máy chủ chưa cho phép thao tác này. Vui lòng báo lại cho chúng tôi.";
  if (normalized.includes("row-level security")) return "Bạn không có quyền với cơ hội này.";
  if (normalized.includes("failed to fetch"))
    return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
  return "Có lỗi xảy ra. Vui lòng thử lại.";
}

function fail(code: string | undefined, message: string): Error {
  console.error(`[opportunities] ${code ?? "unknown"}: ${message}`);
  return new Error(toVietnameseOpportunityError(code, message));
}

// ------------------------------------------------------------------ reading

/** Every opportunity the viewer owns. RLS returns nobody else's. */
export async function fetchOpportunities(): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("crm_opportunity")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw fail(error.code, error.message);
  return (data ?? []).map((row) => toOpportunity(row as OpportunityRow));
}

/** The opportunities on one contact, newest first. */
export function opportunitiesOf(
  opportunities: readonly Opportunity[],
  contactId: string,
): Opportunity[] {
  return opportunities
    .filter((entry) => entry.contactId === contactId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * The one to speak for a contact when there is only room for one badge.
 *
 * An open opportunity wins over a settled one however old it is: the address book row is
 * answering "is there anything live with this person", and a deal closed last year should not
 * hide the one being worked on today. Among equals, the most recent.
 */
export function leadOpportunityOf(
  opportunities: readonly Opportunity[],
  contactId: string,
): Opportunity | null {
  const mine = opportunitiesOf(opportunities, contactId);
  if (mine.length === 0) return null;
  return mine.find((entry) => isOpenStage(entry.stage)) ?? mine[0];
}

/**
 * The contacts with at least one opportunity still in play.
 *
 * A set rather than a list because the address book asks this once per row while scrolling —
 * a repeated scan of every opportunity would be work proportional to rows times deals.
 */
export function contactsWithOpenOpportunity(
  opportunities: readonly Opportunity[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of opportunities) {
    if (isOpenStage(entry.stage)) ids.add(entry.contactId);
  }
  return ids;
}

/** A title suggested from the contact's own name, so the common case needs no typing. */
export function suggestedOpportunityTitle(contactName: string): string {
  const name = contactName.trim();
  return name.length === 0 ? "Cơ hội kinh doanh" : `Cơ hội với ${name}`;
}

/** The estimated value as Vietnamese money, or null when nothing has been estimated. */
export function formatEstimatedValue(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

// ------------------------------------------------------------------ writing

/**
 * Marks a contact as a piece of business worth following.
 *
 * The owner comes from the session, never from here. Ownership of the contact is checked
 * server-side, so this call cannot open an opportunity on somebody else's contact however it
 * is made.
 */
export async function createOpportunity(input: {
  contactId: string;
  title: string;
  estimatedValue?: number | null;
}): Promise<Opportunity> {
  const { data, error } = await supabase.rpc("create_opportunity", {
    p_contact_id: input.contactId,
    p_title: input.title.trim(),
    p_estimated_value: input.estimatedValue ?? undefined,
  });

  if (error) throw fail(error.code, error.message);
  return toOpportunity(data as unknown as OpportunityRow);
}

/** Moves an opportunity to another stage. Any of the five, in any direction. */
export async function updateOpportunityStage(
  opportunityId: string,
  stage: OpportunityStage,
): Promise<Opportunity> {
  const { data, error } = await supabase.rpc("update_opportunity_stage", {
    p_opportunity_id: opportunityId,
    p_stage: stage,
  });

  if (error) throw fail(error.code, error.message);
  return toOpportunity(data as unknown as OpportunityRow);
}

/**
 * Ties an opportunity to a conversation, or unties it when given null.
 *
 * Membership of the conversation is checked server-side on top of ownership of the
 * opportunity — being the owner is not enough to point it at a thread one is not in.
 */
export async function linkOpportunityConversation(
  opportunityId: string,
  conversationId: string | null,
): Promise<Opportunity> {
  const { data, error } = await supabase.rpc("link_opportunity_conversation", {
    p_opportunity_id: opportunityId,
    p_conversation_id: conversationId,
  });

  if (error) throw fail(error.code, error.message);
  return toOpportunity(data as unknown as OpportunityRow);
}

/** Renames an opportunity, or re-estimates it. The only two fields writable in place. */
export async function updateOpportunityDetails(input: {
  opportunityId: string;
  title?: string;
  estimatedValue?: number | null;
}): Promise<void> {
  const patch: { title?: string; estimated_value?: number | null } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length === 0) throw new Error("Cơ hội cần một tiêu đề.");
    patch.title = trimmed;
  }
  if (input.estimatedValue !== undefined) patch.estimated_value = input.estimatedValue;
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("crm_opportunity")
    .update(patch)
    .eq("id", input.opportunityId);

  if (error) throw fail(error.code, error.message);
}

/** Drops an opportunity recorded by mistake. The contact itself is untouched. */
export async function deleteOpportunity(opportunityId: string): Promise<void> {
  const { error } = await supabase.from("crm_opportunity").delete().eq("id", opportunityId);
  if (error) throw fail(error.code, error.message);
}
