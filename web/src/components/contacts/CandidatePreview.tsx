import { AlertTriangle, Building2, Mail, Phone, UserRound } from "lucide-react";

import { FieldLabel, contactInputClass } from "@/components/contacts/fields";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  canImportCandidate,
  canMergeCandidate,
  candidateProblem,
  defaultCandidateChoice,
  EMPTY_TYPE_DECISION,
  resolvedType,
  type CandidateChoice,
  type CandidateRow,
  type TypeDecision,
} from "@/lib/contact-candidates";
import { cn } from "@/lib/utils";

type CandidatePreviewProps = {
  rows: readonly CandidateRow[];
  picked: ReadonlySet<string>;
  choices: Readonly<Record<string, CandidateChoice>>;
  decisions: Readonly<Record<string, TypeDecision>>;
  counts: { total: number; ready: number; blocked: number; duplicate: number };
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  onChoice: (key: string, choice: CandidateChoice) => void;
  onDecision: (key: string, decision: TypeDecision) => void;
};

/**
 * The table between choosing a source and writing anything down.
 *
 * Shared by every bulk route — a spreadsheet today, the phone book next — because the decisions
 * are identical once the source has handed over its candidates: who is already here, who is a
 * company, and which of these should actually be written. Only the rows' origins differ, and
 * that is a single line of text per row.
 *
 * Nothing is ticked when it opens. An import writes to the address book in bulk, so the tick is
 * where the person takes responsibility for each entry.
 */
export function CandidatePreview({
  rows,
  picked,
  choices,
  decisions,
  counts,
  onToggle,
  onToggleAll,
  onChoice,
  onDecision,
}: CandidatePreviewProps) {
  const allPicked = counts.ready > 0 && picked.size === counts.ready;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
        <span className="font-medium text-foreground">{counts.ready} liên hệ sẵn sàng</span>
        {counts.blocked > 0 ? (
          <span className="text-primary">{counts.blocked} cần điền thêm</span>
        ) : null}
        <span className="text-muted-foreground">{counts.duplicate} đã có trong danh bạ</span>
      </div>

      {counts.ready > 0 ? (
        <button
          type="button"
          onClick={onToggleAll}
          className="press mt-3 text-[13px] font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
        >
          {allPicked ? "Bỏ chọn tất cả" : `Chọn tất cả ${counts.ready} liên hệ`}
        </button>
      ) : null}

      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
        {rows.map((row) => (
          <CandidateItem
            key={row.key}
            row={row}
            isPicked={picked.has(row.key)}
            choice={choices[row.key] ?? defaultCandidateChoice(row)}
            decision={decisions[row.key] ?? EMPTY_TYPE_DECISION}
            onToggle={() => onToggle(row.key)}
            onChoice={(choice) => onChoice(row.key, choice)}
            onDecision={(decision) => onDecision(row.key, decision)}
          />
        ))}
      </ul>
    </div>
  );
}

function CandidateItem({
  row,
  isPicked,
  choice,
  decision,
  onToggle,
  onChoice,
  onDecision,
}: {
  row: CandidateRow;
  isPicked: boolean;
  choice: CandidateChoice;
  decision: TypeDecision;
  onToggle: () => void;
  onChoice: (choice: CandidateChoice) => void;
  onDecision: (decision: TypeDecision) => void;
}) {
  const { candidate } = row;
  const problem = candidateProblem(row, decision);
  const usable = canImportCandidate(row, decision);
  const type = resolvedType(row, decision);
  const name = candidate.name.length > 0 ? candidate.name : "(chưa có tên)";

  return (
    <li className={cn("px-4 py-3", usable ? null : "bg-primary/[0.04]")}>
      <div className="flex items-start gap-3">
        {/* A row that cannot be written has no checkbox at all: a disabled one would invite a
            click that can never do anything. */}
        {usable ? (
          <Checkbox
            className="mt-0.5"
            checked={isPicked}
            onCheckedChange={onToggle}
            aria-label={`Nhập ${name}`}
          />
        ) : (
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-primary"
            strokeWidth={1.9}
            aria-hidden="true"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[12px] text-muted-foreground">{row.origin}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-foreground/75">
              {type === "individual" ? (
                <UserRound className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <Building2 className="h-3 w-3" strokeWidth={1.9} aria-hidden="true" />
              )}
              {type === "individual" ? "Cá nhân" : "Doanh nghiệp"}
            </span>
            <span className="truncate text-[14.5px] font-semibold text-foreground">{name}</span>
          </div>

          <ChannelLine label="Điện thoại" icon="phone" values={candidate.phones} />
          <ChannelLine label="Email" icon="email" values={candidate.emails} />

          {/* Two of a kind is the one thing an import cannot settle by itself. */}
          {candidate.phones.length >= 2 || candidate.emails.length >= 2 ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              Số đầu tiên được dùng làm kênh chính, phần còn lại lưu thành kênh phụ để bạn xem lại
              sau.
            </p>
          ) : null}

          {/* Only asked where the source could not say. A file states its own `loai`. */}
          {!row.isTypeKnown ? (
            <BusinessToggle decision={decision} onDecision={onDecision} rowKey={row.key} />
          ) : null}

          {problem !== null ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-primary">{problem}</p>
          ) : null}

          {row.duplicate !== null ? (
            <div className="mt-2 rounded-md border border-border bg-accent/25 px-3 py-2.5">
              <p className="text-[12.5px] text-foreground">
                Trùng {row.duplicate.kind === "phone" ? "số điện thoại" : "email"}{" "}
                <span className="tabular">{row.duplicate.value}</span> với{" "}
                <strong className="font-semibold">{row.duplicate.contactName}</strong>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {/* Merging is only offered into the same kind of contact: a person's details
                    cannot be poured into a company row. */}
                {canMergeCandidate(row, decision) ? (
                  <ChoiceChip
                    label="Gộp"
                    isActive={choice === "merge"}
                    onClick={() => onChoice("merge")}
                  />
                ) : null}
                <ChoiceChip
                  label="Bỏ qua"
                  isActive={choice === "skip"}
                  onClick={() => onChoice("skip")}
                />
                <ChoiceChip
                  label="Vẫn tạo mới"
                  isActive={choice === "create"}
                  onClick={() => onChoice("create")}
                />
              </div>
              {choice === "merge" ? (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  Chỉ điền vào những ô đang trống của {row.duplicate.contactName} — số và email mới
                  được thêm làm kênh phụ, không ghi đè cái đã có.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Every value of one kind, with the primary one named as such. */
function ChannelLine({
  label,
  icon,
  values,
}: {
  label: string;
  icon: "phone" | "email";
  values: readonly string[];
}) {
  if (values.length === 0) return null;
  const Icon = icon === "phone" ? Phone : Mail;

  return (
    <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 truncate">
        {values[0]}
        {values.length > 1 ? (
          <span className="text-muted-foreground/75"> + {values.length - 1} kênh phụ</span>
        ) : null}
      </span>
    </p>
  );
}

/**
 * The one question a phone book cannot answer for us.
 *
 * Off by default, and turning it on opens exactly the two fields a company cannot exist without
 * — asked here, at the row, rather than after the import fails on them one at a time.
 */
function BusinessToggle({
  decision,
  onDecision,
  rowKey,
}: {
  decision: TypeDecision;
  onDecision: (next: TypeDecision) => void;
  rowKey: string;
}) {
  const taxId = `candidate-tax-${rowKey}`;
  const repId = `candidate-rep-${rowKey}`;

  return (
    <div className="mt-2">
      <label className="flex cursor-pointer items-center gap-2.5">
        <Switch
          checked={decision.isBusiness}
          onCheckedChange={(isBusiness) => onDecision({ ...decision, isBusiness })}
        />
        <span className="text-[13px] text-foreground">Đây là liên hệ doanh nghiệp?</span>
      </label>

      {decision.isBusiness ? (
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor={taxId} required>
              Mã số thuế
            </FieldLabel>
            <input
              id={taxId}
              value={decision.taxCode}
              maxLength={50}
              placeholder="0301234567"
              onChange={(event) => onDecision({ ...decision, taxCode: event.target.value })}
              className={`mt-1.5 ${contactInputClass}`}
            />
          </div>
          <div>
            <FieldLabel htmlFor={repId} required>
              Người đại diện
            </FieldLabel>
            <input
              id={repId}
              value={decision.representativeName}
              maxLength={200}
              placeholder="Trần Thị B"
              onChange={(event) =>
                onDecision({ ...decision, representativeName: event.target.value })
              }
              className={`mt-1.5 ${contactInputClass}`}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChoiceChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "press rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
        isActive
          ? "border-primary/60 bg-card text-foreground"
          : "border-transparent text-muted-foreground hover:bg-card/70",
      )}
    >
      {label}
    </button>
  );
}
