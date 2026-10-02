import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchOpportunityBoardRows, type OpportunityBoardRow } from "@/lib/opportunities";
import { fetchOpportunityBoardId } from "@/lib/opportunity-board";

export const opportunityBoardKeys = {
  rows: ["opportunity-board", "rows"] as const,
  id: ["opportunity-board", "id"] as const,
};

/** AVORA-72: every opportunity with its live contact — the synced layer of the board. */
export function useOpportunityBoardRows(enabled: boolean): { rows: OpportunityBoardRow[]; byId: Map<string, OpportunityBoardRow> } {
  const query = useQuery({ queryKey: opportunityBoardKeys.rows, queryFn: fetchOpportunityBoardRows, enabled, staleTime: 20_000 });
  const rows = query.data ?? [];
  return { rows, byId: new Map(rows.map((row) => [row.id, row] as const)) };
}

/** The id of my `Danh bạ | Danh sách cơ hội` (created on first ask). */
export function useOpportunityBoardId(): string | undefined {
  return useQuery({ queryKey: opportunityBoardKeys.id, queryFn: fetchOpportunityBoardId, staleTime: Infinity }).data;
}

export function useInvalidateOpportunityBoard(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["opportunity-board"] });
    void queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    void queryClient.invalidateQueries({ queryKey: ["think-hub"] });
  };
}
