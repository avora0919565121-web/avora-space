import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/lib/log";
import { normalizeSearch } from "@/lib/normalize-search";

/**
 * Tìm kiếm toàn AVORA (ADR-032). One search for everything the person may see; the server's RLS
 * decides what that is. Két sắt / Tài chính never take part (they search inside Két sắt only).
 */

export type SearchKind = "message" | "file" | "task" | "note" | "record" | "table" | "contact" | "conversation";

export type SearchTab = "ket-noi" | "nhat-ky" | "nhiem-vu" | "ke-hoach" | "avora-space";

export type SearchHere = { tab: SearchTab; conversationId?: string | null; label: string };

export type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string | null;
  snippet: string | null;
  placeKind: string;
  placeId: string | null;
  placeName: string;
  conversationId: string | null;
  at: string;
  inHere: boolean;
  scope: "personal" | "direct" | "group" | "project";
};

export const SEARCH_TYPE_FILTERS: readonly { id: "all" | SearchKind; label: string; kinds: readonly SearchKind[] | null }[] = [
  { id: "all", label: "Tất cả", kinds: null },
  { id: "message", label: "Tin nhắn", kinds: ["message", "conversation"] },
  { id: "file", label: "Tệp", kinds: ["file"] },
  { id: "task", label: "Nhiệm vụ", kinds: ["task"] },
  { id: "note", label: "Ghi chép", kinds: ["note"] },
  { id: "record", label: "Hạng mục", kinds: ["record", "table"] },
  { id: "contact", label: "Liên hệ", kinds: ["contact"] },
];

export const SCOPE_LABELS: Readonly<Record<SearchResult["scope"], string>> = {
  personal: "Cá nhân",
  direct: "1-1",
  group: "Nhóm",
  project: "Dự án",
};

export const MIN_QUERY_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 250;

type Row = {
  kind: string; id: string; title: string | null; snippet: string | null; place_kind: string; place_id: string | null;
  place_name: string; conversation_id: string | null; at: string; in_here: boolean; scope: string;
};

export async function searchAvora(query: string, here: SearchHere, kinds: readonly SearchKind[] | null): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("search_avora", {
    p_query: query,
    p_here: { tab: here.tab, conversation_id: here.conversationId ?? null },
    p_types: kinds === null ? undefined : [...kinds],
    p_limit: 20,
  });
  if (error) {
    logError("search", { code: error.code, message: error.message });
    throw new Error("Chưa tìm được lúc này. Kiểm tra mạng và thử lại.");
  }
  return ((data ?? []) as Row[]).map((row) => ({
    kind: row.kind as SearchKind,
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    placeKind: row.place_kind,
    placeId: row.place_id,
    placeName: row.place_name,
    conversationId: row.conversation_id,
    at: row.at,
    inHere: row.in_here === true,
    scope: (["personal", "direct", "group", "project"].includes(row.scope) ? row.scope : "personal") as SearchResult["scope"],
  }));
}

/** Results of where the person stands first, then everything else; each part newest first. */
export function splitResults(results: readonly SearchResult[]): { here: SearchResult[]; elsewhere: SearchResult[] } {
  const seen = new Set<string>();
  const unique = results.filter((result) => {
    const key = `${result.kind}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const byTime = (a: SearchResult, b: SearchResult): number => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  return {
    here: unique.filter((result) => result.inHere).sort(byTime),
    elsewhere: unique.filter((result) => !result.inHere).sort(byTime),
  };
}

/**
 * The text split into plain and matching parts, accent-free, for the bold highlight. Works on the
 * original characters so "báo giá" is bolded when "bao gia" was typed.
 */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const words = normalizeSearch(query).split(" ").filter((word) => word.length > 0);
  if (words.length === 0 || text === "") return [{ text, match: false }];
  // Fold character by character so positions stay aligned with the original.
  const folded = [...text].map((char) => normalizeSearch(char) || char.toLowerCase().replace(/\s/, " "));
  const flat = folded.join("");
  const offsets: number[] = [];
  let pos = 0;
  for (const part of folded) {
    offsets.push(pos);
    pos += part.length;
  }
  const marks = new Array<boolean>(folded.length).fill(false);
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = flat.indexOf(word, from);
      if (at < 0) break;
      for (let i = 0; i < folded.length; i += 1) {
        const start = offsets[i];
        const end = start + folded[i].length;
        if (end > at && start < at + word.length) marks[i] = true;
      }
      from = at + word.length;
    }
  }
  const chars = [...text];
  const parts: { text: string; match: boolean }[] = [];
  chars.forEach((char, index) => {
    const last = parts[parts.length - 1];
    if (last !== undefined && last.match === marks[index]) last.text += char;
    else parts.push({ text: char, match: marks[index] });
  });
  return parts;
}

/** A short piece of the snippet around the first match, so the match is visible. */
export function aroundMatch(text: string, query: string, radius = 60): string {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const folded = normalizeSearch(text);
  const at = words.length === 0 ? -1 : folded.indexOf(words[0]);
  if (at < 0 || text.length <= radius * 2) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + radius * 2)}${start + radius * 2 < text.length ? "…" : ""}`;
}

/** Where a result opens, in the app's own addresses. */
export function resultHref(result: SearchResult, journalId: string | null): string | null {
  switch (result.kind) {
    case "message":
    case "file":
      return result.conversationId === null ? null : `/tin-nhan/${result.conversationId}?toi=${encodeURIComponent(result.id)}`;
    case "conversation":
      return `/tin-nhan/${result.id}`;
    case "task":
      return `/nhiem-vu?muc=viec&mo=${encodeURIComponent(result.id)}`;
    case "note":
      return journalId === null ? null : `/tin-nhan/${journalId}?xem=ghi-chep&ghi-chep=${encodeURIComponent(result.id)}`;
    case "record":
      return `/ke-hoach?bang=${encodeURIComponent(result.placeId ?? "")}&hang-muc=${encodeURIComponent(result.id)}`;
    case "table":
      return `/ke-hoach?bang=${encodeURIComponent(result.id)}`;
    case "contact":
      return `/lien-he/${result.id}`;
    default:
      return null;
  }
}
