import { Eye } from "lucide-react";
import { toast } from "sonner";

import { viewBoardOf } from "@/lib/avora-default-boards";
import { useHiddenBoards } from "@/lib/use-default-boards";

/**
 * Cài đặt › Kế hoạch (AVORA-81 · 78.12): the Bảng Avora lập sẵn a person hid, each with `Hiện lại`.
 * Nothing hidden → one quiet line.
 */
export function PlanBoardsCard() {
  const { hidden, show } = useHiddenBoards();
  return (
    <section aria-labelledby="plan-boards-heading" className="rounded-card border border-border bg-card p-s-4" data-plan-boards-card="">
      <h2 id="plan-boards-heading" className="text-[16px] font-semibold text-foreground">Kế hoạch</h2>
      <p className="mt-1 text-[13.5px] text-muted-foreground">Bảng Avora lập sẵn bạn đã ẩn.</p>
      {hidden.length === 0 ? (
        <p className="mt-s-2 text-[14px] text-muted-foreground">Không có bảng nào đang ẩn.</p>
      ) : (
        <ul className="mt-s-2">
          {hidden.map((key) => (
            <li key={key} className="flex items-center gap-3 border-t border-border/60 py-2.5">
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{viewBoardOf(key).name}</span>
              <button
                type="button"
                onClick={() => void show(key).then(() => toast.success("Đã hiện lại trong Kế hoạch.")).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được."))}
                className="press inline-flex h-10 items-center gap-1.5 rounded-md border border-border px-3 text-[13.5px]"
              >
                <Eye className="h-4 w-4" aria-hidden="true" /> Hiện lại
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
