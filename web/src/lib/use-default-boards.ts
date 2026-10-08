import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  hiddenBoardsOf,
  isVaultViewBoard,
  type AssignedItem,
  type DecisionItem,
  type ProjectSummary,
  type ViewBoardKey,
} from "@/lib/avora-default-boards";
import { fromB64, toB64 } from "@/lib/vault-crypto";
import { viewNoteKey } from "@/lib/vault-keys";
import { useHasMasterKey } from "@/lib/use-vault-e2ee";

/**
 * AVORA-81 · PHẦN 1 — data for Bảng xem: the three server reads (Kết nối / Nhiệm vụ boards), my
 * ★ + private note per row, and the hidden-board list in `profiles.prefs`.
 */
export const defaultBoardKeys = {
  decisions: ["view-board", "decisions"] as const,
  projects: ["view-board", "projects"] as const,
  assigned: ["view-board", "assigned"] as const,
  meta: (board: ViewBoardKey) => ["view-board", "meta", board] as const,
  prefs: (userId: string | undefined) => ["profile-prefs", userId ?? "none"] as const,
};

export function useMyDecisions(enabled: boolean) {
  return useQuery<DecisionItem[], Error>({
    queryKey: defaultBoardKeys.decisions,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_decisions");
      if (error) throw new Error("Không tải được Sổ quyết định.");
      return (data ?? []).map((row) => ({
        decisionId: row.decision_id,
        conversationId: row.conversation_id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        settledAt: row.settled_at,
        settledByName: row.settled_by_name,
      }));
    },
  });
}

export function useMyProjectsSummary(enabled: boolean) {
  return useQuery<ProjectSummary[], Error>({
    queryKey: defaultBoardKeys.projects,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_projects_summary");
      if (error) throw new Error("Không tải được Dự án của tôi.");
      return (data ?? []).map((row) => ({
        projectId: row.project_id,
        conversationId: row.conversation_id,
        parentGroupId: row.parent_group_id,
        title: row.title,
        status: row.status,
        total: Number(row.total),
        done: Number(row.done),
        overdue: Number(row.overdue),
      }));
    },
  });
}

export function useAssignedByMe(enabled: boolean) {
  return useQuery<AssignedItem[], Error>({
    queryKey: defaultBoardKeys.assigned,
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_assigned_by_me");
      if (error) throw new Error("Không tải được Việc tôi giao.");
      return (data ?? []).map((row) => ({
        kind: row.kind === "suggestion" ? "suggestion" : "task",
        itemId: row.item_id,
        conversationId: row.conversation_id,
        title: row.title,
        assigneeId: row.assignee_id,
        assigneeName: row.assignee_name,
        deadline: row.deadline,
        status: row.status,
        doneAt: row.done_at,
      }));
    },
  });
}

// ------------------------------------------------------------------ ★ + note

export type RowMeta = { starred: boolean; note: string | null };

const enc = new TextEncoder();
const dec = new TextDecoder();

async function sealNote(userId: string, board: ViewBoardKey, sourceKey: string, note: string): Promise<string> {
  const key = await viewNoteKey(userId);
  if (key === null) throw new Error("Mở Két sắt để ghi chú.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`${board}|${sourceKey}`) }, key, enc.encode(note)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

async function openNote(userId: string, board: ViewBoardKey, sourceKey: string, sealed: string): Promise<string | null> {
  const key = await viewNoteKey(userId);
  if (key === null) return null;
  try {
    const all = fromB64(sealed);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: enc.encode(`${board}|${sourceKey}`) }, key, all.slice(12));
    return dec.decode(plain);
  } catch {
    return null;
  }
}

/** My ★ and note on every row of one view board. Rows whose source is gone are simply never shown. */
export function useRowMeta(board: ViewBoardKey) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const hasKey = useHasMasterKey();
  const vault = isVaultViewBoard(board);
  const query = useQuery<Map<string, RowMeta>, Error>({
    queryKey: [...defaultBoardKeys.meta(board), vault && hasKey ? "open" : "closed"],
    enabled: Boolean(user?.id) && (!vault || hasKey),
    gcTime: vault ? 0 : undefined,
    queryFn: async () => {
      // rows-bounded: one default board (≤ its rows, which are capped at 1 000)
      const { data, error } = await supabase.from("think_hub_view_row_meta").select("source_key, starred, note, note_sealed").eq("board_key", board);
      if (error) throw new Error("Không tải được ghi chú.");
      const map = new Map<string, RowMeta>();
      for (const row of data ?? []) {
        const note = vault ? (row.note_sealed === null ? null : await openNote(user?.id as string, board, row.source_key, row.note_sealed)) : row.note;
        map.set(row.source_key, { starred: row.starred, note });
      }
      return map;
    },
  });
  const save = useMutation({
    mutationFn: async (input: { sourceKey: string; starred: boolean; note: string | null }) => {
      const userId = user?.id;
      if (userId === undefined) throw new Error("Phiên đăng nhập đã hết hạn.");
      const clean = input.note === null || input.note.trim() === "" ? null : input.note.trim().slice(0, 500);
      const row = {
        user_id: userId,
        board_key: board,
        source_key: input.sourceKey,
        starred: input.starred,
        note: vault ? null : clean,
        note_sealed: vault && clean !== null ? await sealNote(userId, board, input.sourceKey, clean) : null,
      };
      const { error } = await supabase.from("think_hub_view_row_meta").upsert(row, { onConflict: "user_id,board_key,source_key" });
      if (error) throw new Error("Không lưu được.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: defaultBoardKeys.meta(board) }),
  });
  return { meta: query.data ?? new Map<string, RowMeta>(), save };
}

// ------------------------------------------------------------------ hidden boards (profiles.prefs)

export function useProfilePrefs() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery<Record<string, unknown>, Error>({
    queryKey: defaultBoardKeys.prefs(user?.id),
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("prefs").eq("id", user?.id as string).maybeSingle();
      if (error) return {};
      return (data?.prefs as Record<string, unknown> | null) ?? {};
    },
  });
  const prefs = useMemo(() => query.data ?? {}, [query.data]);
  const setPref = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      const userId = user?.id;
      if (userId === undefined) return;
      const next = { ...(queryClient.getQueryData<Record<string, unknown>>(defaultBoardKeys.prefs(userId)) ?? {}), [key]: value };
      queryClient.setQueryData(defaultBoardKeys.prefs(userId), next);
      const { error } = await supabase.from("profiles").update({ prefs: next as never }).eq("id", userId);
      if (error) {
        void queryClient.invalidateQueries({ queryKey: defaultBoardKeys.prefs(userId) });
        throw new Error("Không lưu được cài đặt.");
      }
    },
    [user?.id, queryClient],
  );
  return { prefs, isLoaded: query.data !== undefined, setPref };
}

export function useHiddenBoards() {
  const { prefs, setPref } = useProfilePrefs();
  const hidden = useMemo(() => hiddenBoardsOf(prefs), [prefs]);
  const hide = useCallback((key: ViewBoardKey) => setPref("hidden_boards", [...new Set([...hidden, key])]), [hidden, setPref]);
  const show = useCallback((key: ViewBoardKey) => setPref("hidden_boards", hidden.filter((item) => item !== key)), [hidden, setPref]);
  return { hidden, hide, show };
}
