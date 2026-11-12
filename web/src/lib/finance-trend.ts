import type { TrendPoint } from "@/lib/finance-reports";

/**
 * KT-07c (CEO 12/11 · 18, SP-04 đề xuất B): "có thông tin thì mới vẽ". The trend starts at the first
 * month that has something in it — a new book no longer draws nine flat months at 0 that look broken.
 * Nothing at all → no points (the screen says so instead of drawing an empty chart).
 */
export function trendFromFirstData(points: readonly TrendPoint[]): TrendPoint[] {
  const first = points.findIndex((point) => point.expense !== 0 || point.income !== 0);
  return first === -1 ? [] : points.slice(first);
}

/** Biểu đồ A: thu và chi theo tháng, kèm phần còn dư (âm = hụt). */
export function incomeExpenseBars(points: readonly TrendPoint[]): { label: string; month: string; income: number; expense: number; left: number }[] {
  return trendFromFirstData(points).map((point) => ({
    label: point.label,
    month: point.month,
    income: point.income,
    expense: point.expense,
    left: point.income - point.expense,
  }));
}
