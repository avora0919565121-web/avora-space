import { Check, ChevronDown, ChevronRight, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { TablePlace } from "@/lib/table-places";
import type { ThinkTable } from "@/lib/think-hub";
import { audienceLabel, foundationTemplates, libraryTemplates, PICKABLE_ROLES, roleGroups, SENSITIVE_TEMPLATES, TEMPLATE_AUDIENCES, THINKING_TYPES, type BoardTemplate, type TemplateAudience, type ThinkingType } from "@/lib/think-hub-shelf";
import { foldVi } from "@/lib/context-refs";
import { useShelfActions } from "@/lib/use-think-hub-shelf";
import { cn } from "@/lib/utils";

/**
 * AVORA-89 · 2.4b — Mẫu bảng library (a focus screen): "để làm gì" × "dành cho ai". Tap a card →
 * preview with two example rows (display only, never saved) → `Dùng mẫu này` → choose where → create.
 */
export function TemplateLibrary({
  templates,
  mine,
  usedAt,
  places,
  onCreated,
  onChangeRoles,
}: {
  templates: readonly BoardTemplate[];
  mine: readonly TemplateAudience[];
  usedAt: ReadonlyMap<string, string>;
  places: readonly TablePlace[];
  onCreated: (table: ThinkTable) => void;
  /** AVORA-100 · V·1.3: `Vai trò của tôi: n · Đổi` reopens the role sheet. */
  onChangeRoles?: () => void;
}) {
  const [isAllOpen, setIsAllOpen] = useState<boolean>(false);
  const foundation = useMemo(() => foundationTemplates(templates), [templates]);
  const groups = useMemo(() => roleGroups(templates, mine), [templates, mine]);
  const groupCount = groups.reduce((sum, group) => sum + group.templates.length, 0);
  const row = (template: BoardTemplate, attr: Record<string, string>) => (
    <li key={template.id} className="flex min-h-[52px] items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
        <Table2 className="h-4 w-4" aria-hidden="true" />
      </span>
      <button type="button" onClick={() => (template.id === "blank" ? setPlacing(template) : setPreview(template))} className="press min-w-0 flex-1 text-left" {...attr}>
        <span className="block truncate text-[15px] font-semibold text-foreground">{template.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {template.id === "blank" ? "Tự đặt cột" : [template.titleLabel, ...template.columns.map((column) => column.label)].join(" · ").toLowerCase()}
        </span>
      </button>
      <button type="button" onClick={() => setPlacing(template)} className="press h-10 shrink-0 rounded-lg px-2.5 text-[13.5px] font-semibold text-personal">Dùng</button>
    </li>
  );
  const [type, setType] = useState<ThinkingType | null>(null);
  const [audiences, setAudiences] = useState<TemplateAudience[]>(() => [...mine]);
  const [query, setQuery] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [preview, setPreview] = useState<BoardTemplate | null>(null);
  const [placing, setPlacing] = useState<BoardTemplate | null>(null);
  const ownTemplates = templates.filter((template) => template.source === "mine");
  const blank = templates.find((template) => template.id === "blank");
  const list = useMemo(() => {
    const all = libraryTemplates(templates, { type, audiences }, mine, usedAt);
    const needle = foldVi(query.trim());
    return needle === "" ? all : all.filter((template) => foldVi(`${template.name} ${template.whenToUse ?? ""}`).includes(needle));
  }, [templates, type, audiences, mine, usedAt, query]);
  const audienceOrder = [...PICKABLE_ROLES].sort((a, b) => Number(mine.includes(b.id)) - Number(mine.includes(a.id)));
  const toggle = (id: TemplateAudience): void => setAudiences((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const chip = (isOn: boolean) => cn("press h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13.5px]", isOn ? "border-personal bg-personal font-semibold text-personal-foreground" : "border-border bg-card text-foreground");

  return (
    <div data-template-library="">
      <div className="flex items-center justify-between gap-2" data-my-roles="">
        <p className="text-[13px] text-muted-foreground">
          Vai trò của tôi: <b className="tabular font-semibold text-foreground">{mine.filter((id) => id !== "moi_nguoi").length}</b>
        </p>
        {onChangeRoles !== undefined ? (
          <button type="button" onClick={onChangeRoles} className="press h-10 rounded-md px-2 text-[13.5px] font-semibold text-personal">Đổi</button>
        ) : null}
      </div>
      <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Nền tảng · ai cũng dùng <span className="tabular">{foundation.length}</span>
      </h3>
      <ul className="mt-1.5 overflow-hidden rounded-xl border border-border bg-card" data-foundation="">
        {foundation.map((template) => row(template, { "data-foundation-card": template.id }))}
      </ul>
      {groups.length > 0 ? (
        <>
          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Hợp với vai trò của bạn <span className="tabular">{groupCount}</span>
          </h3>
          <div className="mt-1.5 overflow-hidden rounded-xl border border-border bg-card" data-role-groups="">
            {groups.map((group) => (
              <section key={group.role} data-role-group={group.role}>
                <p className="px-3 pt-2.5 text-[12.5px] font-semibold text-personal">{audienceLabel(group.role)}</p>
                <ul>{group.templates.map((template) => row(template, { "data-role-card": template.id }))}</ul>
              </section>
            ))}
          </div>
        </>
      ) : (
        <button type="button" onClick={onChangeRoles} data-pick-roles-hint="" className="press mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-dashed border-border px-3 text-left text-[13.5px] text-muted-foreground">
          Chọn vai trò để thấy mẫu hợp với bạn <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setIsAllOpen((open) => !open)}
        aria-expanded={isAllOpen}
        data-all-templates=""
        className="press mt-5 flex min-h-11 w-full items-center justify-between border-t border-border pt-2 text-[14.5px] font-semibold text-foreground"
      >
        Tất cả mẫu {isAllOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
      </button>
      {isAllOpen ? (
      <div className="mt-2" data-all-templates-body="">
      {isSearching ? (
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mẫu…" aria-label="Tìm mẫu" className="mb-3 h-11 w-full rounded-xl border border-border bg-card px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]" />
      ) : (
        <button type="button" onClick={() => setIsSearching(true)} aria-label="Tìm mẫu" className="press mb-2 flex h-10 items-center gap-1.5 text-[13px] text-muted-foreground">
          <Search className="h-4 w-4" aria-hidden="true" /> Tìm mẫu
        </button>
      )}
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Bạn dùng bảng để làm gì?</p>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [scrollbar-width:none]" data-filter-type="">
        <button type="button" onClick={() => setType(null)} aria-pressed={type === null} className={chip(type === null)}>Tất cả</button>
        {THINKING_TYPES.map((item) => (
          <button key={item.id} type="button" onClick={() => setType(type === item.id ? null : item.id)} aria-pressed={type === item.id} className={chip(type === item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Dành cho{mine.length > 0 ? <span className="normal-case tracking-normal"> · của bạn đứng trước</span> : null}
      </p>
      <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [scrollbar-width:none]" data-filter-audience="">
        {audienceOrder.map((item) => (
          <button key={item.id} type="button" onClick={() => toggle(item.id)} aria-pressed={audiences.includes(item.id)} data-audience={item.id} className={chip(audiences.includes(item.id))}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground" data-template-count="">
        {list.length} mẫu{audiences.length > 0 ? ` hợp với ${audiences.map((id) => TEMPLATE_AUDIENCES.find((item) => item.id === id)?.label).join(" · ")}` : ""}
      </p>

      {blank !== undefined ? (
        <button type="button" onClick={() => setPlacing(blank)} data-template-blank="" className="press mt-3 flex h-12 w-full items-center justify-center rounded-xl border border-dashed border-border text-[14.5px] text-foreground">
          + Bảng trống — tự đặt cột
        </button>
      ) : null}
      {ownTemplates.length > 0 ? (
        <>
          <h3 className="mt-4 text-[12.5px] font-semibold text-muted-foreground">Mẫu của tôi</h3>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[repeat(2,minmax(0,1fr))]">
            {ownTemplates.map((template) => (
              <li key={template.id} className="min-w-0">
                <button type="button" onClick={() => setPlacing(template)} className="press w-full rounded-xl border border-border bg-card px-4 py-3 text-left">
                  <span className="block truncate text-[15px] font-semibold">{template.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">Cột: {template.columns.map((column) => column.label).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2.5 md:grid-cols-[repeat(2,minmax(0,1fr))]">
        {list.map((template) => (
          <li key={template.id} className="min-w-0">
            <button type="button" onClick={() => setPreview(template)} data-template-card={template.id} className="press w-full rounded-2xl border border-border bg-card px-4 py-3 text-left">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">{template.name}</span>
                <span className="shrink-0 text-[12.5px] font-semibold text-personal">{THINKING_TYPES.find((item) => item.id === template.thinkingType)?.label}</span>
              </span>
              {template.whenToUse !== null ? <span className="mt-0.5 block text-[13px] text-foreground/85">Dùng khi {template.whenToUse.charAt(0).toLowerCase() + template.whenToUse.slice(1)}</span> : null}
              {template.guidingQuestion !== null ? <span className="mt-0.5 block text-[13px] italic text-muted-foreground">“{template.guidingQuestion}”</span> : null}
              <span className="mt-1 block truncate text-[12px] text-muted-foreground">Cột: {[template.titleLabel, ...template.columns.map((column) => column.label)].join(" · ")}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {template.audiences.map((id) => (
                  <span key={id} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{TEMPLATE_AUDIENCES.find((item) => item.id === id)?.label}</span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      </div>
      ) : null}

      <Sheet open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[85dvh] max-w-xl overflow-y-auto rounded-t-2xl" data-template-preview="">
          {preview !== null ? (
            <>
              <SheetTitle className="text-[18px]">{preview.name}</SheetTitle>
              <SheetDescription className="text-[13.5px] italic">“{preview.guidingQuestion ?? "Tự đặt cột và trạng thái."}”</SheetDescription>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ví dụ · chỉ để xem, không lưu</p>
              <div className="mt-1.5 overflow-x-auto rounded-xl border border-border" data-no-room-swipe="">
                <table className="w-full min-w-[420px] text-left text-[13px]">
                  <thead className="bg-secondary/60 text-[12px] text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-2 font-medium">{preview.titleLabel}</th>
                      {preview.columns.map((column) => <th key={column.label} className="px-2.5 py-2 font-medium">{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.exampleRows.map((row, index) => (
                      <tr key={index} className="border-t border-border/60" data-example-row="">
                        <td className="px-2.5 py-2">{row.title}</td>
                        {preview.columns.map((column) => <td key={column.label} className="px-2.5 py-2 text-muted-foreground">{row[column.label] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPlacing(preview);
                  setPreview(null);
                }}
                className="press mt-4 h-11 w-full rounded-xl bg-personal text-[14.5px] font-semibold text-personal-foreground"
              >
                Dùng mẫu này
              </button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <PlacePicker template={placing} places={places} onClose={() => setPlacing(null)} onCreated={onCreated} />
    </div>
  );
}

/** Where the new board lives — only places I may create in (the server checks again). */
export function PlacePicker({ template, places, onClose, onCreated }: { template: BoardTemplate | null; places: readonly TablePlace[]; onClose: () => void; onCreated: (table: ThinkTable) => void }) {
  const { fromTemplate } = useShelfActions();
  const [name, setName] = useState<string>("");
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (template !== null && shownFor !== template.id) {
    setShownFor(template.id);
    setName(template.id === "blank" ? "" : template.name);
  }
  const create = async (place: TablePlace): Promise<void> => {
    if (template === null || name.trim() === "") return;
    try {
      const table = await fromTemplate.mutateAsync({ template, conversationId: place.conversationId, name: name.trim() });
      onClose();
      onCreated(table);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Không tạo được bảng.");
    }
  };
  return (
    <Sheet open={template !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[70dvh] max-w-lg overflow-y-auto rounded-t-2xl" data-place-picker="">
        <SheetTitle className="text-[17px]">{template?.id === "blank" ? "Bảng trống" : `“${template?.name ?? ""}”`} — đặt ở đâu?</SheetTitle>
        <SheetDescription className="text-[13px]">Cá nhân · 1-1 · Nhóm · Dự án — chỉ nơi bạn có quyền tạo.</SheetDescription>
        <label className="mt-2 block">
          <span className="text-[13px] font-medium">Tên Bảng</span>
          <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-[16px] outline-none focus:border-personal md:text-[14.5px]" />
        </label>
        {template !== null && SENSITIVE_TEMPLATES.has(template.id) ? (
          <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-[12.5px] text-muted-foreground" data-sensitive-note="">
            Bảng này có chuyện riêng của người khác — chỉ chia sẻ với người cần biết.
          </p>
        ) : null}
        <ul className="mt-2">
          {places.map((place) => (
            <li key={place.conversationId ?? "personal"} className="border-b border-border/60 last:border-b-0">
              <button type="button" disabled={fromTemplate.isPending || name.trim() === ""} onClick={() => void create(place)} data-place={place.conversationId ?? "personal"} className="press flex min-h-12 w-full items-center py-2 text-left text-[15px] disabled:opacity-50">
                <span className="min-w-0 flex-1 truncate">{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/**
 * AVORA-100 · V·1 — `Bạn đang ở những vai trò nào?` 13 roles, pick as many as you like. Asked once, reopened
 * from `Vai trò của tôi · Đổi`. Only ever used to order templates; Avora never guesses a role (V·1.4).
 */
export function AudienceAsk({ open, initial = [], onDone }: { open: boolean; initial?: readonly TemplateAudience[]; onDone: (picked: TemplateAudience[] | null) => void }) {
  const [picked, setPicked] = useState<TemplateAudience[]>([]);
  const [shownFor, setShownFor] = useState<boolean>(false);
  if (open !== shownFor) {
    setShownFor(open);
    if (open) setPicked(initial.filter((id) => id !== "moi_nguoi"));
  }
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onDone(null)}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-2xl" data-audience-ask="">
        <SheetTitle className="text-[20px] tracking-tight">Bạn đang ở những vai trò nào?</SheetTitle>
        <SheetDescription className="text-[13.5px] leading-snug">
          Chọn bao nhiêu cũng được. Avora đưa vài mẫu hợp với từng vai lên trước — bảng nền tảng thì ai cũng có.
        </SheetDescription>
        <div className="mt-3 flex flex-wrap gap-2" data-role-chips="">
          {PICKABLE_ROLES.map((item) => {
            const isOn = picked.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isOn}
                data-role={item.id}
                onClick={() => setPicked((current) => (current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]))}
                className={cn(
                  "press inline-flex min-h-11 max-w-full items-center gap-1 rounded-xl border px-3.5 text-left text-[14.5px]",
                  isOn ? "border-personal bg-personal-soft font-semibold text-personal-soft-foreground" : "border-border bg-card text-foreground",
                )}
              >
                {isOn ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                <span className="min-w-0">{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground" data-role-count="">
          Đã chọn <span className="tabular">{picked.length}</span> · đổi lúc nào cũng được ở Mẫu bảng › Vai trò của tôi
        </p>
        <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2">
          <button type="button" onClick={() => onDone(initial.length > 0 ? null : [])} className="press h-12 rounded-xl border border-border text-[15px]">Bỏ qua</button>
          <button type="button" onClick={() => onDone(picked)} className="press h-12 rounded-xl bg-personal text-[15px] font-semibold text-personal-foreground">Xem mẫu hợp với tôi</button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
