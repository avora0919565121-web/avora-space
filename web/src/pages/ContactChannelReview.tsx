import { ChevronLeft, Check, Mail, Phone, Trash2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { carryReturn, readReturn } from "@/lib/return-to";
import { useBack } from "@/lib/go-back";
import { useBackPress } from "@/hooks/use-back-press";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { SharedChannelCard } from "@/components/contacts/SharedChannelCard";
import { Button } from "@/components/ui/button";
import {
  channelSourceLabel,
  type ChannelKind,
  type ContactChannel,
  type SharedChannelChoice,
  type SharedChannelGroup,
} from "@/lib/contact-channels";
import { formatPhoneForDisplay } from "@/lib/contact-clean";
import { type Contact } from "@/lib/contacts";
import {
  useContactChannelActions,
  useContactsNeedingReview,
  useSharedChannelFix,
  useSharedChannels,
} from "@/lib/use-contact-channels";

/**
 * The numbers and addresses an import brought in that nobody has vouched for yet.
 *
 * An import can tell that a person has three phone numbers; it cannot tell which one they
 * actually answer. Rather than guess — and quietly make the wrong one primary — every extra
 * channel arriving from a file or a phone book is flagged, and this screen is where the one
 * person who knows says so.
 *
 * Confirming is the ordinary act and reads as "đúng rồi", not as an edit: most of these values
 * are correct, and the flag is about attention, not suspicion.
 *
 * Two different questions live here, in two blocks that never mix. One asks which of a person's
 * several numbers is real; the other asks which person a single number belongs to. They read
 * almost identically as sentences and mean opposite things, so interleaving them would turn every
 * row into a small puzzle about what is being asked.
 */
const ContactChannelReview = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = readReturn(searchParams);
  // AVORA-94B · luật 1: one way back (history → `tu` → Kết nối › 1-1).
  const back = useBack({ path: "/tin-nhan?tab=1-1", label: returnTo?.label ?? "Liên hệ" });
  const { groups, isPending, isError, error } = useContactsNeedingReview();
  const shared = useSharedChannels();
  const { confirm, remove, promote, keepAll, restoreFlags, isWorking } = useContactChannelActions();
  const { apply, isWorking: isFixing } = useSharedChannelFix();
  const [notice, setNotice] = useState<string | null>(null);

  const act = useCallback(async (run: () => Promise<void>): Promise<void> => {
    setNotice(null);
    try {
      await run();
    } catch (problem) {
      setNotice((problem as Error).message);
    }
  }, []);

  /**
   * A cleanup that only partly worked says which contacts refused and why. Reporting just
   * "failed" would leave someone re-pressing a button that is doing most of its job.
   */
  const fix = useCallback(
    async (group: SharedChannelGroup, choice: SharedChannelChoice): Promise<void> => {
      setNotice(null);
      try {
        const outcome = await apply(group, choice);
        if (outcome.failures.length > 0) {
          const names = outcome.failures.map((entry) => entry.contactName).join(", ");
          setNotice(`Chưa bỏ được khỏi: ${names}. ${outcome.failures[0].reason}`);
        }
      } catch (problem) {
        setNotice((problem as Error).message);
      }
    },
    [apply],
  );

  /**
   * AVORA-58 · 2: one press answers the whole list. The cleared ids ride in the toast so
   * `Hoàn tác` puts back exactly those flags — nothing raised since then gets touched.
   */
  const keepEverything = useCallback(async (): Promise<void> => {
    setNotice(null);
    try {
      const cleared = await keepAll();
      if (cleared.length === 0) return;
      toast(`Đã giữ ${cleared.length} số điện thoại và email`, {
        duration: 8000,
        action: {
          label: "Hoàn tác",
          onClick: () => {
            void restoreFlags(cleared).catch((problem: unknown) => {
              toast("Chưa hoàn tác được", { description: (problem as Error).message });
            });
          },
        },
      });
    } catch (problem) {
      setNotice((problem as Error).message);
    }
  }, [keepAll, restoreFlags]);

  const pendingCount: number = groups.reduce((sum, group) => sum + group.channels.length, 0);

  const openContact = useCallback(
    (contactId: string): void => {
      // AVORA-53 · 2.4: the way back keeps travelling with the person.
      const carried = carryReturn(searchParams, new URLSearchParams()).toString();
      navigate(carried.length > 0 ? `/lien-he/${contactId}?${carried}` : `/lien-he/${contactId}`);
    },
    [navigate, searchParams],
  );

  if (isPending || shared.isPending) {
    return (
      <Shell backLabel={back.label} onBack={back.back}>
        <div className="space-y-3" aria-hidden="true">
          <div className="h-[92px] animate-pulse rounded-xl bg-secondary/70" />
          <div className="h-[92px] animate-pulse rounded-xl bg-secondary/50" />
        </div>
      </Shell>
    );
  }

  if (isError || shared.isError) {
    return (
      <Shell backLabel={back.label} onBack={back.back}>
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px] text-muted-foreground">
            {error?.message ?? shared.error?.message ?? "Không đọc được danh sách cần xem lại."}
          </p>
        </div>
      </Shell>
    );
  }

  /**
   * An empty list here is a finished job, not a missing feature, so it says so and points back
   * to the address book instead of leaving a blank page with nothing to do.
   */
  if (groups.length === 0 && shared.groups.length === 0) {
    return (
      <Shell backLabel={back.label} onBack={back.back}>
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/50">
            <Check className="h-6 w-6 text-money-in" strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="mt-4 text-[15px] font-medium text-foreground">Không còn gì cần xem lại</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
            Mọi số điện thoại và email trong danh bạ của bạn đều đã được xác nhận.
          </p>
          <Button variant="outline" className="press mt-5 h-10 px-4" onClick={() => navigate("/lien-he")}>
            Về danh bạ
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell backLabel={back.label} onBack={back.back}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Cần xem lại</h1>
          <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Không bắt buộc. AVORA không tự chọn giúp bạn — xem khi rảnh, hoặc giữ tất cả một lần.
          </p>
        </div>
        {pendingCount > 0 ? (
          <Button
            className="press h-11 shrink-0 gap-1.5 px-4 text-[14px]"
            disabled={isWorking}
            onClick={() => void keepEverything()}
          >
            <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Giữ tất cả ({pendingCount})
          </Button>
        ) : null}
      </header>

      {notice !== null ? (
        <p role="alert" className="mt-4 text-[13px] text-primary">
          {notice}
        </p>
      ) : null}

      {/* Each block only exists when it has something in it: an empty heading is a to-do list
          item that cannot be done. */}
      {groups.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-[16px] font-semibold text-foreground">
            {groups.length} liên hệ có nhiều số điện thoại hoặc email
          </h2>
          <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
            Chưa biết số nào mới là số họ dùng.
          </p>
          <ul className="mt-4 space-y-4">
            {groups.map((group) => (
              <ReviewCard
                key={group.contact.id}
                contact={group.contact}
                channels={group.channels}
                isWorking={isWorking}
                onOpen={() => openContact(group.contact.id)}
                onKeepAll={(ids) => void act(async () => {
                  for (const id of ids) await confirm(id);
                })}
                onPromote={(channelId) => void act(() => promote(channelId))}
                onRemove={(channelId) => void act(() => remove(channelId))}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {shared.groups.length > 0 ? (
        <section className="mt-9">
          <h2 className="text-[16px] font-semibold text-foreground">
            {shared.groups.length} số điện thoại hoặc email đang dùng chung
          </h2>
          <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
            Cùng một cách liên lạc đang nằm ở nhiều liên hệ — có thể là số chung của một nơi làm
            việc, hoặc đã gõ vào đúng một dòng không phải của nó.
          </p>
          <ul className="mt-4 space-y-4">
            {shared.groups.map((group) => (
              <SharedChannelCard
                key={group.key}
                group={group}
                isWorking={isFixing}
                onApply={(choice) => void fix(group, choice)}
                onOpenContact={openContact}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
};

/** `Hùng có 2 số điện thoại. Số nào đang dùng?` — the question a review card asks (AVORA-57 · J). */
export function reviewQuestion(name: string, kind: ChannelKind, count: number): string {
  const who = name.trim() === "" ? "Liên hệ này" : name.trim();
  return kind === "phone"
    ? `${who} có ${count} số điện thoại. Số nào đang dùng?`
    : `${who} có ${count} email. Email nào đang dùng?`;
}

/**
 * One contact, one question per ambiguous kind (AVORA-57 · J). The contact's own value is shown
 * as `Số chính` / `Email chính`; each flagged value can become the main one or be removed, and
 * `Giữ cả hai` (or `Giữ tất cả`) answers "both are used".
 */
function ReviewCard({
  contact,
  channels,
  isWorking,
  onOpen,
  onKeepAll,
  onPromote,
  onRemove,
}: {
  contact: Contact;
  channels: readonly ContactChannel[];
  isWorking: boolean;
  onOpen: () => void;
  onKeepAll: (channelIds: string[]) => void;
  onPromote: (channelId: string) => void;
  onRemove: (channelId: string) => void;
}) {
  const kinds: ChannelKind[] = (["phone", "email"] as const).filter((kind) => channels.some((channel) => channel.kind === kind));
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onOpen}
        className="press flex w-full min-w-0 items-center gap-3 border-b border-border px-5 py-3.5 text-left"
      >
        <InitialsAvatar name={contact.name} size="sm" />
        <span className="block min-w-0 truncate text-[15px] font-semibold text-foreground">{contact.name}</span>
      </button>

      {kinds.map((kind) => {
        const flagged = channels.filter((channel) => channel.kind === kind);
        const primary = (kind === "phone" ? contact.phone : contact.email)?.trim() ?? "";
        const total = flagged.length + (primary === "" ? 0 : 1);
        const show = (value: string): string => (kind === "phone" ? formatPhoneForDisplay(value) : value);
        return (
          <div key={kind} className="border-b border-border last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-1 pt-3.5">
              <p className="text-[14px] font-medium text-foreground">{reviewQuestion(contact.name, kind, total)}</p>
              <Button
                variant="outline"
                className="press h-9 gap-1.5 px-3.5 text-[13px]"
                disabled={isWorking}
                onClick={() => onKeepAll(flagged.map((channel) => channel.id))}
              >
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                {total === 2 ? "Giữ cả hai" : "Giữ tất cả"}
              </Button>
            </div>
            <ul>
              {primary !== "" ? (
                <li className="flex items-center gap-3 px-5 py-2.5">
                  <ChannelIcon kind={kind} />
                  <span className="min-w-0 flex-1">
                    <span className="tabular block truncate text-[14.5px] text-foreground">{show(primary)}</span>
                    <span className="block text-[12px] font-medium text-primary">{kind === "phone" ? "Số chính" : "Email chính"}</span>
                  </span>
                </li>
              ) : null}
              {flagged.map((channel) => (
                <li key={channel.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <ChannelIcon kind={channel.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="tabular block truncate text-[14.5px] text-foreground">{show(channel.value)}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {channel.label !== null ? `${channel.label} · ` : ""}
                      {channelSourceLabel(channel.source)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="ghost"
                      aria-label={`Đặt ${channel.value} làm ${kind === "phone" ? "số chính" : "email chính"}`}
                      className="press h-9 px-3 text-[13px]"
                      disabled={isWorking}
                      onClick={() => onPromote(channel.id)}
                    >
                      {kind === "phone" ? "Số chính" : "Email chính"}
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label={`Xoá ${channel.value}`}
                      className="press h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
                      disabled={isWorking}
                      onClick={() => onRemove(channel.id)}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </li>
  );
}

function ChannelIcon({ kind }: { kind: ChannelKind }) {
  const Icon = kind === "phone" ? Phone : Mail;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/70">
      <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
    </span>
  );
}

function Shell({ children, onBack, backLabel }: { children: ReactNode; onBack: () => void; backLabel: string }) {
  const backPress = useBackPress(onBack);
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-3xl px-6 py-10 md:px-10">
        <button
          type="button"
          {...backPress}
          data-back=""
          className="press no-callout mb-6 inline-flex min-h-11 max-w-full select-none items-center gap-1 text-[13.5px] font-medium text-muted-foreground transition-colors [touch-action:manipulation] hover:text-foreground"
        >
          <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span className="truncate">{backLabel}</span>
        </button>
        {children}
      </div>
    </div>
  );
}

export default ContactChannelReview;
