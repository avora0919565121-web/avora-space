import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  chimeDecision,
  dueReminders,
  INCOMING_MESSAGE_EVENT,
  surfaceOf,
  tabTitle,
  unreadConversationCount,
  type IncomingMessageSignal,
} from "@/lib/in-app-alerts";
import { isFamily } from "@/lib/family";
import { habitAlarms, habitChimeAllowed } from "@/lib/habits";
import { activeFocus, toConversationMutes } from "@/lib/mute";
import { logError } from "@/lib/log";
import { soundPlayer, type PlayResult, type SoundKind } from "@/lib/sound";
import { recordSoundOutcome, SOUND_TEXT } from "@/lib/sound-log";
import { useAuth } from "@/lib/auth";
import { isQuietReading } from "@/lib/quiet-reading";
import { taskLink } from "@/lib/task-scope";
import { useConversations } from "@/lib/use-conversations";
import { useHabits } from "@/lib/use-habits";
import { useFamilyRelations } from "@/lib/use-family";
import { useMuteSettings } from "@/lib/use-mute";
import { useProfileSettings } from "@/lib/use-settings";
import { useTaskReminders } from "@/lib/use-task-meta";
import { useTasks } from "@/lib/use-tasks";
import { useThinkRecords } from "@/lib/use-think-hub";
import { useChatLock } from "@/lib/use-chat-lock";

/** AVORA-114: the banner shows at most once per session (per tab). */
const BANNER_SHOWN_KEY = "avora.sound-banner-shown";

function bannerAlreadyShown(): boolean {
  try {
    return window.sessionStorage.getItem(BANNER_SHOWN_KEY) === "1";
  } catch (error) {
    logError("sound", { code: "banner_storage", name: error instanceof Error ? error.name : undefined });
    return false;
  }
}

function markBannerShown(): void {
  try {
    window.sessionStorage.setItem(BANNER_SHOWN_KEY, "1");
  } catch (error) {
    // Storage off: the banner may show once more in this session, which is harmless.
    logError("sound", { code: "banner_storage", name: error instanceof Error ? error.name : undefined });
  }
}

/** Plays through the shared player; a refusal or failure is logged, never swallowed. */
async function play(kind: SoundKind): Promise<PlayResult> {
  const result = await soundPlayer().play(kind);
  if (result.status === "failed") logError("sound", { code: `${kind}_${result.reason}`, name: result.name });
  return result;
}

/**
 * Sounds, tab title and app-icon badge while AVORA is open (Đợt gộp 2 · A11). Renders nothing.
 *
 * - Tab title "(3) AVORA" and the installed app's badge: conversations with unread messages,
 *   exactly like the Kết nối count, minus muted ones.
 * - One soft sound for a message elsewhere (or while in a background tab), never for the thread
 *   being read; many within 3 seconds sound once. Every sound obeys the mute rules.
 * - A different sound + a toast with "Mở" when a task reminder, a departure or a Hạng mục's
 *   reminder comes due.
 */
export function InAppAlerts() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: conversations } = useConversations();
  const { data: settings } = useProfileSettings();
  const { decide, settings: muteSettings } = useMuteSettings();
  const conversationMutes = useMemo(() => toConversationMutes(muteSettings), [muteSettings]);
  const [showBanner, setShowBanner] = useState<boolean>(false);

  // Arm the unlock-on-first-tap listeners as soon as the signed-in app mounts.
  useEffect(() => {
    const player = soundPlayer();
    return player.subscribe((unlocked) => {
      if (unlocked) setShowBanner(false);
    });
  }, []);
  const { index: familyIndex } = useFamilyRelations();
  const { data: tasks } = useTasks();
  const { data: reminders } = useTaskReminders();
  const { data: records } = useThinkRecords();
  const { habits, done: habitDone, today: habitDay } = useHabits();

  const soundMessages = settings?.soundMessages ?? true;
  const soundReminders = settings?.soundReminders ?? true;

  const { isLocked: isChatLocked } = useChatLock();
  // AVORA-109 · A1: while Kết nối is locked, the title and the app-icon badge carry no count either.
  const count = useMemo(
    () => (isChatLocked ? 0 : unreadConversationCount(conversations ?? [], decide)),
    [conversations, decide, isChatLocked],
  );

  useEffect(() => {
    document.title = tabTitle(count);
    const nav = navigator as Navigator & { setAppBadge?: (value?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const onBadgeError = (error: unknown): void => logError("badge", { code: "set_badge", name: error instanceof Error ? error.name : undefined });
    try {
      if (count > 0) void nav.setAppBadge?.(count).catch(onBadgeError);
      else void nav.clearAppBadge?.().catch(onBadgeError);
    } catch (error) {
      onBadgeError(error);
    }
  }, [count]);

  useEffect(() => () => {
    document.title = "AVORA";
  }, []);

  // Message sound.
  const lastChimeRef = useRef<number>(0);
  const focus = activeFocus(settings?.focusMode, settings?.focusUntil);
  const latest = useRef({ conversations, decide, familyIndex, soundMessages, conversationMutes, focus, viewerId: user?.id });
  latest.current = { conversations, decide, familyIndex, soundMessages, conversationMutes, focus, viewerId: user?.id };
  useEffect(() => {
    const onIncoming = (event: Event): void => {
      const signal = (event as CustomEvent<IncomingMessageSignal>).detail;
      const { conversations: list, decide: decideNow, familyIndex: family, soundMessages: on, conversationMutes: mutes, focus: focusNow, viewerId } = latest.current;
      const summary = (list ?? []).find((item) => item.conversationId === signal.conversationId);
      const surface = surfaceOf(summary);
      // Nhật ký never makes a sound, and is not a message from someone else either.
      if (surface === null) return;
      // AVORA-114 · 4: every layer, including the per-conversation mute and Chế độ tập trung (both
      // were missed before — the in-app sound only read the tab layers).
      const decision = decideNow({
        surface,
        isFromFamily: isFamily(family, signal.senderId),
        mentionsRecipient: signal.mentionsViewer,
        isUrgent: signal.isUrgent === true,
        conversationMuted: mutes.has(signal.conversationId),
        focus: focusNow,
      });
      const now = Date.now();
      const verdict = chimeDecision({
        signal,
        viewerId,
        soundOn: on,
        quietReading: isQuietReading(),
        lastChimeAt: lastChimeRef.current,
        now,
        decision,
      });
      if (verdict === "own") return;
      if (verdict !== "play") {
        recordSoundOutcome({ at: now, outcome: verdict });
        return;
      }
      lastChimeRef.current = now;
      void play("message").then((result) => {
        if (result.status === "played") recordSoundOutcome({ at: now, outcome: "played" });
        else if (result.status === "locked") {
          recordSoundOutcome({ at: now, outcome: "locked" });
          // A locked sound does not use up the 3-second window: the next message may try again.
          lastChimeRef.current = 0;
          if (!bannerAlreadyShown()) {
            markBannerShown();
            setShowBanner(true);
          }
        } else recordSoundOutcome({ at: now, outcome: "error", detail: result.name ?? result.reason });
      });
    };
    window.addEventListener(INCOMING_MESSAGE_EVENT, onIncoming);
    return () => window.removeEventListener(INCOMING_MESSAGE_EVENT, onIncoming);
  }, []);

  // Reminder sound: checked every 30 seconds against what is due.
  const rungRef = useRef<Set<string>>(new Set());
  const candidates = useMemo(() => {
    const byId = new Map((tasks ?? []).map((task) => [task.id, task] as const));
    const list: { key: string; at: string | null; title: string; href: string }[] = [];
    for (const reminder of reminders ?? []) {
      const task = byId.get(reminder.taskId);
      // D4: a reminder of work that is finished, skipped or closed never rings.
      if (task === undefined || task.status === "done" || task.status === "skipped") continue;
      list.push({ key: `r:${reminder.id}`, at: reminder.at, title: task.title, href: taskLink(task.id) });
    }
    for (const task of tasks ?? []) {
      if (task.status === "done" || task.status === "skipped") continue;
      list.push({ key: `d:${task.id}:${task.departureReminderAt ?? ""}`, at: task.departureReminderAt, title: `Đến giờ đi · ${task.title}`, href: taskLink(task.id) });
    }
    for (const record of records ?? []) {
      list.push({
        key: `h:${record.id}:${record.remindAt ?? ""}`,
        at: record.remindAt,
        title: record.title,
        href: `/ke-hoach?bang=${encodeURIComponent(record.tableId)}&hang-muc=${encodeURIComponent(record.id)}`,
      });
    }
    return list;
  }, [tasks, reminders, records]);

  useEffect(() => {
    const check = (): void => {
      const due = dueReminders(candidates, rungRef.current, Date.now());
      if (due.length === 0) return;
      due.forEach((item) => rungRef.current.add(item.key));
      const blocked = decide({ surface: "direct", isFromFamily: false, mentionsRecipient: false }).decidedBy === "avora";
      if (soundReminders && !blocked) void play("reminder");
      for (const item of due.slice(0, 3)) {
        toast(item.title, { description: "Đến giờ nhắc", action: { label: "Mở", onClick: () => navigate(item.href) } });
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [candidates, soundReminders, decide, navigate]);

  // AVORA-107 · 1.2 · 4: habit windows. Quiet wins (focus, Tắt toàn AVORA, rest day): no sound,
  // no toast — the habit still hangs in Hôm nay. Task reminders above are untouched.
  const habitRungRef = useRef<Set<string>>(new Set());
  const habitCandidates = useMemo(
    () => habitAlarms(habits, habitDone, habitDay).map((alarm) => ({ key: alarm.key, at: alarm.at, title: alarm.title, href: "/nhiem-vu?muc=thoi-quen" })),
    [habits, habitDone, habitDay],
  );
  const focusActive = activeFocus(settings?.focusMode, settings?.focusUntil) !== null;
  const restWeekday = settings?.restWeekday ?? 0;
  useEffect(() => {
    const check = (): void => {
      const due = dueReminders(habitCandidates, habitRungRef.current, Date.now());
      if (due.length === 0) return;
      due.forEach((item) => habitRungRef.current.add(item.key));
      const avoraMuted = decide({ surface: "direct", isFromFamily: false, mentionsRecipient: false }).decidedBy === "avora";
      if (!habitChimeAllowed({ focusActive, avoraMuted, restWeekday, now: new Date(), soundOn: true })) return;
      if (soundReminders && !isQuietReading()) void play("habit");
      for (const item of due.slice(0, 2)) {
        toast(item.title, { description: "Đến giờ thói quen", duration: 6_000, action: { label: "Mở", onClick: () => navigate(item.href) } });
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [habitCandidates, focusActive, restWeekday, soundReminders, decide, navigate]);

  if (!showBanner) return null;
  // Not a toast and not blocking: a small strip; a tap anywhere (including on it) unlocks and hides it.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+8px)]">
      <button
        type="button"
        data-testid="sound-unlock-banner"
        onClick={() => {
          void soundPlayer().unlock();
          setShowBanner(false);
        }}
        className="press pointer-events-auto rounded-full border border-border bg-card/95 px-4 py-2 text-[13px] font-medium text-foreground shadow-sm backdrop-blur"
      >
        {SOUND_TEXT.banner}
      </button>
    </div>
  );
}
