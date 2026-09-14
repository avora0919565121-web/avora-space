import { Bell, BellOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  allowsCustomDuration,
  MAX_CUSTOM_MUTE_HOURS,
  muteDurationOptions,
  mutedUntilFor,
  MUTE_SCOPE_LABELS,
  MUTE_SCOPE_NOTES,
  parseCustomHours,
  remainingMuteLabel,
  type MuteScope,
} from "@/lib/mute";
import { useMuteSettings } from "@/lib/use-mute";
import { cn } from "@/lib/utils";

/** The layers, outermost first — the same order the decision reads them in. */
const SCOPES: readonly MuteScope[] = ["avora", "messages", "direct", "group", "project"];

/**
 * One layer's switch: what it covers, how long, and how much silence is left.
 *
 * The duration choices differ by layer on purpose. "Quiet the whole app until tomorrow" is a
 * decision about your own day. "Quiet this group for a month" is a decision about the people
 * in it, who are left believing their messages arrive — so the per-tab layers get four fixed
 * answers and no free-text box, the longest of which ends tonight.
 */
function MuteRow({ scope }: { scope: MuteScope }) {
  const { mutedUntil, mute, unmute, isWorking } = useMuteSettings();
  const until = mutedUntil(scope);
  const isMuted = until !== null;
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [customHours, setCustomHours] = useState<string>("");

  const apply = async (hours: number | null, label: string): Promise<void> => {
    try {
      await mute(scope, mutedUntilFor({ id: "custom", label, hours }));
      setIsPicking(false);
      setCustomHours("");
      toast.success(`Đã tắt thông báo ${MUTE_SCOPE_LABELS[scope]} — ${label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được.");
    }
  };

  const turnBackOn = async (): Promise<void> => {
    try {
      await unmute(scope);
      setIsPicking(false);
      toast.success(`Đã bật lại thông báo ${MUTE_SCOPE_LABELS[scope]}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được.");
    }
  };

  return (
    <div
      className={cn(
        "rounded-[10px] border px-3.5 py-3",
        isMuted ? "border-primary/35 bg-primary/5" : "border-border bg-card",
      )}
    >
      <div className="flex items-start gap-2.5">
        {isMuted ? (
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Bell
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-foreground">{MUTE_SCOPE_LABELS[scope]}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            {MUTE_SCOPE_NOTES[scope]}
          </p>
          {isMuted ? (
            <p className="mt-1 text-[12px] font-medium text-primary">
              Đang tắt — {remainingMuteLabel(until)}
            </p>
          ) : null}
        </div>
        {isMuted ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => void turnBackOn()}
            className="press shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
          >
            Bật lại
          </button>
        ) : (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => setIsPicking(!isPicking)}
            aria-expanded={isPicking}
            className="press shrink-0 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-45"
          >
            Tắt trong…
          </button>
        )}
      </div>

      {isPicking && !isMuted ? (
        <div className="rise-in mt-2.5 space-y-2 border-t border-border pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {muteDurationOptions(scope).map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={isWorking}
                onClick={() => void apply(option.hours, option.label)}
                className="press rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
              >
                {option.label}
              </button>
            ))}
          </div>

          {/*
            Only the two upper layers get a free-text box. A per-tab mute that could be set
            for a fortnight is one people set and forget, while the room keeps believing its
            messages arrive.
          */}
          {allowsCustomDuration(scope) ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={MAX_CUSTOM_MUTE_HOURS}
                inputMode="numeric"
                value={customHours}
                placeholder="số giờ"
                onChange={(event) => setCustomHours(event.target.value)}
                aria-label={`Số giờ tắt thông báo ${MUTE_SCOPE_LABELS[scope]}`}
                className="tabular h-9 w-[96px] rounded-[8px] border border-input bg-card px-2.5 text-[13px] text-foreground outline-none focus:border-muted-foreground"
              />
              <span className="text-[12px] text-muted-foreground">giờ</span>
              <button
                type="button"
                disabled={isWorking || parseCustomHours(customHours) === null}
                onClick={() => {
                  const hours = parseCustomHours(customHours);
                  if (hours === null) return;
                  void apply(hours, `${hours} giờ`);
                }}
                className="press rounded-[8px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-45"
              >
                Tắt
              </button>
            </div>
          ) : (
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              Tối đa là hết ngày hôm nay — sau đó thông báo tự bật lại.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Notification layers, from the whole app down to one tab.
 *
 * Read from the outside in: AVORA overrides everything, Tin nhắn overrides the tabs, and each
 * tab decides only its own threads. The exceptions are stated next to the layer they apply to
 * rather than hidden in a help page, because a person deciding to go quiet needs to know what
 * will still get through.
 */
export function MuteSettingsCard() {
  const { isWorking } = useMuteSettings();

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-foreground">Thông báo</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Tắt theo tầng, và luôn có thời hạn — thông báo tự bật lại, bạn không cần nhớ quay lại
            đây.
          </p>
        </div>
        {isWorking ? (
          <Loader2 className="mt-1 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </div>

      <div className="mt-5 space-y-2">
        {SCOPES.map((scope) => (
          <MuteRow key={scope} scope={scope} />
        ))}
      </div>

      {/*
        The two rules that surprise people, said once at the bottom: the top switch has no
        exceptions at all, and Tasks are not on this list.
      */}
      <div className="mt-4 space-y-1.5 border-t border-border pt-4">
        <p className="text-[12px] leading-5 text-muted-foreground">
          Tắt toàn bộ AVORA là tuyệt đối — kể cả Gia đình và cả khi có người nhắc tên bạn.
        </p>
        <p className="text-[12px] leading-5 text-muted-foreground">
          Nhiệm vụ không có tuỳ chọn tắt thông báo: đó là việc người khác đang chờ ở bạn, và cách
          làm nó im lặng là hoàn thành nó.
        </p>
      </div>
    </div>
  );
}
