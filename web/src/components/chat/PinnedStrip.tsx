import { Pin, PinOff, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { canPinForGroup, pinScopeLabel, PIN_LIMIT, type MessagePin } from "@/lib/pins";
import type { GroupRole } from "@/lib/groups";
import { messageBodyText, quotePreview, type ChatMessage } from "@/lib/chat";
import { cn } from "@/lib/utils";

/**
 * The pinned messages above a thread.
 *
 * Both kinds share one strip rather than sitting in two lists: somebody looking for "that
 * thing we pinned" does not remember which shelf they put it on, and two lists would make
 * them check both. Each row says whose pin it is, so the audience is never ambiguous — a
 * private bookmark must never look like something the room agreed to.
 */
export function PinnedStrip({
  pins,
  messages,
  viewerId,
  myRole,
  senderNameOf,
  onJumpTo,
  onUnpin,
  isWorking,
}: {
  pins: readonly MessagePin[];
  messages: readonly ChatMessage[];
  viewerId: string | undefined;
  myRole: GroupRole | undefined;
  senderNameOf: (message: ChatMessage) => string;
  onJumpTo: (messageId: string) => void;
  onUnpin: (pinId: string) => Promise<void>;
  isWorking: boolean;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (pins.length === 0) return null;

  const remove = async (pin: MessagePin): Promise<void> => {
    try {
      await onUnpin(pin.id);
      toast.success(pin.scope === "group" ? "Đã bỏ ghim của nhóm." : "Đã bỏ ghim riêng.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không bỏ ghim được.");
    }
  };

  /** Your own private pin is always yours to clear; a shared one belongs to the room. */
  const canUnpin = (pin: MessagePin): boolean =>
    pin.scope === "personal" ? pin.pinnedBy === viewerId : canPinForGroup(myRole);

  const groupCount = pins.filter((pin) => pin.scope === "group").length;
  const personalCount = pins.length - groupCount;

  return (
    <section
      aria-label="Tin nhắn đã ghim"
      className="border-b border-border bg-accent/25 px-5 py-2 md:px-10"
    >
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
          className="press flex w-full items-center gap-2 py-1 text-left"
        >
          <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
            {isOpen
              ? "Tin nhắn đã ghim"
              : (() => {
                  const first = pins[0];
                  if (first === undefined) return "Tin nhắn đã ghim";
                  const message = messages.find((entry) => entry.id === first.messageId);
                  return message === undefined
                    ? "Tin nhắn đã ghim"
                    : quotePreview(message, 60);
                })()}
          </span>
          <span className="tabular shrink-0 text-[11.5px] text-muted-foreground">
            {groupCount > 0 && personalCount > 0
              ? `${groupCount} nhóm · ${personalCount} riêng`
              : groupCount > 0
                ? `${groupCount}/${PIN_LIMIT} nhóm`
                : `${personalCount}/${PIN_LIMIT} riêng`}
          </span>
        </button>

        {isOpen ? (
          <ul className="rise-in mt-1 space-y-1 pb-1">
            {pins.map((pin) => {
              const message = messages.find((entry) => entry.id === pin.messageId);
              return (
                <li
                  key={pin.id}
                  className="flex items-start gap-2 rounded-[8px] border border-border bg-card px-2.5 py-2"
                >
                  <button
                    type="button"
                    onClick={() => onJumpTo(pin.messageId)}
                    className="press min-w-0 flex-1 text-left"
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-medium",
                          pin.scope === "group" ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {pinScopeLabel(pin.scope)}
                      </span>
                      {message !== undefined ? (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {senderNameOf(message)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-foreground">
                      {message === undefined
                        ? "Tin nhắn không còn trong phần đang xem"
                        : messageBodyText(message)}
                    </span>
                  </button>
                  {canUnpin(pin) ? (
                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => void remove(pin)}
                      aria-label="Bỏ ghim"
                      title="Bỏ ghim"
                      className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-45"
                    >
                      <PinOff className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The pin choice on a message.
 *
 * An officer is asked which audience they mean rather than having it assumed: an owner
 * bookmarking something privately is an ordinary thing to want, and silently publishing that
 * to the whole room would be the wrong default in the more damaging direction.
 */
export function PinChoiceDialog({
  open,
  onOpenChange,
  onChoose,
  groupFull,
  personalFull,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (scope: "group" | "personal") => void;
  groupFull: boolean;
  personalFull: boolean;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Chọn kiểu ghim"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-6"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-sm rounded-[14px] border border-border bg-card p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[15px] font-semibold text-foreground">Ghim tin nhắn này</p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Đóng"
            className="press rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 space-y-2">
          <button
            type="button"
            disabled={groupFull}
            onClick={() => onChoose("group")}
            className="press w-full rounded-[10px] border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="block text-[14px] font-medium text-foreground">Ghim cho cả nhóm</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {groupFull
                ? `Nhóm đã dùng hết ${PIN_LIMIT} ghim chung`
                : `Mọi thành viên đều thấy · tối đa ${PIN_LIMIT}`}
            </span>
          </button>
          <button
            type="button"
            disabled={personalFull}
            onClick={() => onChoose("personal")}
            className="press w-full rounded-[10px] border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="block text-[14px] font-medium text-foreground">Ghim cho riêng tôi</span>
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {personalFull
                ? `Bạn đã dùng hết ${PIN_LIMIT} ghim riêng`
                : `Chỉ bạn thấy · tối đa ${PIN_LIMIT}`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
