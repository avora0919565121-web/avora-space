import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { useMemo, useState } from "react";

import { todayIso } from "@/lib/finance";
import { useGuidance } from "@/lib/use-task-flags";
import type { VaultSection } from "@/lib/vault-crypto";
import { sampleHiddenKey, vaultSamples, type VaultSample } from "@/lib/vault-samples";
import { daysLeft, SECTION_LABEL, templateOf } from "@/lib/vault-templates";
import { cn } from "@/lib/utils";

/** "Mẫu" — the one chip every sample carries. */
export function SampleChip() {
  return <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800 dark:text-amber-200">Mẫu</span>;
}

function SampleField({ label, value, secret }: { label: string; value: string; secret: boolean }) {
  const [shown, setShown] = useState<boolean>(false);
  return (
    <div className="flex min-h-10 items-center gap-3 border-t border-border py-1.5 first:border-t-0">
      <dt className="w-[38%] shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 flex-1 truncate text-[14px] text-foreground", secret && !shown && "tracking-[0.2em]")}>{secret && !shown ? "••••••••" : value || "—"}</dd>
      {secret ? (
        // Show only — the sample never offers "Chép": nobody should paste a sample string as a real password.
        <button type="button" onClick={() => setShown((on) => !on)} aria-label={shown ? "Ẩn" : "Hiện"} className="icon-btn h-9 w-9 shrink-0">
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  );
}

function SampleRow({ sample }: { sample: VaultSample }) {
  const [open, setOpen] = useState<boolean>(false);
  const template = templateOf(sample.section, sample.type);
  const left = daysLeft(sample.section, { type: sample.type, fields: sample.fields });
  const soon = left !== null && left >= 0 && left <= Math.max(template.leadDays, 30);
  return (
    <li className="border-t border-border first:border-t-0" data-vault-sample={sample.id}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((on) => !on)} className="press flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-foreground">{sample.title}</span>
            <SampleChip />
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {template.label} · {sample.owner}
            {soon ? <span className="ml-1 font-medium text-primary">· Còn {left} ngày</span> : null}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div className="px-4 pb-3">
          <dl className="rounded-lg border border-border bg-background px-3">
            {template.fields.map((field) => (
              <SampleField key={field.key} label={field.label} value={sample.fields[field.key] ?? ""} secret={field.kind === "secret"} />
            ))}
          </dl>
          {sample.note !== "" ? <p className="mt-2 text-[13px] text-muted-foreground">{sample.note}</p> : null}
          <p className="mt-2 text-[12px] text-muted-foreground">Mục mẫu chỉ để xem — không sửa, không chép, không nhắc.</p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * KT-07c (CEO 12/11 · 17–19, SP-04 §3): what a compartment is for, shown with four read-only
 * samples. Static in the app — never stored, never encrypted, never counted. "Ẩn mẫu" hides them for
 * this account (dismissed_guidance), "Xem lại mẫu" brings them back. Never shown on a load error.
 */
export function VaultSampleList({ section, invite }: { section: VaultSection; invite?: string }) {
  const { shouldShow, dismiss, isDismissed, restore } = useGuidance();
  const samples = useMemo(() => vaultSamples(section, todayIso()), [section]);
  const key = sampleHiddenKey(section);
  // KT-09 (CEO): hidden is not gone — one quiet line brings this compartment's samples back.
  if (isDismissed(key)) {
    return (
      <div className="w-full text-left" data-vault-samples-hidden={section}>
        <button type="button" onClick={() => restore(key)} data-vault-samples-restore={section} className="press min-h-11 px-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Xem lại mẫu
        </button>
      </div>
    );
  }
  if (!shouldShow(key)) return null;
  return (
    <section aria-label={`Mẫu ${SECTION_LABEL[section]}`} data-vault-samples={section} className="w-full text-left">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5">
        <SampleChip />
        <p className="min-w-0 flex-1 text-[13.5px] text-foreground">
          Đây là mẫu để bạn hình dung ngăn này dùng thế nào. Không phải dữ liệu của bạn.
          {invite !== undefined ? <span className="block text-muted-foreground">{invite}</span> : null}
        </p>
        <button type="button" onClick={() => dismiss(key)} className="press min-h-9 px-1 text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Ẩn mẫu
        </button>
      </div>
      <ul className="mt-3 overflow-hidden rounded-card border border-border bg-card">
        {samples.map((sample) => (
          <SampleRow key={sample.id} sample={sample} />
        ))}
      </ul>
    </section>
  );
}
