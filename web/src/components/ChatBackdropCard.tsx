import { MessageSquare } from "lucide-react";

import { CHAT_BACKDROPS, chatBackdropClass, useChatBackdrop, writeChatBackdrop } from "@/lib/chat-backdrop";
import { cn } from "@/lib/utils";

/** 101B · 4 — Nền trò chuyện. Each choice previews itself; a conversation's Không khí still wins. */
export function ChatBackdropCard() {
  const current = useChatBackdrop();
  return (
    <section aria-labelledby="chat-backdrop-heading" className="rounded-card border border-border bg-card p-s-4">
      <h2 id="chat-backdrop-heading" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight text-foreground">
        <MessageSquare className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
        Nền trò chuyện
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        Áp cho mọi cuộc trò chuyện trên máy này. Cuộc nào đã chọn Không khí riêng thì theo cuộc đó.
      </p>
      <div role="radiogroup" aria-label="Nền trò chuyện" className="mt-s-2 grid grid-cols-3 gap-2">
        {CHAT_BACKDROPS.map((option) => {
          const isActive = option.value === current;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => writeChatBackdrop(option.value)}
              className={cn(
                "press flex flex-col items-stretch gap-1.5 rounded-lg border p-1.5 text-[13px]",
                isActive ? "border-personal text-foreground" : "border-border text-muted-foreground",
              )}
            >
              <span className={cn("block h-14 rounded-md bg-background", chatBackdropClass(option.value))}>
                <span className="ml-auto mr-1.5 mt-2 block h-3 w-10 rounded-full bg-personal/80" />
                <span className="ml-1.5 mt-1.5 block h-3 w-12 rounded-full border border-border bg-card" />
              </span>
              <span className={cn(isActive && "font-semibold")}>{option.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
