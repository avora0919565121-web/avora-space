/**
 * The message a friend request carries (AVORA-56 · A).
 *
 * The server is the judge (`private.invite_message_or_raise`, `private.text_has_link`); this
 * mirror only lets the form say what is wrong before a round-trip. Keep the two in step.
 */
export const INVITE_MESSAGE_MIN = 10;
export const INVITE_MESSAGE_MAX = 200;
export const INVITE_MESSAGE_HINT = "Bạn là ai, vì sao muốn kết nối?";
export const INVITE_NO_LINKS_MESSAGE = "Lời mời chưa được chứa đường link.";
export const INVITE_LENGTH_MESSAGE = `Lời nhắn cần từ ${INVITE_MESSAGE_MIN} đến ${INVITE_MESSAGE_MAX} ký tự.`;

const TLDS =
  "com|net|org|vn|io|co|info|biz|me|app|dev|xyz|top|site|online|link|ly|gl|shop|store|us|uk|tv|cc|ai|gg|to|in|ru|cn|edu|gov|asia|club|live|page|tk|ml";
const LINK_PATTERN = new RegExp(`(https?://|www\\.|(^|[^\\p{L}\\p{N}_])[a-z0-9][a-z0-9-]*\\.(${TLDS})(?![\\p{L}\\p{N}_]))`, "iu");

/** http(s)://, www., or a word followed by a common top-level domain. */
export function textHasLink(text: string): boolean {
  return LINK_PATTERN.test(text ?? "");
}

/** Collapses runs of whitespace and trims, exactly as the server stores it. */
export function cleanInviteMessage(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Null when the message can be sent; otherwise the sentence to show. */
export function inviteMessageProblem(text: string): string | null {
  const cleaned = cleanInviteMessage(text);
  if (cleaned.length < INVITE_MESSAGE_MIN || cleaned.length > INVITE_MESSAGE_MAX) return INVITE_LENGTH_MESSAGE;
  if (textHasLink(cleaned)) return INVITE_NO_LINKS_MESSAGE;
  return null;
}
