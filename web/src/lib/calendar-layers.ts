/**
 * Layers on Lịch Avora (AVORA-39 / Phần 2 · A4).
 *
 * Avora's own work is the clearest layer and always sits on top. Any other calendar the person
 * chooses to show — none exist yet; see DESIGN.md, "Lịch ngoài" — is one neutral, faint layer
 * underneath, told apart by its source name in words, never by a colour per calendar. Read-only:
 * nothing from an outside calendar can be edited here or turned into a task.
 *
 * Every source is mapped into one shape through `toCalendarEntry` ("ánh xạ vào A-Calendar"), so the
 * calendar only ever reads one kind of data whatever it came from.
 */
export type CalendarLayer = "avora" | "external";

export type CalendarLayerEntry = {
  id: string;
  layer: CalendarLayer;
  /** "Avora", or the outside calendar's own name ("Công việc", "Gia đình"…). */
  sourceName: string;
  day: string;
  title: string;
  /** `HH:MM`, or null for an all-day item. */
  startTime: string | null;
  endTime: string | null;
  /** A place or a meeting link, shown as-is. */
  where: string | null;
  /** Avora only: whether it is an event block or a deadline marker. */
  avoraKind: "event" | "deadline" | null;
};

/** What an outside source hands over, before mapping. */
export type ExternalCalendarItem = {
  id: string;
  title: string;
  day: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  url?: string | null;
};

export type CalendarSource = { layer: "external"; name: string } | { layer: "avora" };

/** Maps any source's item into the one shape Lịch Avora reads. */
export function toCalendarEntry(
  source: CalendarSource,
  item: ExternalCalendarItem & { avoraKind?: "event" | "deadline" },
): CalendarLayerEntry {
  return {
    id: `${source.layer}:${item.id}`,
    layer: source.layer,
    sourceName: source.layer === "avora" ? "Avora" : source.name,
    day: item.day,
    title: item.title.trim() === "" ? "(Không có tiêu đề)" : item.title,
    startTime: item.startTime ?? null,
    endTime: item.endTime ?? null,
    where: item.location ?? item.url ?? null,
    avoraKind: source.layer === "avora" ? (item.avoraKind ?? "deadline") : null,
  };
}

/** One day's list: Avora first, then Lịch khác; each by time, all-day items first. */
export function orderDayEntries(entries: readonly CalendarLayerEntry[]): CalendarLayerEntry[] {
  const rank = (entry: CalendarLayerEntry): number => (entry.layer === "avora" ? 0 : 1);
  return [...entries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
      a.title.localeCompare(b.title, "vi"),
  );
}

/**
 * How a mark is drawn in a day cell. Avora keeps its colours and full strength; every outside
 * calendar shares one faint neutral outline and is drawn after (under) Avora's marks.
 */
export function layerMarkStyle(entry: CalendarLayerEntry): { className: string; opacity: number; z: number } {
  if (entry.layer === "external") return { className: "border border-muted-foreground/50 bg-transparent", opacity: 0.55, z: 0 };
  return entry.avoraKind === "event"
    ? { className: "bg-primary", opacity: 1, z: 1 }
    : { className: "bg-task-due-soon", opacity: 1, z: 1 };
}

/** The legend shows "Lịch khác" only when at least one outside calendar is on. */
export function hasExternalLayer(entries: readonly CalendarLayerEntry[]): boolean {
  return entries.some((entry) => entry.layer === "external");
}
