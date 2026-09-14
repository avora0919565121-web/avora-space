import { peerLabel } from "@/lib/initials";
import type { GroupMember } from "@/lib/groups";

/**
 * Naming someone inside a group message.
 *
 * A mention is stored as an id, never as the text "@Minh". Display names change, so re-reading
 * the text later could resolve to a different person or to nobody — and the notification rules
 * need an exact answer to "was I named in this?" rather than a guess made by re-parsing prose.
 *
 * So the text and the ids are written together at send time: the words are what people read,
 * the ids are what the app acts on, and neither is derived from the other afterwards.
 */

/** Someone who can be named, as the picker sees them. */
export type MentionCandidate = {
  userId: string;
  /** What is typed after "@" and shown in the message body. */
  name: string;
};

/** Everyone in the room except the person writing — naming yourself is not a mention. */
export function mentionCandidates(
  members: readonly GroupMember[],
  viewerId: string | undefined,
): MentionCandidate[] {
  return members
    .filter((member) => member.userId !== viewerId)
    .map((member) => ({ userId: member.userId, name: peerLabel(member.displayName, member.email) }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/**
 * The "@…" being typed right at the caret, if there is one.
 *
 * Only an "@" that starts a word counts, so an email address does not open the picker halfway
 * through. The query stops at whitespace: once someone types a space the mention is either
 * finished or abandoned, and a picker that kept matching across words would fight the sentence.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;

  // Must begin a word: start of the box, or preceded by whitespace.
  const before = at === 0 ? "" : upToCaret[at - 1];
  if (before !== "" && !/\s/.test(before)) return null;

  const query = upToCaret.slice(at + 1);
  // A space ends it. Names contain spaces, but the query does not — matching is by prefix of
  // each word instead, which is how people actually type a mention.
  if (/\s/.test(query)) return null;

  return { query, start: at };
}

/**
 * Candidates matching what has been typed so far.
 *
 * Matches any word of the name, not just the first: someone looking for "Nguyễn Văn Minh" is
 * as likely to type "minh" as "nguyen". Vietnamese comparison is case-insensitive here because
 * nobody capitalises correctly while typing mid-sentence.
 */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit: number = 6,
): MentionCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return candidates.slice(0, limit);
  return candidates
    .filter((candidate) => {
      const name = candidate.name.toLocaleLowerCase();
      if (name.startsWith(needle)) return true;
      return name.split(/\s+/).some((word) => word.startsWith(needle));
    })
    .slice(0, limit);
}

/**
 * Puts a chosen name into the draft, replacing the "@…" that was being typed.
 *
 * The trailing space matters: without it the caret sits against the name and the picker
 * immediately re-opens on the mention that was just completed.
 */
export function applyMention(
  text: string,
  range: { start: number; caret: number },
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const before = text.slice(0, range.start);
  const after = text.slice(range.caret);
  const inserted = `@${candidate.name} `;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/**
 * Which people the finished draft actually names.
 *
 * Read off the text at send time by looking for each candidate's name after an "@". Deleting
 * part of a mention un-names that person, which is what someone editing the sentence expects
 * — the ids follow the words rather than lingering after the words are gone.
 *
 * Longer names are matched first AND the characters they consume are then off limits. Order
 * alone is not enough: in "@An Nhiên" the shorter name "An" also matches at the very same
 * position, so without claiming the span both people would be recorded as named — one of them
 * wrongly, and that wrong id is what a notification would later act on.
 */
export function extractMentionedIds(
  text: string,
  candidates: readonly MentionCandidate[],
): string[] {
  const ordered = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  const lowered = text.toLocaleLowerCase();
  const claimed: boolean[] = new Array<boolean>(text.length).fill(false);

  const isFree = (from: number, length: number): boolean => {
    for (let index = from; index < from + length; index += 1) {
      if (claimed[index] === true) return false;
    }
    return true;
  };

  for (const candidate of ordered) {
    const needle = `@${candidate.name.toLocaleLowerCase()}`;
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(needle, from);
      if (at === -1) break;
      // The "@" must start a word, so an address like a@name does not count as naming someone.
      const before = at === 0 ? "" : lowered[at - 1];
      const startsWord = before === "" || /\s/.test(before);
      if (startsWord && isFree(at, needle.length)) {
        for (let index = at; index < at + needle.length; index += 1) claimed[index] = true;
        found.add(candidate.userId);
        break;
      }
      from = at + 1;
    }
  }

  return [...found];
}

/** One run of message text: either ordinary words, or a name that was mentioned. */
export type MessageSegment = {
  text: string;
  /** Set when this run is a mention; carries who was named. */
  mentionedUserId: string | null;
  /** True when the reader themselves was the one named. */
  isViewer: boolean;
};

/**
 * Splits a message into plain runs and mentioned names, for rendering.
 *
 * Driven by the stored ids rather than by scanning for "@" anywhere: only names that were
 * genuinely recorded as mentions light up, so typing "@nobody" cannot fake the appearance of
 * having named someone.
 */
export function splitMentions(
  content: string,
  mentionedUserIds: readonly string[],
  nameOf: (userId: string) => string,
  viewerId: string | undefined,
): MessageSegment[] {
  if (mentionedUserIds.length === 0) {
    return [{ text: content, mentionedUserId: null, isViewer: false }];
  }

  // Longest first, so a short name that is a prefix of a longer one cannot win the match.
  const named = mentionedUserIds
    .map((userId) => ({ userId, name: nameOf(userId) }))
    .filter((entry) => entry.name.trim() !== "")
    .sort((a, b) => b.name.length - a.name.length);

  const segments: MessageSegment[] = [];
  let rest = content;

  while (rest.length > 0) {
    let bestAt = -1;
    let best: { userId: string; name: string } | null = null;

    for (const entry of named) {
      const at = rest.toLocaleLowerCase().indexOf(`@${entry.name.toLocaleLowerCase()}`);
      if (at === -1) continue;
      if (bestAt === -1 || at < bestAt) {
        bestAt = at;
        best = entry;
      }
    }

    if (best === null || bestAt === -1) {
      segments.push({ text: rest, mentionedUserId: null, isViewer: false });
      break;
    }

    if (bestAt > 0) {
      segments.push({ text: rest.slice(0, bestAt), mentionedUserId: null, isViewer: false });
    }
    const length = best.name.length + 1;
    segments.push({
      text: rest.slice(bestAt, bestAt + length),
      mentionedUserId: best.userId,
      isViewer: best.userId === viewerId,
    });
    rest = rest.slice(bestAt + length);
  }

  return segments.filter((segment) => segment.text !== "");
}

/** True when this message names the reader — what the mute rules will ask in Prompt 10. */
export function mentionsViewer(
  mentionedUserIds: readonly string[] | null | undefined,
  viewerId: string | undefined,
): boolean {
  if (viewerId === undefined || mentionedUserIds == null) return false;
  return mentionedUserIds.includes(viewerId);
}
