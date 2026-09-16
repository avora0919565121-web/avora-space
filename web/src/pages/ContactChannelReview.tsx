import { ArrowLeft, Check, Mail, Phone, Trash2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

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
  const { groups, isPending, isError, error } = useContactsNeedingReview();
  const shared = useSharedChannels();
  const { confirm, confirmContact, remove, isWorking } = useContactChannelActions();
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

  const openContact = useCallback(
    (contactId: string): void => {
      navigate(`/lien-he/${contactId}`);
    },
    [navigate],
  );

  if (isPending || shared.isPending) {
    return (
      <Shell onBack={() => navigate("/lien-he")}>
        <div className="space-y-3" aria-hidden="true">
          <div className="h-[92px] animate-pulse rounded-xl bg-secondary/70" />
          <div className="h-[92px] animate-pulse rounded-xl bg-secondary/50" />
        </div>
      </Shell>
    );
  }

  if (isError || shared.isError) {
    return (
      <Shell onBack={() => navigate("/lien-he")}>
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
      <Shell onBack={() => navigate("/lien-he")}>
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
    <Shell onBack={() => navigate("/lien-he")}>
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Cần xem lại</h1>
        <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          AVORA không tự chọn giúp bạn — hãy giữ lại cái đúng và bỏ cái không còn dùng.
        </p>
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
                onConfirmAll={() => void act(() => confirmContact(group.contact.id))}
                onConfirm={(channelId) => void act(() => confirm(channelId))}
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

function ReviewCard({
  contact,
  channels,
  isWorking,
  onOpen,
  onConfirmAll,
  onConfirm,
  onRemove,
}: {
  contact: Contact;
  channels: readonly ContactChannel[];
  isWorking: boolean;
  onOpen: () => void;
  onConfirmAll: () => void;
  onConfirm: (channelId: string) => void;
  onRemove: (channelId: string) => void;
}) {
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <button
          type="button"
          onClick={onOpen}
          className="press flex min-w-0 items-center gap-3 text-left"
        >
          <InitialsAvatar name={contact.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-foreground">
              {contact.name}
            </span>
            <span className="block truncate text-[12.5px] text-muted-foreground">
              Đang dùng: {contact.phone ?? contact.email ?? "chưa có kênh chính"}
            </span>
          </span>
        </button>

        <Button
          variant="outline"
          className="press h-9 gap-1.5 px-3.5 text-[13px]"
          disabled={isWorking}
          onClick={onConfirmAll}
        >
          <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          Giữ tất cả
        </Button>
      </div>

      <ul>
        {channels.map((channel) => (
          <li
            key={channel.id}
            className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"
          >
            <ChannelIcon kind={channel.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] text-foreground">{channel.value}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {channel.label !== null ? `${channel.label} · ` : ""}
                {channelSourceLabel(channel.source)}
              </span>
            </span>

            <span className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                aria-label={`Giữ ${channel.value}`}
                className="press h-9 gap-1.5 px-3 text-[13px]"
                disabled={isWorking}
                onClick={() => onConfirm(channel.id)}
              >
                <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Giữ
              </Button>
              <Button
                variant="ghost"
                aria-label={`Bỏ ${channel.value}`}
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

function Shell({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-3xl px-6 py-10 md:px-10">
        <button
          type="button"
          onClick={onBack}
          className="press mb-6 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Liên hệ
        </button>
        {children}
      </div>
    </div>
  );
}

export default ContactChannelReview;
