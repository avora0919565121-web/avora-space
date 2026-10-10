import { chipCounts, FILE_CHIPS, type CategorizableFile, type FileChip } from "@/lib/file-category";
import { cn } from "@/lib/utils";

/**
 * AVORA-73 · A — one row of filter chips under `File của tôi`, the same place, order and size on phone
 * and computer. Slides sideways when it does not fit; never wraps. Only chips that have files show,
 * each with its count. Tapping the active chip goes back to `Tất cả`.
 */
export function FileChipRow({ files, chip, onChip }: { files: readonly CategorizableFile[]; chip: FileChip; onChip: (chip: FileChip) => void }) {
  const counts = chipCounts(files);
  const shown = FILE_CHIPS.filter((c) => c.id === "all" || (counts.get(c.id) ?? 0) > 0);
  if (files.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Lọc theo loại tệp"
      data-file-chips=""
      data-h-scroll=""
      className="flex gap-1.5 overflow-x-auto border-b border-border px-3 py-2 [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)] [scrollbar-width:none]"
    >
      {shown.map((c) => {
        const isOn = chip === c.id;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={isOn}
            data-file-chip={c.id}
            onClick={() => onChip(isOn && c.id !== "all" ? "all" : c.id)}
            className={cn(
              "press inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium",
              isOn ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground",
            )}
          >
            {c.label}
            {c.id !== "all" ? <span className={cn("tabular-nums", isOn ? "opacity-80" : "text-muted-foreground")}>{counts.get(c.id)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
