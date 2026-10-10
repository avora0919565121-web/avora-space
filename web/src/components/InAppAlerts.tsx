import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  dueReminders,
  INCOMING_MESSAGE_EVENT,
  MESSAGE_SOUND_URL,
  REMINDER_SOUND_URL,
  shouldChime,
  surfaceOf,
  tabTitle,
  unreadConversationCount,
  type IncomingMessageSignal,
} from "@/lib/in-app-alerts";
import { isFamily } from "@/lib/family";
import { habitAlarms, habitChimeAllowed } from "@/lib/habits";
import { activeFocus } from "@/lib/mute";
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

/** Plays a short file; a browser that blocks sound before the first tap is simply ignored. */
function play(url: string): void {
  try {
    const audio = new Audio(url);
    audio.volume = 0.6;
    void audio.play().catch(() => undefined);
  } catch {
    // No audio on this device.
  }
}

/**
 * AVORA-107 · 1.2 · 4: the habit chime — one soft, short tone made on the device, quieter than the
 * task reminder file, so the two never sound alike.
 */
function playSoftTone(): void {
  try {
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context === undefined) return;
    const context = new Context();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);
    gain.connect(context.destination);
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(660, context.currentTime);
    tone.connect(gain);
    tone.start();
    tone.stop(context.currentTime + 0.95);
    tone.onended = () => void context.close().catch(() => undefined);
  } catch {
    // No audio on this device.
  }
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
  const { data: conversations } = useConversations();
  const { data: settings } = useProfileSettings();
  const { decide } = useMuteSettings();
  const { index: familyIndex } = useFamilyRelations();
  const { data: tasks } = useTasks();
  const { data: reminders } = useTaskReminders();
  const { data: records } = useThinkRecords();
  const { habits, done: habitDone, today: habitDay } = useHabits();

  const soundMessages = settings?.soundMessages ?? true;
  const soundReminders = settings?.soundReminders ?? true;

  const count = useMemo(() => unreadConversationCount(conversations ?? [], decide), [conversations, decide]);

  useEffect(() => {
    document.title = tabTitle(count);
    const nav = navigator as Navigator & { setAppBadge?: (value?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
      else void nav.clearAppBadge?.().catch(() => undefined);
    } catch {
      // Badging API not supported: nothing to do.
    }
  }, [count]);

  useEffect(() => () => {
    document.title = "AVORA";
  }, []);

  // Message sound.
  const lastChimeRef = useRef<number>(0);
  const latest = useRef({ conversations, decide, familyIndex, soundMessages });
  latest.current = { conversations, decide, familyIndex, soundMessages };
  useEffect(() => {
    const onIncoming = (event: Event): void => {
      const signal = (event as CustomEvent<IncomingMessageSignal>).detail;
      const { conversations: list, decide: decideNow, familyIndex: family, soundMessages: on } = latest.current;
      const summary = (list ?? []).find((item) => item.conversationId === signal.conversationId);
      const surface = surfaceOf(summary);
      if (surface === null) return;
      const decision = decideNow({
        surface,
        isFromFamily: isFamily(family, signal.senderId),
        mentionsRecipient: signal.mentionsViewer,
      });
      const now = Date.now();
      if (!shouldChime({ signal, soundOn: on, lastChimeAt: lastChimeRef.current, now, decision })) return;
      lastChimeRef.current = now;
      // AVORA-81 · C5: Đọc yên tĩnh — the message still arrives, no sound.
      if (isQuietReading()) return;
      play(MESSAGE_SOUND_URL);
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
      if (soundReminders && !blocked) play(REMINDER_SOUND_URL);
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
      if (soundReminders && !isQuietReading()) playSoftTone();
      for (const item of due.slice(0, 2)) {
        toast(item.title, { description: "Đến giờ thói quen", duration: 6_000, action: { label: "Mở", onClick: () => navigate(item.href) } });
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [habitCandidates, focusActive, restWeekday, soundReminders, decide, navigate]);

  return null;
}
