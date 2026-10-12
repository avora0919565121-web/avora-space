import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { disappearKeys, setHideTombstones, type DisappearState } from "@/lib/disappear";

/** B4 — `Dọn` on a tombstone: hide every tombstone of this conversation on my screen, with 5 s `Hoàn tác`. */
export function useTidyTombstones(conversationId: string | undefined): () => void {
  const queryClient = useQueryClient();
  return () => {
    if (conversationId === undefined) return;
    const key = disappearKeys.state(conversationId);
    const apply = async (value: boolean): Promise<void> => {
      queryClient.setQueryData<DisappearState>(key, (old) => (old === undefined ? old : { ...old, hideTombstones: value }));
      try {
        await setHideTombstones(conversationId, value);
      } catch (error) {
        toast.error((error as Error).message);
      }
      await queryClient.invalidateQueries({ queryKey: key });
    };
    void apply(true);
    toast("Đã dọn dấu vết trên màn hình của bạn.", { duration: 5000, action: { label: "Hoàn tác", onClick: () => void apply(false) } });
  };
}
