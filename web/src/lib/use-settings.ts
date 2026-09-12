import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { DEFAULT_BASE_CURRENCY, type RateTable } from "@/lib/currency";
import { financeKeys } from "@/lib/finance-api";
import {
  DEFAULT_DAILY_THOUGHT_CATEGORY,
  type DailyThoughtCategory,
} from "@/lib/daily-thoughts";
import {
  currencyKeys,
  fetchCurrencyRates,
  fetchProfileSettings,
  settingsKeys,
  updateBaseCurrency,
  updateDailyThoughtCategory,
  updateTimezone,
  type ProfileSettings,
} from "@/lib/settings";

export { settingsKeys, currencyKeys };

/** Which currency to report in, which zone deadlines are written in, and the daily thought. */
export function useProfileSettings(): UseQueryResult<ProfileSettings, Error> {
  const { user } = useAuth();
  const userId = user?.id;
  return useQuery<ProfileSettings, Error>({
    queryKey: settingsKeys.profile,
    queryFn: () => fetchProfileSettings(userId ?? ""),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Exchange rates. Only 38 rows exist and they change at most daily, so they are fetched once
 * and held for an hour rather than re-read for every total on screen.
 */
export function useCurrencyRates(): UseQueryResult<RateTable, Error> {
  const { user } = useAuth();
  return useQuery<RateTable, Error>({
    queryKey: currencyKeys.rates,
    queryFn: fetchCurrencyRates,
    enabled: Boolean(user?.id),
    staleTime: 60 * 60_000,
  });
}

/** The base currency with a safe fallback, for components that only need the code. */
export function useBaseCurrency(): string {
  const { data } = useProfileSettings();
  return data?.baseCurrency ?? DEFAULT_BASE_CURRENCY;
}

/**
 * The chosen daily thought category. Defaults to "khong_chon" while the settings are still
 * loading, so the block fades in once when the answer is known instead of appearing and then
 * retracting for people who asked for nothing.
 */
export function useDailyThoughtCategory(): DailyThoughtCategory {
  const { data } = useProfileSettings();
  return data?.dailyThoughtCategory ?? DEFAULT_DAILY_THOUGHT_CATEGORY;
}

export function useSettingsActions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const setBaseCurrency = useMutation({
    mutationFn: (code: string) => updateBaseCurrency(userId, code),
    onSuccess: (settings) => {
      queryClient.setQueryData<ProfileSettings>(settingsKeys.profile, settings);
      // Every stored conversion was just rewritten by the database, so the ledger on screen
      // is stale in exactly the same way the cache was.
      void queryClient.invalidateQueries({ queryKey: financeKeys.all });
    },
  });

  const setTimezone = useMutation({
    mutationFn: (timezone: string) => updateTimezone(userId, timezone),
    onSuccess: (settings) => {
      queryClient.setQueryData<ProfileSettings>(settingsKeys.profile, settings);
    },
  });

  const setDailyThoughtCategory = useMutation({
    mutationFn: (category: string) => updateDailyThoughtCategory(userId, category),
    onSuccess: (settings) => {
      queryClient.setQueryData<ProfileSettings>(settingsKeys.profile, settings);
    },
  });

  return {
    setBaseCurrency,
    setTimezone,
    setDailyThoughtCategory,
    isWorking:
      setBaseCurrency.isPending || setTimezone.isPending || setDailyThoughtCategory.isPending,
  };
}
