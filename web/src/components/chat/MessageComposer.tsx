import { ArrowUp, Keyboard, Mic, Smile } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
// The pure module, not "@/lib/chat": the composer needs no Supabase client to decide
// whether a draft can leave, which also keeps it renderable in isolation under test.
import { canSendDraft, SEND_EFFECTS, type SendEffect } from "@/lib/chat-cache";
import { StickerTray } from "@/components/chat/StickerTray";
import {
  activeMentionQuery,
  applyMention,
  filterMentionCandidates,
  type MentionCandidate,
} from "@/lib/mentions";
import { cn } from "@/lib/utils";
import {
  activeTrigger,
  applyRef,
  removeTrigger,
  suggestContactCards,
  suggestRefs,
  REF_KIND_LABEL,
  type CardSuggestion,
  type RefChoice,
  type RefContext,
  type Trigger,
} from "@/lib/context-refs";

/** Beyond this the composer stops growing and scrolls, so the thread keeps most of the screen. */
const MAX_COMPOSER_HEIGHT_PX = 160;

export type MessageComposerProps = {
  value: string;
  onValueChange: (next: string) => void;
  onSend: (content: string) => void;
  placeholder: string;
  ariaLabel: string;
  isSending: boolean;
  /** Sits on the same line as the text box — where the "+ Nhiệm vụ" button goes in a chat. */
  leadingAction?: ReactNode;
  /**
   * Who can be named here. Empty outside a group: a 1-1 has one other person, so naming them
   * says nothing the message did not already say.
   */
  mentionCandidates?: readonly MentionCandidate[];
  /**
   * How many files are waiting to go with this message. A photo with no caption is a real
   * message, so this is what lets "Gửi" light up on an empty text box.
   */
  attachmentCount?: number;
  /** The paperclip and microphone, on the same line as the text box. */
  trailingAction?: ReactNode;
  /** Thumbnails of what is attached, drawn above the box. */
  attachmentSlot?: ReactNode;
  /**
   * AVORA-49 · 2.3: with an empty box the send button is 🎙 — recording is one tap, not "+ › Ghi âm".
   * Omitted where recording is not possible.
   */
  onStartRecording?: () => void;
  urgent?: { blockedNote: string | null; onSendUrgent: (content: string) => void };
  /**
   * AVORA-89 · ADR-052 — where this composer stands. `#` and `@@` only suggest what the server
   * returns for this context; omitted = no `#` / `@@` here.
   */
  refContext?: RefContext;
  /** Shown above the picker: `Trong cuộc trò chuyện với Lan` / `Trong nhóm …` / `Riêng của bạn`. */
  contextLabel?: string;
  /** 1-1 only: the other person's name, for the `@` hint (nobody to name here). */
  directPeerName?: string;
  /** `#` chips chosen so far (the parent sends the ones still written in the text). */
  onRefsChange?: (refs: RefChoice[]) => void;
  /** `@@`: introduce one friend (name + PIN). */
  onShareCard?: (person: CardSuggestion) => void;
  /** K5 · 84 §4.2D: 🙂 opens the sticker tray in place of the keyboard; omitted = no stickers here. */
  onSendSticker?: (stickerId: string) => void;
  /** K5 · 84 §4.2A: holding Gửi offers four effects; omitted = no effects here. */
  onSendWithEffect?: (content: string, effect: SendEffect) => void;
};

/**
 * The one composer behind every thread — 1-1, group and Nhật ký all render this.
 *
 * AVORA-55 · 1 (cancels AVORA-49 · 2.5): a message leaves only through the Gửi button, on every
 * device. Enter — plain, Shift, Ctrl or Cmd — always writes a new line; no keyboard shortcut
 * sends. While an IME is still composing a Vietnamese letter (Telex / VNI), Enter finishes the
 * letter.
 */
export function MessageComposer({
  value,
  onValueChange,
  onSend,
  placeholder,
  ariaLabel,
  isSending,
  leadingAction,
  mentionCandidates = [],
  attachmentCount = 0,
  trailingAction,
  attachmentSlot,
  onStartRecording,
  urgent,
  refContext,
  contextLabel,
  directPeerName,
  onRefsChange,
  onShareCard,
  onSendSticker,
  onSendWithEffect,
}: MessageComposerProps) {
  const [isStickerTrayOpen, setIsStickerTrayOpen] = useState<boolean>(false);
  const [isEffectTrayOpen, setIsEffectTrayOpen] = useState<boolean>(false);
  const effectHoldRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [triggerCaret, setTriggerCaret] = useState<number>(0);
  const [refOptions, setRefOptions] = useState<RefChoice[]>([]);
  const [cardOptions, setCardOptions] = useState<CardSuggestion[]>([]);
  const [hashFilter, setHashFilter] = useState<"all" | "file" | "record" | "note">("all");
  const chosenRefsRef = useRef<RefChoice[]>([]);
  const isJournal = refContext === "journal";

  useEffect(() => {
    if (trigger === null || refContext === undefined) return;
    let cancelled = false;
    if (trigger.kind === "hash") {
      void suggestRefs(refContext, hashFilter, trigger.query).then(
        (rows) => !cancelled && setRefOptions(rows),
        () => !cancelled && setRefOptions([]),
      );
    } else if (trigger.kind === "atat" && !isJournal) {
      void suggestContactCards(refContext, trigger.query).then(
        (rows) => !cancelled && setCardOptions(rows),
        () => !cancelled && setCardOptions([]),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [trigger, refContext, hashFilter, isJournal]);

  const syncTrigger = useCallback(
    (text: string, caret: number): void => {
      if (refContext === undefined && directPeerName === undefined) return;
      const found = activeTrigger(text, caret);
      // Group `@` keeps the member picker; everything else is the context picker.
      setTrigger(found !== null && (found.kind !== "at" || directPeerName !== undefined) ? found : null);
      setTriggerCaret(caret);
    },
    [refContext, directPeerName],
  );

  const chooseRef = (ref: RefChoice): void => {
    if (trigger === null) return;
    const result = applyRef(value, trigger, triggerCaret, ref.label);
    chosenRefsRef.current = [...chosenRefsRef.current, ref];
    onRefsChange?.(chosenRefsRef.current);
    onValueChange(result.text);
    setTrigger(null);
    window.requestAnimationFrame(() => {
      fieldRef.current?.focus();
      fieldRef.current?.setSelectionRange(result.caret, result.caret);
    });
  };
  const chooseCard = (person: CardSuggestion): void => {
    if (trigger === null || !person.hasPin) return;
    onValueChange(removeTrigger(value, trigger, triggerCaret).text);
    setTrigger(null);
    onShareCard?.(person);
  };
  const [isUrgentMenuOpen, setIsUrgentMenuOpen] = useState<boolean>(false);
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef<boolean>(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const showMic = onStartRecording !== undefined && value.trim() === "" && attachmentCount === 0;
  const canSend: boolean = canSendDraft(value, isSending, attachmentCount);

  /**
   * The "@…" being typed, if any, and which suggestion is selected.
   *
   * Held as a range rather than just a query so the chosen name replaces exactly what was
   * typed — including when the caret is in the middle of an already-written sentence.
   */
  const [mentionRange, setMentionRange] = useState<{ start: number; caret: number } | null>(null);
  const [highlighted, setHighlighted] = useState<number>(0);

  const suggestions = useMemo(
    () =>
      mentionRange === null || mentionCandidates.length === 0
        ? []
        : filterMentionCandidates(mentionCandidates, value.slice(mentionRange.start + 1, mentionRange.caret)),
    [mentionRange, mentionCandidates, value],
  );

  /** Recomputed on every change of text or caret, so the picker follows the cursor. */
  const syncMentionRange = useCallback(
    (text: string, caret: number): void => {
      if (mentionCandidates.length === 0) {
        setMentionRange(null);
        return;
      }
      const found = activeMentionQuery(text, caret);
      setMentionRange(found === null ? null : { start: found.start, caret });
      setHighlighted(0);
    },
    [mentionCandidates.length],
  );

  const choose = useCallback(
    (candidate: MentionCandidate): void => {
      if (mentionRange === null) return;
      const result = applyMention(value, mentionRange, candidate);
      onValueChange(result.text);
      setMentionRange(null);
      // Put the caret after the inserted name, or the next keystroke lands in the wrong place.
      window.requestAnimationFrame(() => {
        const field = fieldRef.current;
        if (field === null) return;
        field.focus();
        field.setSelectionRange(result.caret, result.caret);
      });
    },
    [mentionRange, value, onValueChange],
  );

  // Grows with the draft instead of hiding earlier lines behind a one-line window.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + (field.offsetHeight - field.clientHeight), MAX_COMPOSER_HEIGHT_PX)}px`;
  }, [value]);

  const submit = useCallback((): void => {
    if (!canSendDraft(value, isSending, attachmentCount)) return;
    onSend(value.trim());
  }, [value, isSending, attachmentCount, onSend]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  /**
   * A textarea never submits a form on its own, but the form still holds other focusable
   * controls. Enter is neutralised everywhere except inside the text itself, so no
   * keystroke can send a message.
   */
  const blockEnterSubmit = useCallback((event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key !== "Enter") return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
  }, []);

  /**
   * While the picker is open the arrow keys and Enter belong to it, not to the text.
   *
   * Outside the picker there is nothing to handle: a textarea puts every Enter — plain, Shift,
   * Ctrl or Cmd — into the draft by itself, and no keystroke sends (AVORA-55 · 1).
   */
  const handleFieldKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (mentionRange === null || suggestions.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((current) => (current + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = suggestions[Math.min(highlighted, suggestions.length - 1)];
        if (candidate === undefined) return;
        event.preventDefault();
        choose(candidate);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionRange(null);
      }
    },
    [mentionRange, suggestions, highlighted, choose],
  );

  return (
    <>
      {attachmentSlot}
      <form
        className="mx-auto flex max-w-2xl items-end gap-1 md:gap-3 [&>*]:self-end"
        onSubmit={handleSubmit}
        onKeyDown={blockEnterSubmit}
      >
        {leadingAction}
        <div className="relative min-w-0 flex-1">
        {/*
          The suggestion list sits above the box rather than below it: the composer is already
          at the bottom of the screen, and a list below would be off it.
        */}
        {mentionRange !== null && suggestions.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Nhắc tên thành viên"
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 max-h-[220px] w-full max-w-[280px] overflow-y-auto rounded-[10px] border border-border bg-card p-1 shadow-lg"
          >
            {suggestions.map((candidate, index) => (
              <li key={candidate.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(candidate)}
                  className={cn(
                    "press w-full truncate rounded-[7px] px-2.5 py-2 text-left text-[13.5px] transition-colors",
                    index === highlighted
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {candidate.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {trigger !== null ? (
          <div
            data-context-picker={trigger.kind}
            className="absolute bottom-[calc(100%+6px)] left-0 z-20 w-full max-w-[340px] overflow-hidden rounded-[12px] border border-border bg-card shadow-lg"
          >
            {trigger.kind === "at" && directPeerName !== undefined ? (
              <p className="px-3 py-2.5 text-[13px] leading-snug text-muted-foreground" data-direct-at-hint="">
                Trong trò chuyện 1-1 không cần gọi tên {directPeerName}. <b className="font-semibold text-foreground">@@</b> để giới thiệu một người cho {directPeerName}.
              </p>
            ) : trigger.kind === "atat" ? (
              isJournal ? (
                <p className="px-3 py-2.5 text-[13px] text-muted-foreground">Nhật ký là của riêng bạn — không có ai để giới thiệu.</p>
              ) : (
                <>
                  <p className="border-b border-border/60 px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {directPeerName !== undefined ? `Giới thiệu cho ${directPeerName}` : "Giới thiệu cho nhóm"}
                    <span className="block text-[11.5px] font-normal normal-case tracking-normal">Chỉ gửi tên và PIN · không gửi số điện thoại, email</span>
                  </p>
                  <ul role="listbox" aria-label="Giới thiệu một người" className="max-h-[220px] overflow-y-auto p-1">
                    {cardOptions.length === 0 ? <li className="px-2.5 py-2 text-[13px] text-muted-foreground">Chưa có bạn Avora nào để giới thiệu ở đây.</li> : null}
                    {cardOptions.map((person) => (
                      <li key={person.userId}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          aria-disabled={!person.hasPin}
                          disabled={!person.hasPin}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => chooseCard(person)}
                          className="press flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[14px] hover:bg-accent/50 disabled:opacity-45"
                        >
                          <span className="min-w-0 flex-1 truncate">{person.name}</span>
                          <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{person.hasPin ? person.pin : "chưa có PIN"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : (
              <>
                <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
                  {contextLabel !== undefined ? <span className="mr-auto truncate pl-1 text-[11.5px] text-muted-foreground">{contextLabel}</span> : <span className="mr-auto" />}
                  {(isJournal ? (["all", "file", "record", "note"] as const) : (["all", "file", "record"] as const)).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setHashFilter(kind)}
                      aria-pressed={hashFilter === kind}
                      className={cn("press shrink-0 rounded-full px-2 py-0.5 text-[11.5px]", hashFilter === kind ? "bg-foreground text-background" : "text-muted-foreground")}
                    >
                      {kind === "all" ? "Tất cả" : kind === "file" ? "File" : kind === "record" ? "Hạng mục" : "Ghi chép"}
                    </button>
                  ))}
                </div>
                <ul role="listbox" aria-label="Gọi tài liệu" className="max-h-[220px] overflow-y-auto p-1">
                  {refOptions.length === 0 ? (
                    <li className="px-2.5 py-2 text-[13px] text-muted-foreground">{isJournal ? "Chưa có gì của riêng bạn khớp." : "Chưa có tệp nào trong cuộc trò chuyện này."}</li>
                  ) : null}
                  {refOptions.map((ref) => (
                    <li key={`${ref.kind}:${ref.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseRef(ref)}
                        className="press flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[14px] hover:bg-accent/50"
                      >
                        <span className="min-w-0 flex-1 truncate">{ref.label}</span>
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">{REF_KIND_LABEL[ref.kind]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}

        <textarea
          lang="vi"
          spellCheck
          ref={fieldRef}
          rows={1}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            syncMentionRange(event.target.value, event.target.selectionStart ?? 0);
            syncTrigger(event.target.value, event.target.selectionStart ?? 0);
          }}
          onKeyDown={handleFieldKeyDown}
          onClick={(event) => {
            // Moving the caret by mouse can land inside or outside an "@…", so the picker has
            // to be re-decided rather than left as it was.
            const field = event.currentTarget;
            syncMentionRange(field.value, field.selectionStart ?? 0);
          }}
          onFocus={() => setIsStickerTrayOpen(false)}
          onBlur={() => {
            setMentionRange(null);
            setTrigger(null);
          }}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={ariaLabel}
          enterKeyHint="enter"
          className="block min-h-11 w-full resize-none border-0 bg-transparent px-1 py-[11px] text-[16px] leading-[22px] text-foreground outline-none placeholder:truncate placeholder:text-muted-foreground/70 md:text-[15px]"
        />
      </div>
        {trailingAction}
        {onSendSticker !== undefined ? (
          <button
            type="button"
            data-sticker-toggle=""
            aria-label={isStickerTrayOpen ? "Về bàn phím" : "Sticker"}
            aria-expanded={isStickerTrayOpen}
            onClick={() => {
              if (isStickerTrayOpen) {
                setIsStickerTrayOpen(false);
                window.requestAnimationFrame(() => fieldRef.current?.focus());
              } else {
                fieldRef.current?.blur();
                setIsStickerTrayOpen(true);
              }
            }}
            className="press flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            {isStickerTrayOpen ? <Keyboard className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /> : <Smile className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />}
          </button>
        ) : null}
        {showMic ? (
          <button
            type="button"
            onClick={onStartRecording}
            disabled={isSending}
            aria-label="Ghi âm tin nhắn thoại"
            title="Ghi âm"
            className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45"
          >
            <Mic className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : urgent === undefined ? (
          <span className="relative shrink-0">
          {isEffectTrayOpen ? (
            <span
              role="menu"
              aria-label="Gửi kèm hiệu ứng"
              data-effect-tray=""
              className="absolute bottom-[calc(100%+6px)] right-0 z-30 flex gap-1 rounded-full border border-border bg-card p-1 shadow-lg"
            >
              {SEND_EFFECTS.map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  role="menuitem"
                  aria-label={`Gửi kèm ${effect.label}`}
                  onClick={() => {
                    setIsEffectTrayOpen(false);
                    if (!canSendDraft(value, isSending, attachmentCount)) return;
                    onSendWithEffect?.(value.trim(), effect.id);
                  }}
                  className="press flex min-h-11 min-w-11 flex-col items-center justify-center rounded-full px-1.5 text-[18px] hover:bg-accent/50"
                >
                  <span aria-hidden="true">{effect.emoji}</span>
                  <span className="text-[10px] leading-none text-muted-foreground">{effect.label}</span>
                </button>
              ))}
            </span>
          ) : null}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Gửi"
            title={onSendWithEffect ? "Gửi · giữ để gửi kèm hiệu ứng" : "Gửi"}
            data-composer-send=""
            onPointerDown={() => {
              if (onSendWithEffect === undefined || !canSend) return;
              effectHoldRef.current.fired = false;
              effectHoldRef.current.timer = setTimeout(() => {
                effectHoldRef.current.fired = true;
                setIsEffectTrayOpen(true);
              }, 450);
            }}
            onPointerUp={() => {
              if (effectHoldRef.current.timer !== null) clearTimeout(effectHoldRef.current.timer);
              effectHoldRef.current.timer = null;
            }}
            onPointerLeave={() => {
              if (effectHoldRef.current.timer !== null) clearTimeout(effectHoldRef.current.timer);
              effectHoldRef.current.timer = null;
            }}
            onClick={(event) => {
              // A hold opened the effect tray: that press is not a send.
              if (effectHoldRef.current.fired) {
                event.preventDefault();
                effectHoldRef.current.fired = false;
              } else if (isEffectTrayOpen) {
                setIsEffectTrayOpen(false);
              }
            }}
            onContextMenu={(event) => {
              if (onSendWithEffect !== undefined) event.preventDefault();
            }}
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-personal transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground"
          >
            <ArrowUp className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          </button>
          </span>
        ) : (
          <DropdownMenu open={isUrgentMenuOpen} onOpenChange={setIsUrgentMenuOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Gửi · giữ để gửi khẩn"
                title="Gửi · giữ để gửi khẩn"
                // The trigger opens only on hold / right-click; a tap still submits the form.
                onPointerDown={(event) => {
                  event.preventDefault();
                  heldRef.current = false;
                  holdTimerRef.current = window.setTimeout(() => {
                    heldRef.current = true;
                    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
                    setIsUrgentMenuOpen(true);
                  }, 500);
                }}
                onPointerUp={() => {
                  if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = null;
                }}
                onPointerLeave={() => {
                  if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = null;
                }}
                onClick={(event) => {
                  if (heldRef.current) {
                    event.preventDefault();
                    heldRef.current = false;
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (canSend) setIsUrgentMenuOpen(true);
                }}
                onKeyDown={(event) => {
                  // Keyboard users: Enter/Space submit as usual; the menu never steals them.
                  if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                }}
                data-composer-send=""
                className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-personal transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-64">
              {onSendWithEffect !== undefined ? (
                <div role="group" aria-label="Gửi kèm hiệu ứng" data-effect-tray="" className="grid grid-cols-4 gap-1 border-b border-border p-1 pb-1.5">
                  {SEND_EFFECTS.map((effect) => (
                    <DropdownMenuItem
                      key={effect.id}
                      disabled={!canSend}
                      aria-label={`Gửi kèm ${effect.label}`}
                      onSelect={() => {
                        if (!canSendDraft(value, isSending, attachmentCount)) return;
                        onSendWithEffect(value.trim(), effect.id);
                      }}
                      className="flex min-h-12 flex-col items-center justify-center gap-0.5 px-0.5 text-[18px]"
                    >
                      <span aria-hidden="true">{effect.emoji}</span>
                      <span className="text-[10px] leading-none text-muted-foreground">{effect.label}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
              ) : null}
              <DropdownMenuItem
                disabled={urgent.blockedNote !== null || !canSend}
                onSelect={() => {
                  if (!canSendDraft(value, isSending, attachmentCount)) return;
                  urgent.onSendUrgent(value.trim());
                }}
                className="min-h-11 gap-2 font-medium text-destructive"
              >
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold">Khẩn</span>
                Gửi khẩn
              </DropdownMenuItem>
              <DropdownMenuLabel className="text-[11.5px] font-normal leading-snug text-muted-foreground">
                {urgent.blockedNote ?? "Vẫn báo cả khi người nhận đang tập trung hoặc tắt cuộc này. Mỗi cuộc 1 lần/ngày."}
              </DropdownMenuLabel>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </form>
      {isStickerTrayOpen && onSendSticker !== undefined ? (
        <StickerTray
          onPick={(id) => {
            onSendSticker(id);
          }}
        />
      ) : null}
    </>
  );
}
