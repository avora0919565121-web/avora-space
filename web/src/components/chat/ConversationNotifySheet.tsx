import { BellOff, BellRing, ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { StackedSheetHeader, useEdgeSwipeBack } from "@/components/chat/StackedSheetHeader";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { hereFrom, withReturn } from "@/lib/return-to";
import { shortUntil, useRhythm } from "@/lib/use-rhythm";

/** `?thong-tin=1` on a conversation reopens its `⋯` — where Cài đặt's ReturnChip lands (52.11). */
export const INFO_OPEN_PARAM = "thong-tin";

/**
 * `⋯` › Thông báo (AVORA-52 · C + AVORA-47 · B): mute this one conversation for 1 · 4 · 8 giờ or
 * until the end of today — never "until I turn it back on". The general settings are one line
 * below, and only that line leaves for Cài đặt (with the way back to this very `⋯`).
 */
export function ConversationNotifySheet({
  open,
  conversationId,
  title,
  stacked,
}: {
  open: boolean;
  conversationId: string;
  title: string;
  stacked: { backLabel: string; onBack: () => void; onCloseAll: () => void };
}) {
  const location = useLocation();
  const rhythm = useRhythm();
  const edgeSwipe = useEdgeSwipeBack(stacked.onBack);
  const mutedUntil = rhythm.conversationMutes.get(conversationId) ?? null;

  const params = new URLSearchParams(location.search);
  params.set(INFO_OPEN_PARAM, "1");
  const backHere = hereFrom({ pathname: location.pathname, search: `?${params.toString()}` }, title);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : stacked.onBack())}>
      <SheetContent
        side="right"
        {...edgeSwipe}
        className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md [&>button.absolute]:hidden"
      >
        <StackedSheetHeader backLabel={stacked.backLabel} onBack={stacked.onBack} onCloseAll={stacked.onCloseAll} />
        <div className="px-5 pb-2 pt-4">
          <SheetTitle className="text-[19px] font-semibold tracking-tight text-foreground">Thông báo</SheetTitle>
          <SheetDescription className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Chỉ cho cuộc này, luôn có hạn. Gia đình và tin Khẩn vẫn báo; trong nhóm, người nhắc tên bạn vẫn báo. Nhắc việc không bao giờ bị tắt.
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 scroll-y px-4 pb-6 pt-2">
          {mutedUntil !== null ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3.5 py-3">
              <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              <span className="min-w-0 flex-1 text-[14px] text-foreground">Đã tắt tới {shortUntil(mutedUntil)}</span>
              <button
                type="button"
                onClick={() => void rhythm.unmuteConversation(conversationId)}
                className="press inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-[13.5px] font-semibold text-primary hover:bg-primary/10"
              >
                <BellRing className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" /> Bật lại
              </button>
            </div>
          ) : (
            <>
              <p className="px-1 text-[13px] font-medium text-foreground">Tắt thông báo cuộc này</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {rhythm.muteChoices.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => void rhythm.muteConversation(conversationId, option)}
                    className="press h-12 rounded-xl border border-border bg-card text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <Link
            to={withReturn("/cai-dat/thong-bao", backHere)}
            className="press mt-5 flex min-h-11 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent/30 hover:text-foreground"
          >
            <span className="flex-1">Cài đặt thông báo chung</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
