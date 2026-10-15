import { askConfirm } from "@/components/ConfirmHost";
import { countDrafts } from "@/lib/chat-drafts";
import { outboxStore } from "@/lib/outbox";

/** 112-C: what signing out would remove from this device before it reached the server. */
export type UnsyncedWork = { messages: number; drafts: number };

export async function unsyncedWork(userId: string | undefined): Promise<UnsyncedWork> {
  if (userId === undefined) return { messages: 0, drafts: 0 };
  const items = await outboxStore.all(userId).catch(() => []);
  return { messages: items.length, drafts: countDrafts(userId) };
}

/** The warning, in plain words; null when nothing would be lost. */
export function unsyncedWarning(work: UnsyncedWork): { title: string; body: string } | null {
  if (work.messages === 0 && work.drafts === 0) return null;
  const parts: string[] = [];
  if (work.messages > 0) parts.push(`${work.messages} tin chưa gửi`);
  if (work.drafts > 0) parts.push(`${work.drafts} bản nháp`);
  return {
    title: `Còn ${parts.join(" và ")}`,
    body:
      work.messages > 0
        ? "Đăng xuất bây giờ sẽ xoá chúng khỏi máy này — tin chưa gửi sẽ không bao giờ tới người nhận. Chờ có mạng để gửi xong rồi hãy đăng xuất."
        : "Đăng xuất bây giờ sẽ xoá các bản nháp trên máy này.",
  };
}

/**
 * Asks before a sign-out that would silently drop unsent messages or drafts. True = go ahead.
 * Never deletes anything itself; the sign-out does, only after the person chose to.
 */
export async function confirmSignOut(userId: string | undefined): Promise<boolean> {
  const warning = unsyncedWarning(await unsyncedWork(userId));
  if (warning === null) return true;
  return askConfirm({ title: warning.title, body: warning.body, confirmLabel: "Vẫn đăng xuất", cancelLabel: "Chờ gửi xong", danger: true });
}
