import { useMemo } from "react";

import {
  assetRows,
  assignedByPerson,
  assignedRows,
  cashflowByMonth,
  cashflowRows,
  decisionRows,
  expiringRows,
  loanRows,
  memorableDays,
  paymentRows,
  projectRows,
  summaryRows,
  type AssignedItem,
  viewBoardOf,
  type ViewBoardKey,
  type ViewRow,
} from "@/lib/avora-default-boards";
import { conversationTitle } from "@/lib/chat-cache";
import { todayIso } from "@/lib/finance";
import { useAssignedByMe, useHiddenBoards, useMyDecisions, useMyProjectsSummary } from "@/lib/use-default-boards";
import { useContacts } from "@/lib/use-contacts";
import { useConversations } from "@/lib/use-conversations";
import { useLedger } from "@/lib/use-finance";
import { useHasMasterKey, useKeyring, useVaultItems } from "@/lib/use-vault-e2ee";
import { useVaultUnlocked } from "@/lib/use-vault-lock";

export type BoardRows = { rows: ViewRow[]; locked: boolean; isLoading: boolean; error: string | null };

/**
 * AVORA-81 · PHẦN 1 — every view board's rows, read live. Két sắt boards are computed here, on the
 * device, from the ledger and the decrypted vault items; while Két sắt is locked they report
 * `locked` and hold no rows at all (nothing is fetched).
 */
export function useViewBoardRows(options: { paymentMonth?: "this" | "next" } = {}) {
  const today = todayIso();
  const isVaultOpen = useVaultUnlocked();
  const hasKey = useHasMasterKey();
  const { ring } = useKeyring();
  const decisions = useMyDecisions(true);
  const projects = useMyProjectsSummary(true);
  const assigned = useAssignedByMe(true);
  const contacts = useContacts();
  const conversations = useConversations();
  const ledger = useLedger();
  const certificates = useVaultItems("certificates", ring);
  const documents = useVaultItems("documents", ring);
  const assets = useVaultItems("assets", ring);

  const placeOf = useMemo(() => {
    const map = new Map((conversations.data ?? []).map((summary) => [summary.conversationId, conversationTitle(summary)] as const));
    return (id: string | null): string => (id === null ? "" : (map.get(id) ?? ""));
  }, [conversations.data]);
  const contactName = useMemo(() => {
    const map = new Map((contacts.data ?? []).map((contact) => [contact.id, contact.name] as const));
    return (id: string | null): string => (id === null ? "" : (map.get(id) ?? ""));
  }, [contacts.data]);

  const vaultItems = useMemo(() => [...certificates.items, ...documents.items, ...assets.items], [certificates.items, documents.items, assets.items]);
  const assetResult = useMemo(() => assetRows(vaultItems), [vaultItems]);
  const paymentMonth = options.paymentMonth ?? "this";

  const boards: Record<ViewBoardKey, BoardRows> = useMemo(() => {
    const financeLocked = !isVaultOpen;
    const itemsLocked = !isVaultOpen || !hasKey;
    const fin = (rows: () => ViewRow[]): BoardRows =>
      financeLocked ? { rows: [], locked: true, isLoading: false, error: null } : { rows: ledger.isLoading ? [] : rows(), locked: false, isLoading: ledger.isLoading, error: ledger.error?.message ?? null };
    const vault = (rows: () => ViewRow[]): BoardRows =>
      itemsLocked ? { rows: [], locked: true, isLoading: false, error: null } : { rows: rows(), locked: false, isLoading: certificates.isPending || documents.isPending || assets.isPending, error: null };
    return {
      decisions: { rows: decisionRows(decisions.data ?? [], (id) => placeOf(id)), locked: false, isLoading: decisions.isPending, error: decisions.error?.message ?? null },
      memorable_days: { rows: memorableDays(contacts.data ?? [], today), locked: false, isLoading: contacts.isPending, error: contacts.error?.message ?? null },
      my_projects: { rows: projectRows(projects.data ?? [], placeOf), locked: false, isLoading: projects.isPending, error: projects.error?.message ?? null },
      assigned_by_me: { rows: assignedRows(assigned.data ?? [], today), locked: false, isLoading: assigned.isPending, error: assigned.error?.message ?? null },
      cashflow: fin(() => cashflowRows(ledger.entries)),
      summary: fin(() => summaryRows(ledger.accounts, ledger.baseEntries, 6, today, hasKey ? assetResult.totalCents : null)),
      loans: fin(() => loanRows(ledger.entries, contactName, today)),
      payment_calendar: fin(() => paymentRows(ledger.entries, today, paymentMonth)),
      expiring_docs: vault(() => expiringRows(vaultItems, today)),
      assets: vault(() => assetResult.rows),
    };
  }, [isVaultOpen, hasKey, ledger, decisions.data, decisions.isPending, decisions.error, contacts.data, contacts.isPending, contacts.error, projects.data, projects.isPending, projects.error, assigned.data, assigned.isPending, assigned.error, placeOf, contactName, today, vaultItems, assetResult, paymentMonth, certificates.isPending, documents.isPending, assets.isPending]);

  const byMonth = useMemo(() => (isVaultOpen ? cashflowByMonth(ledger.baseEntries) : []), [isVaultOpen, ledger.baseEntries]);
  const byPerson = useMemo(() => assignedByPerson((assigned.data ?? []) as AssignedItem[], today), [assigned.data, today]);

  return { boards, byMonth, byPerson, currency: ledger.currency, assetsValued: assetResult.totalCents !== null };
}

/** Whether any system board needs attention now — the Avora lập sẵn line turns accent. */
export function useDefaultShelfAttention(): boolean {
  const isVaultOpen = useVaultUnlocked();
  const { boards } = useViewBoardRows();
  const { hidden } = useHiddenBoards();
  return (Object.keys(boards) as ViewBoardKey[]).some(
    (key) => !hidden.includes(key) && (isVaultOpen || viewBoardOf(key).zone !== "ket-sat") && boards[key].rows.some((row) => row.hot === true),
  );
}
