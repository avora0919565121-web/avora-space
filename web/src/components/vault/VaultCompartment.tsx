import { ChevronLeft, Camera, Download, FileText, ImagePlus, Keyboard, Loader2, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { askConfirm, askText } from "@/components/ConfirmHost";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { RecoveredResetInner } from "@/components/vault/VaultForgot";
import { VaultOpenHere, VaultSetupFlow } from "@/components/vault/VaultSetup";
import { useAuth } from "@/lib/auth";
import { normalizeSearch } from "@/lib/normalize-search";
import { openPage, useHasMasterKey, useKeyring, useVaultItemActions, useVaultItems, type NewPage, type VaultItem } from "@/lib/use-vault-e2ee";
import { onVaultAdd } from "@/lib/vault-add";
import type { VaultSection } from "@/lib/vault-crypto";
import { prepareVaultFile, VAULT_MAX_PAGES } from "@/lib/vault-image";
import { daysLeft, SECTION_LABEL, templateOf, VAULT_TEMPLATES, type VaultPayload } from "@/lib/vault-templates";
import { cn } from "@/lib/utils";

const field = "mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-[16px] outline-none focus:border-personal md:text-[15px]";

function emptyPayload(section: VaultSection): VaultPayload {
  return { v: 1, type: VAULT_TEMPLATES[section][0].type, title: "", owner_label: "Tôi", owner_contact_id: null, fields: {}, tags: [], note: "", links: [], show_name_in_reminder: false };
}

/** Decrypted pages as `blob:` URLs, revoked when the item closes or the vault locks. */
function usePages(item: VaultItem | null, section: VaultSection) {
  const { user } = useAuth();
  const { ring } = useKeyring();
  const hasKey = useHasMasterKey();
  const [pages, setPages] = useState<{ id: string; url: string; blob: Blob; pdf: boolean }[]>([]);
  useEffect(() => {
    if (item === null || ring == null || user === null || !hasKey) return;
    let alive = true;
    const made: string[] = [];
    void (async () => {
      for (const file of item.files) {
        try {
          const page = await openPage(user.id, ring, section, file);
          made.push(page.url);
          if (alive) setPages((p) => [...p, { id: file.id, url: page.url, blob: page.blob, pdf: file.mimeClass === "pdf" }]);
          else URL.revokeObjectURL(page.url);
        } catch {
          toast.error("Không mở được một trang.");
        }
      }
    })();
    return () => {
      alive = false;
      made.forEach((url) => URL.revokeObjectURL(url));
      setPages([]);
    };
  }, [item, ring, user, hasKey, section]);
  return pages;
}

function ItemDetail({ item, section, onBack, onEdit, onTrash }: { item: VaultItem; section: VaultSection; onBack: () => void; onEdit: () => void; onTrash: () => void }) {
  const pages = usePages(item, section);
  const template = templateOf(section, item.payload.type);
  const left = daysLeft(section, item.payload);
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16 pt-3 md:px-8" data-vault-detail={item.id}>
      <button type="button" onClick={onBack} className="press -ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {SECTION_LABEL[section]}</button>
      <p className="mt-2 text-[12.5px] font-semibold uppercase tracking-wide text-primary">{template.label}</p>
      <h2 className="mt-1 text-[24px] font-semibold tracking-tight">{item.payload.title}</h2>
      <p className="text-[14px] text-muted-foreground">Của {item.payload.owner_label}{left !== null ? ` · ${left >= 0 ? `Còn ${left} ngày` : `Quá ${-left} ngày`}` : ""}</p>
      <div className="mt-s-2 grid gap-3 sm:grid-cols-2">
        {pages.map((p) =>
          p.pdf ? (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="flex h-40 items-center justify-center gap-2 rounded-card border border-border bg-card text-[14px]"><FileText className="h-5 w-5" /> Mở PDF</a>
          ) : (
            <img key={p.id} src={p.url} alt="" className="w-full rounded-card border border-border object-contain" />
          ),
        )}
        {item.files.length > pages.length ? <div className="flex h-40 items-center justify-center rounded-card border border-dashed border-border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : null}
      </div>
      <dl className="mt-s-2 divide-y divide-border rounded-card border border-border bg-card">
        {template.fields.filter((f) => (item.payload.fields[f.key] ?? "") !== "").map((f) => (
          <div key={f.key} className="flex min-h-12 items-center gap-3 px-4">
            <dt className="w-32 shrink-0 text-[13px] text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 flex-1 truncate text-[15px]">{item.payload.fields[f.key]}</dd>
          </div>
        ))}
        {item.payload.note !== "" ? <p className="whitespace-pre-wrap px-4 py-3 text-[14.5px]">{item.payload.note}</p> : null}
      </dl>
      <div className="mt-s-2 flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="press inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium"><Pencil className="h-4 w-4" /> Sửa</button>
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() =>
              void askConfirm({ title: "Tải tệp về?", body: "Tệp tải về không còn được Két sắt bảo vệ.", confirmLabel: "Tải về" }).then((ok) => {
                if (!ok) return;
                const a = document.createElement("a");
                a.href = p.url;
                a.download = `${item.payload.title || "giay-to"}-${i + 1}.${p.pdf ? "pdf" : "jpg"}`;
                a.click();
              })
            }
            className="press inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-[14px] font-medium"
          >
            <Download className="h-4 w-4" /> Tải về{pages.length > 1 ? ` ${i + 1}` : ""}
          </button>
        ))}
        <button type="button" onClick={onTrash} className="press inline-flex h-11 items-center gap-2 rounded-lg px-4 text-[14px] font-medium text-destructive"><Trash2 className="h-4 w-4" /> Xoá</button>
      </div>
    </div>
  );
}

function ItemForm({ section, initial, pages, onAddPages, onSave, onCancel, isSaving }: {
  section: VaultSection;
  initial: VaultPayload;
  pages: NewPage[];
  onAddPages: (files: FileList | File[]) => void;
  onSave: (payload: VaultPayload) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [payload, setPayload] = useState<VaultPayload>(initial);
  const template = templateOf(section, payload.type);
  const set = (patch: Partial<VaultPayload>): void => setPayload((p) => ({ ...p, ...patch }));
  return (
    <form className="mx-auto w-full max-w-xl space-y-s-2 px-4 pb-16 pt-3 md:px-8" onSubmit={(e) => { e.preventDefault(); onSave(payload); }} data-vault-form="">
      <p className="text-[13px] text-muted-foreground">Điền giúp vài ô chính. Sắp có: tự đọc chữ trên ảnh.</p>
      {pages.length > 0 ? (
        <div className="flex items-center gap-2 text-[13.5px]">
          <span className="rounded-full bg-secondary px-3 py-1">{pages.length} trang đính kèm</span>
          {pages.length < VAULT_MAX_PAGES ? (
            <label className="press inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-medium text-primary">
              <ImagePlus className="h-4 w-4" /> Thêm mặt sau / trang
              <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(e) => e.target.files && onAddPages(e.target.files)} />
            </label>
          ) : null}
        </div>
      ) : null}
      <label className="block"><span className="text-[13px] font-medium">Loại</span>
        <select value={payload.type} onChange={(e) => set({ type: e.target.value, fields: {} })} className={field}>
          {[...new Set(VAULT_TEMPLATES[section].map((t) => t.group))].map((group) => (
            <optgroup key={group} label={group}>
              {VAULT_TEMPLATES[section].filter((t) => t.group === group).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block"><span className="text-[13px] font-medium">Tên</span>
        <input autoFocus value={payload.title} onChange={(e) => set({ title: e.target.value })} placeholder={template.label} className={field} maxLength={120} data-vault-title="" />
      </label>
      <label className="block"><span className="text-[13px] font-medium">Của ai</span>
        <input value={payload.owner_label} onChange={(e) => set({ owner_label: e.target.value })} className={field} maxLength={60} />
      </label>
      {template.fields.map((f) => (
        <label key={f.key} className="block"><span className="text-[13px] font-medium">{f.label}</span>
          <input type={f.kind === "date" ? "date" : f.kind === "number" ? "number" : "text"} value={payload.fields[f.key] ?? ""} onChange={(e) => set({ fields: { ...payload.fields, [f.key]: e.target.value } })} className={field} />
        </label>
      ))}
      <label className="block"><span className="text-[13px] font-medium">Ghi chú</span>
        <textarea value={payload.note} onChange={(e) => set({ note: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-[16px] outline-none focus:border-personal md:text-[15px]" />
      </label>
      <label className="flex items-start gap-3 rounded-lg border border-border px-3 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">Hiện tên giấy tờ trong việc nhắc</span>
          <span className="block text-[12.5px] text-muted-foreground">Bật thì tên này được lưu không mã hoá cùng việc nhắc, để bạn đọc được trong Nhiệm vụ.</span>
        </span>
        <Switch checked={payload.show_name_in_reminder} onCheckedChange={(on) => set({ show_name_in_reminder: on })} aria-label="Hiện tên giấy tờ trong việc nhắc" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="press h-11 rounded-lg px-4 text-[14px] text-muted-foreground">Huỷ</button>
        <button type="submit" disabled={isSaving || payload.title.trim() === ""} className="press flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[14px] font-semibold text-primary-foreground disabled:opacity-50">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Lưu
        </button>
      </div>
    </form>
  );
}

type Mode = { kind: "list" } | { kind: "detail"; id: string } | { kind: "form"; id: string | null; startPage: number } | { kind: "trash" };

/**
 * AVORA-68 · 4.4 — one encrypted compartment. Lists come back as ciphertext and are opened on the device;
 * search runs on the decrypted heads in memory and never leaves the device (ADR-032).
 */
export function VaultCompartment({ section }: { section: VaultSection }) {
  const { user } = useAuth();
  const { ring, isPending: ringPending } = useKeyring();
  const hasKey = useHasMasterKey();
  const { items, isPending } = useVaultItems(section, ring);
  const actions = useVaultItemActions(section, ring);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [query, setQuery] = useState<string>("");
  const [view, setView] = useState<"group" | "life">("group");
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [pages, setPages] = useState<NewPage[]>([]);
  const [dragging, setDragging] = useState<boolean>(false);
  const [recovered, setRecovered] = useState<boolean>(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => onVaultAdd(() => setIsAddOpen(true)), []);
  // AVORA-89 · 1.4: `?mo=<id>` opens that one item once the vault is open (the gate asks first). Id only.
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("mo");
  useEffect(() => {
    if (openId === null || isPending || items.length === 0) return;
    if (items.some((item) => item.id === openId)) setMode({ kind: "detail", id: openId });
    const next = new URLSearchParams(searchParams);
    next.delete("mo");
    setSearchParams(next, { replace: true });
  }, [isPending, items, openId, searchParams, setSearchParams]);

  const addFiles = useCallback(async (files: FileList | File[], openForm: boolean): Promise<void> => {
    try {
      const prepared: NewPage[] = [];
      for (const file of Array.from(files).slice(0, VAULT_MAX_PAGES)) {
        const p = await prepareVaultFile(file);
        prepared.push({ bytes: p.bytes, mimeClass: p.mimeClass });
      }
      setPages((cur) => [...cur, ...prepared].slice(0, VAULT_MAX_PAGES));
      setIsAddOpen(false);
      if (openForm) setMode({ kind: "form", id: null, startPage: 1 });
    } catch (caught: unknown) {
      toast.error(caught instanceof Error ? caught.message : "Không đọc được tệp.");
    }
  }, []);

  const live = useMemo(() => items.filter((i) => i.deletedAt === null), [items]);
  const trashed = useMemo(() => items.filter((i) => i.deletedAt !== null), [items]);
  const shown = useMemo(() => {
    const q = normalizeSearch(query);
    if (q === "") return live;
    return live.filter((i) => normalizeSearch([i.payload.title, i.payload.owner_label, templateOf(section, i.payload.type).label, ...Object.values(i.payload.fields)].join(" ")).includes(q));
  }, [live, query, section]);

  if (ringPending) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (ring === null) return <VaultSetupFlow />;
  if (ring !== undefined && (!hasKey || recovered)) {
    if (recovered && hasKey) return <RecoveredReset onDone={() => setRecovered(false)} />;
    return <VaultOpenHere ring={ring} onRecovered={() => setRecovered(true)} />;
  }

  const current = mode.kind === "detail" || (mode.kind === "form" && mode.id !== null) ? items.find((i) => i.id === (mode as { id: string }).id) ?? null : null;
  const save = (payload: VaultPayload): void => {
    if (mode.kind !== "form") return;
    void actions.save.mutateAsync({ id: mode.id, payload, pages, startPage: (current?.files.length ?? 0) + 1 }).then(
      (id) => {
        setPages([]);
        setMode({ kind: "detail", id });
        toast.success("Đã lưu — mã hoá trên máy này.");
      },
      (caught: unknown) => toast.error(caught instanceof Error ? caught.message : "Không lưu được."),
    );
  };

  if (mode.kind === "form") {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <ItemForm section={section} initial={current?.payload ?? emptyPayload(section)} pages={pages} onAddPages={(f) => void addFiles(f, false)} onSave={save} onCancel={() => { setPages([]); setMode(current ? { kind: "detail", id: current.id } : { kind: "list" }); }} isSaving={actions.save.isPending} />
      </div>
    );
  }
  if (mode.kind === "detail" && current !== null) {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <ItemDetail item={current} section={section} onBack={() => setMode({ kind: "list" })} onEdit={() => setMode({ kind: "form", id: current.id, startPage: current.files.length + 1 })} onTrash={() => void actions.trash.mutateAsync({ id: current.id, restore: false }).then(() => { setMode({ kind: "list" }); toast.success("Đã chuyển vào Thùng rác (30 ngày)."); })} />
      </div>
    );
  }
  if (mode.kind === "trash") {
    return (
      <div className="paper min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pb-16 pt-3 md:px-8" data-vault-trash="">
          <button type="button" onClick={() => setMode({ kind: "list" })} className="press -ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-[14px] text-muted-foreground"><ChevronLeft className="h-4 w-4" /> {SECTION_LABEL[section]}</button>
          <h2 className="mt-2 text-[22px] font-semibold">Thùng rác</h2>
          <p className="text-[13.5px] text-muted-foreground">Tự xoá vĩnh viễn sau 30 ngày.</p>
          <ul className="mt-s-2 divide-y divide-border rounded-card border border-border bg-card">
            {trashed.length === 0 ? <li className="px-4 py-6 text-center text-[14px] text-muted-foreground">Trống.</li> : null}
            {trashed.map((i) => (
              <li key={i.id} className="flex min-h-14 items-center gap-2 px-4">
                <span className="min-w-0 flex-1 truncate text-[15px]">{i.payload.title}</span>
                <button type="button" onClick={() => void actions.trash.mutateAsync({ id: i.id, restore: true })} className="press inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13.5px] font-medium"><RotateCcw className="h-4 w-4" /> Khôi phục</button>
                <button
                  type="button"
                  onClick={() =>
                    void askText({ title: "Xoá vĩnh viễn?", body: `Gõ đúng tên "${i.payload.title}" để xoá. Không khôi phục được.`, confirmLabel: "Xoá vĩnh viễn" }).then((typed) => {
                      if (typed?.trim() === i.payload.title.trim()) void actions.purge.mutateAsync(i.id).then(() => toast.success("Đã xoá vĩnh viễn."));
                      else if (typed !== null) toast.error("Tên chưa khớp.");
                    })
                  }
                  className="press inline-flex h-10 items-center rounded-lg px-3 text-[13.5px] font-medium text-destructive"
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const groups = [...new Set(shown.map((i) => templateOf(section, i.payload.type).group))];
  const byOwner = [...new Set(shown.map((i) => i.payload.owner_label))];
  const row = (i: VaultItem) => {
    const left = daysLeft(section, i.payload);
    const soon = left !== null && left <= (templateOf(section, i.payload.type).leadDays || 30);
    return (
      <li key={i.id}>
        <button type="button" onClick={() => setMode({ kind: "detail", id: i.id })} className="press flex min-h-[60px] w-full items-center gap-3 px-4 text-left hover:bg-accent/40" data-vault-row={i.id}>
          <span className={cn("h-2 w-2 shrink-0 rounded-full", soon ? "bg-[hsl(28_90%_55%)]" : "bg-transparent")} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">{i.payload.title}</span>
            <span className="block truncate text-[12.5px] text-muted-foreground">{templateOf(section, i.payload.type).label} · {i.payload.owner_label}</span>
          </span>
          {left !== null && soon ? <span className="shrink-0 text-[12.5px] font-medium text-[hsl(28_80%_42%)]">{left >= 0 ? `Còn ${left} ngày` : "Đã quá hạn"}</span> : null}
        </button>
      </li>
    );
  };

  return (
    <div
      className={cn("paper relative min-h-0 flex-1 overflow-y-auto", dragging && "ring-2 ring-inset ring-primary")}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files, true); }}
      data-vault-section={section}
    >
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-3 md:px-8">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Tìm trong ${SECTION_LABEL[section]}`} aria-label={`Tìm trong ${SECTION_LABEL[section]}`} className="h-11 w-full rounded-control border border-input bg-card pl-9 pr-3 text-[16px] outline-none focus:border-personal md:text-[15px]" />
          </div>
          <button type="button" onClick={() => setMode({ kind: "trash" })} aria-label="Thùng rác" className="icon-btn h-11 w-11"><Trash2 className="h-4 w-4" />{trashed.length > 0 ? <span className="sr-only">{trashed.length}</span> : null}</button>
        </div>
        {section === "certificates" ? (
          <div role="tablist" className="mt-s-2 inline-flex rounded-full border border-border bg-card p-1">
            {(["group", "life"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("press h-9 rounded-full px-4 text-[13px] font-medium", view === v ? "bg-foreground text-background" : "text-muted-foreground")}>{v === "group" ? "Theo nhóm" : "Dòng đời"}</button>
            ))}
          </div>
        ) : null}
        {isPending ? <Loader2 className="mx-auto mt-s-4 h-5 w-5 animate-spin text-muted-foreground" /> : null}
        {!isPending && live.length === 0 ? (
          <div className="mt-14 text-center">
            <p className="text-[17px] font-semibold">Chưa có gì trong {SECTION_LABEL[section]}</p>
            <p className="mt-1 text-[14px] text-muted-foreground">Chụp ảnh, chọn PDF hoặc gõ tay. Mọi thứ được mã hoá ngay trên máy này.</p>
            <button type="button" onClick={() => setIsAddOpen(true)} className="press mx-auto mt-s-2 inline-flex h-11 items-center gap-2 rounded-control bg-primary px-5 text-[14.5px] font-semibold text-primary-foreground"><Plus className="h-4 w-4" /> Thêm</button>
          </div>
        ) : null}
        {view === "life" && section === "certificates" ? (
          byOwner.map((owner) => (
            <section key={owner} className="mt-s-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{owner}</h3>
              <ol className="mt-2 border-l-2 border-primary/30 pl-4">
                {shown.filter((i) => i.payload.owner_label === owner).sort((a, b) => (a.payload.fields.issued_on ?? "").localeCompare(b.payload.fields.issued_on ?? "")).map((i) => (
                  <li key={i.id} className="relative py-2">
                    <span className="absolute -left-[23px] top-4 h-3 w-3 rounded-full border-2 border-primary bg-background" />
                    <button type="button" onClick={() => setMode({ kind: "detail", id: i.id })} className="press text-left">
                      <span className="block text-[12px] tabular-nums text-muted-foreground">{i.payload.fields.issued_on || "—"}</span>
                      <span className="block text-[15px] font-medium">{i.payload.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))
        ) : (
          groups.map((group) => (
            <section key={group} className="mt-s-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
              <ul className="mt-2 divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
                {shown.filter((i) => templateOf(section, i.payload.type).group === group).map(row)}
              </ul>
            </section>
          ))
        )}
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files && void addFiles(e.target.files, true)} />
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" onChange={(e) => e.target.files && void addFiles(e.target.files, true)} />
      <Sheet open={isAddOpen} onOpenChange={setIsAddOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-md rounded-t-card">
          <SheetTitle className="text-[17px]">Thêm vào {SECTION_LABEL[section]}</SheetTitle>
          <div className="mt-s-2 grid gap-2 pb-[max(env(safe-area-inset-bottom),12px)]">
            <button type="button" onClick={() => cameraRef.current?.click()} className="press flex min-h-14 items-center gap-3 rounded-card border border-border px-4 text-left text-[15px] font-medium"><Camera className="h-5 w-5 text-primary" /> Chụp ảnh</button>
            <button type="button" onClick={() => pickRef.current?.click()} className="press flex min-h-14 items-center gap-3 rounded-card border border-border px-4 text-left text-[15px] font-medium"><ImagePlus className="h-5 w-5 text-primary" /> Chọn ảnh / PDF</button>
            <button type="button" onClick={() => { setIsAddOpen(false); setPages([]); setMode({ kind: "form", id: null, startPage: 1 }); }} className="press flex min-h-14 items-center gap-3 rounded-card border border-border px-4 text-left text-[15px] font-medium"><Keyboard className="h-5 w-5 text-primary" /> Gõ tay</button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** 4.3 — after the 24 words: a new passphrase, then a new kit (the old kit stops working). */
function RecoveredReset({ onDone }: { onDone: () => void }) {
  return <RecoveredResetInner onDone={onDone} />;
}
