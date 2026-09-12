import writeXlsxFile, { type Row as XlsxRow, type SheetData } from "write-excel-file/browser";

import { centsToExportNumber, formatDayVi } from "@/lib/finance";
import { reportFileBase, type ReportChart, type ReportColumn, type ReportResult } from "@/lib/finance-reports";

/**
 * Report → file. CSV and Excel are both generated from the same `ReportResult` the screen
 * rendered, so a downloaded file can never disagree with the table it came from.
 */

// Warm sand header, soft-wash totals, ink text, hairline rules: the exported sheet is
// recognisably the same document the person was just reading on screen.
const HEADER_FILL = "#EFE7DA";
const TOTAL_FILL = "#F7E3DC";
const INK = "#1C1A17";
const MUTED = "#6B635A";
const HAIRLINE = "#E6DFD3";

/** Excel reads a bare UTF-8 CSV as Latin-1; the BOM is what makes "Tạp hoá" open correctly. */
const BOM = "\uFEFF";

function csvCell(value: string): string {
  if (/[",\n\r;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function plainCell(column: ReportColumn, value: string | number | null): string {
  if (value === null || value === undefined) return "";
  if (column.kind === "money") return typeof value === "number" ? centsToExportNumber(value).toFixed(2) : String(value);
  if (column.kind === "percent") return typeof value === "number" ? (value * 100).toFixed(1) : String(value);
  if (column.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return String(value);
}

/**
 * A CSV carries the numbers, so the header states the currency once rather than gluing a
 * symbol onto every cell — a spreadsheet can only sum a column of bare numbers.
 */
export function reportToCsv(report: ReportResult, currency: string): string {
  const lines: string[] = [];
  lines.push(csvCell(report.title));
  lines.push(csvCell(report.subtitle));
  lines.push(csvCell(`Đơn vị tiền tệ: ${currency}`));
  lines.push("");

  for (const stat of report.stats) {
    const value =
      stat.value === null
        ? ""
        : stat.kind === "percent"
          ? `${(stat.value * 100).toFixed(1)}%`
          : stat.kind === "count"
            ? String(stat.value)
            : centsToExportNumber(stat.value).toFixed(2);
    lines.push([csvCell(stat.label), csvCell(value)].join(","));
  }
  if (report.stats.length > 0) lines.push("");

  lines.push(report.columns.map((column) => csvCell(column.label)).join(","));
  for (const row of report.rows) {
    lines.push(
      report.columns.map((column) => csvCell(plainCell(column, row.cells[column.key] ?? null))).join(","),
    );
  }

  return BOM + lines.join("\r\n") + "\r\n";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so Safari has finished handing the blob to the download manager.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadReportCsv(report: ReportResult, currency: string, from: string, to: string): string {
  const filename = `${reportFileBase(report.id, from, to)}.csv`;
  triggerDownload(new Blob([reportToCsv(report, currency)], { type: "text/csv;charset=utf-8" }), filename);
  return filename;
}

// ---------------------------------------------------------------- Excel

/** The subset of write-excel-file's cell styling this report uses. */
type CellStyle = {
  fontWeight?: "bold";
  backgroundColor?: string;
  textColor?: string;
};

function moneyFormat(currency: string): string {
  return currency.toUpperCase() === "VND" ? "#,##0" : "#,##0.00";
}

function buildSheet(report: ReportResult, currency: string): SheetData {
  const money = moneyFormat(currency);
  const width = report.columns.length || 1;
  const rows: XlsxRow[] = [];

  const pad = (cells: XlsxRow): XlsxRow => {
    const next = [...cells];
    while (next.length < width) next.push(null);
    return next;
  };

  rows.push(pad([{ value: report.title, fontWeight: "bold", fontSize: 14, textColor: INK }]));
  rows.push(pad([{ value: report.subtitle, textColor: MUTED }]));
  rows.push(pad([{ value: `Đơn vị tiền tệ: ${currency}`, textColor: MUTED }]));
  rows.push(pad([]));

  for (const stat of report.stats) {
    if (stat.value === null) continue;
    rows.push(
      pad([
        { value: stat.label, fontWeight: "bold", textColor: INK },
        stat.kind === "percent"
          ? { type: Number, value: stat.value, format: "0.0%" }
          : stat.kind === "count"
            ? { type: Number, value: stat.value, format: "0" }
            : { type: Number, value: centsToExportNumber(stat.value), format: money },
      ]),
    );
  }
  if (report.stats.length > 0) rows.push(pad([]));

  rows.push(
    report.columns.map((column) => ({
      value: column.label,
      fontWeight: "bold" as const,
      backgroundColor: HEADER_FILL,
      textColor: INK,
      align: column.kind === "money" || column.kind === "percent" ? ("right" as const) : ("left" as const),
      bottomBorderColor: HAIRLINE,
      bottomBorderStyle: "thin" as const,
    })),
  );

  for (const row of report.rows) {
    rows.push(
      report.columns.map((column) => {
        const raw = row.cells[column.key] ?? null;
        const style: CellStyle = {};
        if (row.emphasis || row.heading) style.fontWeight = "bold";
        if (row.emphasis) style.backgroundColor = TOTAL_FILL;
        if (row.heading) style.backgroundColor = HEADER_FILL;

        if (raw === null || raw === "") return { value: null, ...style };

        if (column.kind === "money" && typeof raw === "number") {
          return { type: Number, value: centsToExportNumber(raw), format: money, align: "right" as const, ...style };
        }
        if (column.kind === "percent" && typeof raw === "number") {
          return { type: Number, value: raw, format: "0.0%", align: "right" as const, ...style };
        }
        if (column.kind === "date" && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
          return { value: formatDayVi(raw), ...style };
        }
        return { value: String(raw), ...style };
      }),
    );
  }

  return rows;
}

/**
 * The chart's own numbers on a second sheet. write-excel-file cannot embed a chart object,
 * so instead of shipping a picture nobody can edit, the series land as a clean block the
 * user can select and turn into a native Excel chart in one step.
 */
function buildChartSheet(chart: ReportChart, currency: string): SheetData | null {
  const money = moneyFormat(currency);

  if (chart.kind === "pie") {
    if (chart.slices.length === 0) return null;
    const rows: XlsxRow[] = [
      [
        { value: "Hạng mục", fontWeight: "bold", backgroundColor: HEADER_FILL },
        { value: "Số tiền", fontWeight: "bold", backgroundColor: HEADER_FILL, align: "right" },
      ],
    ];
    for (const slice of chart.slices) {
      rows.push([
        { value: slice.name },
        { type: Number, value: centsToExportNumber(slice.valueCents), format: money, align: "right" },
      ]);
    }
    return rows;
  }

  if (chart.kind === "line" || chart.kind === "bar") {
    if (chart.points.length === 0 || chart.series.length === 0) return null;
    const rows: XlsxRow[] = [
      [
        { value: "Kỳ", fontWeight: "bold", backgroundColor: HEADER_FILL },
        ...chart.series.map((series) => ({
          value: series.name,
          fontWeight: "bold" as const,
          backgroundColor: HEADER_FILL,
          align: "right" as const,
        })),
      ],
    ];
    for (const point of chart.points) {
      rows.push([
        { value: String(point[chart.xKey] ?? "") },
        ...chart.series.map((series) => {
          const value = point[series.key];
          if (typeof value !== "number") return { value: null };
          return { type: Number, value: centsToExportNumber(value), format: money, align: "right" as const };
        }),
      ]);
    }
    return rows;
  }

  return null;
}

export async function downloadReportExcel(
  report: ReportResult,
  currency: string,
  from: string,
  to: string,
): Promise<string> {
  const filename = `${reportFileBase(report.id, from, to)}.xlsx`;
  const sheet = buildSheet(report, currency);
  const chartSheet = buildChartSheet(report.chart, currency);

  const columnWidths = report.columns.map((column) => ({
    width: column.kind === "text" ? 28 : column.kind === "date" ? 14 : 18,
  }));

  const workbook = chartSheet
    ? writeXlsxFile([
        { data: sheet, sheet: "Báo cáo", columns: columnWidths },
        {
          data: chartSheet,
          sheet: "Dữ liệu biểu đồ",
          columns: [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }],
        },
      ])
    : writeXlsxFile(sheet, { sheet: "Báo cáo", columns: columnWidths });

  await workbook.toFile(filename);
  return filename;
}
