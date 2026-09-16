import { AlertTriangle, ArrowRight, Wand2 } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import type { ImportColumn } from "@/lib/contact-import";
import {
  COLUMN_LABELS,
  MAPPING_ORDER,
  MAPPING_ORDER_BUSINESS,
  missingRequired,
  REQUIRED_MAPPING,
  unusedColumns,
  type ColumnMapping,
} from "@/lib/contact-import-mapping";
import type { ContactType } from "@/lib/contacts";
import { cn } from "@/lib/utils";

/**
 * Saying which column in somebody's file is which of ours.
 *
 * Stands between choosing a spreadsheet and the preview, and only appears when the file is not
 * already our template — a screen asking whether the column called `ten` is the name would be
 * a click for nothing. What it will not do is guess: a field we could not recognise arrives
 * empty, because a plausible wrong answer pre-filled on a screen people click through is how
 * two thousand phone numbers end up in the notes.
 */

const SELECT_CLASS =
  "h-10 w-full appearance-none rounded-md border border-border bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pl-3 pr-9 text-[13.5px] text-foreground outline-none transition-colors focus:border-primary/60";

/** Drawn in the border colour so a native select still reads as AVORA paper. */
const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B635A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

const NONE = "";

/** The wording for "this file has no such column", which is a real answer and not a blank. */
const NO_COLUMN_LABEL = "Không có cột này";

function FieldRow({
  column,
  columns,
  chosen,
  onChange,
}: {
  column: ImportColumn;
  columns: readonly string[];
  chosen: string | undefined;
  onChange: (heading: string | undefined) => void;
}) {
  const isRequired = REQUIRED_MAPPING.includes(column);
  const isMissing = isRequired && (chosen ?? "").length === 0;
  const id = `map-${column}`;

  return (
    <div className="grid grid-cols-[1fr_1.2fr] items-center gap-3 py-2">
      <label htmlFor={id} className="text-[13.5px] text-foreground">
        {COLUMN_LABELS[column]}
        {isRequired ? <span className="ml-1 text-primary">*</span> : null}
      </label>
      <select
        id={id}
        value={chosen ?? NONE}
        onChange={(event) =>
          onChange(event.target.value === NONE ? undefined : event.target.value)
        }
        className={cn(SELECT_CLASS, isMissing ? "border-primary/70" : "")}
        style={{ backgroundImage: SELECT_CHEVRON }}
      >
        <option value={NONE}>{NO_COLUMN_LABEL}</option>
        {columns.map((heading) => (
          <option key={heading} value={heading}>
            {heading}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ColumnMapStep({
  fileName,
  header,
  columns,
  mapping,
  fallbackType,
  wasRemembered,
  matchedCount,
  onChange,
  onFallbackType,
  onBack,
  onContinue,
}: {
  fileName: string;
  header: readonly string[];
  columns: readonly string[];
  mapping: ColumnMapping;
  fallbackType: ContactType;
  /** Whether this mapping came back from a file with these same headings, seen before. */
  wasRemembered: boolean;
  /** How many fields we recognised ourselves, said plainly so the guessing is visible. */
  matchedCount: number;
  onChange: (column: ImportColumn, heading: string | undefined) => void;
  onFallbackType: (type: ContactType) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const missing = useMemo(() => missingRequired(mapping), [mapping]);
  const unused = useMemo(() => unusedColumns(header, mapping), [header, mapping]);
  const hasTypeColumn = (mapping.loai ?? "").length > 0;

  return (
    <div>
      <div className="flex items-start gap-3 rounded-xl border border-border bg-accent/20 p-4">
        {wasRemembered ? (
          <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.9} aria-hidden="true" />
        ) : null}
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {wasRemembered
            ? "Đã dùng lại cách ghép cột bạn chọn lần trước cho đúng bộ cột này. Xem lại rồi sửa nếu cần."
            : `Cột trong file của bạn không trùng tên file mẫu. AVORA đoán được ${matchedCount} cột — bạn xem lại, cột nào đoán sai hoặc còn trống thì chọn tay.`}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1.2fr] gap-3 border-b border-border pb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Trường AVORA
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cột trong file của bạn
        </span>
      </div>

      <div className="divide-y divide-border/60">
        {MAPPING_ORDER.map((column) => (
          <FieldRow
            key={column}
            column={column}
            columns={columns}
            chosen={mapping[column]}
            onChange={(heading) => onChange(column, heading)}
          />
        ))}
      </div>

      {/* A file whose rows never say what they are still has to say it once, or every row
          would fail validation for a reason the file cannot fix. */}
      {!hasTypeColumn ? (
        <div className="mt-4 rounded-xl border border-border p-4">
          <label htmlFor="map-fallback-type" className="text-[13.5px] font-medium text-foreground">
            File không có cột loại — cả file này là
          </label>
          <select
            id="map-fallback-type"
            value={fallbackType}
            onChange={(event) => onFallbackType(event.target.value as ContactType)}
            className={cn(SELECT_CLASS, "mt-2")}
            style={{ backgroundImage: SELECT_CHEVRON }}
          >
            <option value="individual">Cá nhân</option>
            <option value="business">Doanh nghiệp</option>
          </select>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Bạn vẫn đổi được từng liên hệ ở bước xem trước.
          </p>
        </div>
      ) : null}

      <details className="mt-4 rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-[13.5px] font-medium text-foreground">
          Cột dành cho doanh nghiệp
        </summary>
        <div className="mt-2 divide-y divide-border/60">
          {MAPPING_ORDER_BUSINESS.map((column) => (
            <FieldRow
              key={column}
              column={column}
              columns={columns}
              chosen={mapping[column]}
              onChange={(heading) => onChange(column, heading)}
            />
          ))}
        </div>
      </details>

      {unused.length > 0 ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">
          Không dùng cột: {unused.join(", ")}. Những cột này sẽ không được nhập.
        </p>
      ) : null}

      {missing.length > 0 ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-[13px] leading-relaxed text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.9} aria-hidden="true" />
          <span>
            Chưa biết cột nào là {missing.map((column) => COLUMN_LABELS[column]).join(", ")}. Hãy
            chọn cột đó — không có tên thì AVORA không lưu được liên hệ nào.
          </span>
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button variant="outline" className="press h-10 px-5" onClick={onBack}>
          Chọn file khác
        </Button>
        <Button
          className="press h-10 gap-1.5 px-5"
          disabled={missing.length > 0}
          onClick={onContinue}
        >
          Tiếp tục
          <ArrowRight className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
        </Button>
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground">{fileName}</p>
    </div>
  );
}
