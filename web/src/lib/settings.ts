import { supabase } from "@/integrations/supabase/client";
import { buildRateTable, DEFAULT_BASE_CURRENCY, isSupportedCurrency, type RateTable } from "@/lib/currency";
import {
  DEFAULT_DAILY_THOUGHT_CATEGORY,
  isDailyThoughtCategory,
  type DailyThoughtCategory,
} from "@/lib/daily-thoughts";

/**
 * Per-person preferences that other modules read: which currency to report in, which zone a
 * deadline's clock is written in, and whether Avora Space opens with a thought for the day.
 *
 * These live on `profiles`, not on `auth.users`. The brief proposed
 * `ALTER TABLE auth.users ADD COLUMN base_currency`, which Supabase refuses outright — that
 * schema belongs to the auth service and is not ours to alter.
 */
export type ProfileSettings = {
  baseCurrency: string;
  timezone: string;
  dailyThoughtCategory: DailyThoughtCategory;
};

/** The columns every read and write below round-trips, named once so they cannot drift apart. */
const PROFILE_SETTINGS_COLUMNS = "base_currency, timezone, daily_thought_category";

type ProfileSettingsRow = {
  base_currency: string | null;
  timezone: string | null;
  daily_thought_category: string | null;
};

/**
 * One row to one settings object. An unreadable value falls back to the default rather than
 * propagating: a profile row that predates a column, or carries something unexpected, should
 * still open the app on sane settings.
 */
function toProfileSettings(row: ProfileSettingsRow | null): ProfileSettings {
  const base = row?.base_currency ?? DEFAULT_BASE_CURRENCY;
  const category = row?.daily_thought_category ?? DEFAULT_DAILY_THOUGHT_CATEGORY;
  return {
    baseCurrency: isSupportedCurrency(base) ? base.toUpperCase() : DEFAULT_BASE_CURRENCY,
    timezone: row?.timezone ?? "Asia/Ho_Chi_Minh",
    dailyThoughtCategory: isDailyThoughtCategory(category)
      ? category
      : DEFAULT_DAILY_THOUGHT_CATEGORY,
  };
}

export const settingsKeys = {
  all: ["settings"] as const,
  profile: ["settings", "profile"] as const,
};

export const currencyKeys = {
  all: ["currency"] as const,
  rates: ["currency", "rates"] as const,
};

function fail(scope: string, code: string | undefined, message: string): Error {
  console.error(`[${scope}] ${code ?? "unknown"}: ${message}`);
  const normalized = message.toLowerCase();
  if (normalized.includes("avora_profile_timezone_invalid")) return new Error("Múi giờ không hợp lệ.");
  if (normalized.includes("profiles_daily_thought_category_valid"))
    return new Error("Lựa chọn Daily Thought không hợp lệ.");
  if (normalized.includes("failed to fetch"))
    return new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
  if (code === "42501" || normalized.includes("permission denied"))
    return new Error("Máy chủ chưa cho phép thao tác này.");
  return new Error("Không lưu được thiết lập. Vui lòng thử lại.");
}

export async function fetchProfileSettings(userId: string): Promise<ProfileSettings> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SETTINGS_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw fail("settings", error.code, error.message);
  return toProfileSettings(data);
}

/**
 * Changing base currency re-values the entire ledger. The database does that in a trigger, so
 * every cached conversion is rewritten in the same transaction rather than left behind
 * claiming a base that is no longer in force.
 */
export async function updateBaseCurrency(userId: string, code: string): Promise<ProfileSettings> {
  if (!isSupportedCurrency(code)) throw new Error("AVORA chưa hỗ trợ loại tiền này.");
  const { data, error } = await supabase
    .from("profiles")
    .update({ base_currency: code.toUpperCase() })
    .eq("id", userId)
    .select(PROFILE_SETTINGS_COLUMNS)
    .single();
  if (error) throw fail("settings", error.code, error.message);
  return toProfileSettings(data);
}

export async function updateTimezone(userId: string, timezone: string): Promise<ProfileSettings> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ timezone })
    .eq("id", userId)
    .select(PROFILE_SETTINGS_COLUMNS)
    .single();
  if (error) throw fail("settings", error.code, error.message);
  return toProfileSettings(data);
}

/**
 * Which kind of daily thought to open on — or none. Checked here as well as by the database
 * constraint, so a bad value is refused before it costs a round trip.
 */
export async function updateDailyThoughtCategory(
  userId: string,
  category: string,
): Promise<ProfileSettings> {
  if (!isDailyThoughtCategory(category)) throw new Error("Lựa chọn Daily Thought không hợp lệ.");
  const { data, error } = await supabase
    .from("profiles")
    .update({ daily_thought_category: category })
    .eq("id", userId)
    .select(PROFILE_SETTINGS_COLUMNS)
    .single();
  if (error) throw fail("settings", error.code, error.message);
  return toProfileSettings(data);
}

/**
 * The whole rate table. Only USD pairs are stored — 38 rows — so this is small enough to
 * fetch once and keep, and every cross rate is derived from it identically on both sides.
 */
export async function fetchCurrencyRates(): Promise<RateTable> {
  const { data, error } = await supabase
    .from("currency_rates")
    .select("from_currency, to_currency, rate, rate_date")
    .order("rate_date", { ascending: false });
  if (error) throw fail("currency", error.code, error.message);

  // Newest first, so the first row seen for a pair is the one that counts.
  const seen = new Set<string>();
  const rows: { from: string; to: string; rate: number }[] = [];
  for (const row of data ?? []) {
    const key = `${row.from_currency}>${row.to_currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ from: row.from_currency, to: row.to_currency, rate: Number(row.rate) });
  }
  return buildRateTable(rows);
}

/** The list of timezones to offer, kept short: the ones AVORA's people actually live in. */
export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "Asia/Ho_Chi_Minh", label: "Việt Nam (GMT+7)" },
  { value: "Asia/Bangkok", label: "Bangkok (GMT+7)" },
  { value: "Asia/Singapore", label: "Singapore (GMT+8)" },
  { value: "Asia/Tokyo", label: "Tokyo (GMT+9)" },
  { value: "Asia/Seoul", label: "Seoul (GMT+9)" },
  { value: "Asia/Shanghai", label: "Thượng Hải (GMT+8)" },
  { value: "Asia/Kolkata", label: "Ấn Độ (GMT+5:30)" },
  { value: "Australia/Sydney", label: "Sydney (GMT+10)" },
  { value: "Europe/London", label: "London (GMT+0)" },
  { value: "Europe/Paris", label: "Paris (GMT+1)" },
  { value: "Europe/Zurich", label: "Zurich (GMT+1)" },
  { value: "America/New_York", label: "New York (GMT-5)" },
  { value: "America/Chicago", label: "Chicago (GMT-6)" },
  { value: "America/Los_Angeles", label: "Los Angeles (GMT-8)" },
  { value: "America/Sao_Paulo", label: "São Paulo (GMT-3)" },
  { value: "America/Mexico_City", label: "Mexico City (GMT-6)" },
  { value: "Africa/Johannesburg", label: "Johannesburg (GMT+2)" },
  { value: "UTC", label: "UTC" },
] as const;
