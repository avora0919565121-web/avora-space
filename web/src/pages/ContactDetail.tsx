import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BusinessFields, IndividualFields } from "@/components/contacts/ContactForms";
import { InvitePanel } from "@/components/contacts/InvitePanel";
import { OpportunitySection } from "@/components/contacts/OpportunitySection";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { chatKeys, createDirectConversation } from "@/lib/chat";
import {
  businessDraftProblem,
  canInviteContact,
  canMessageContact,
  contactById,
  individualDraftProblem,
  shortTaxCode,
  staffOf,
  toBusinessDraft,
  toIndividualDraft,
  type BusinessDraft,
  type Contact,
  type IndividualDraft,
} from "@/lib/contacts";
import {
  channelSourceLabel,
  channelsOf,
  type ChannelKind,
  type ContactChannel,
} from "@/lib/contact-channels";
import { peerLabel } from "@/lib/initials";
import { useContactChannels } from "@/lib/use-contact-channels";
import { useContactActions, useContacts } from "@/lib/use-contacts";

/**
 * One contact, in full.
 *
 * Reading and editing are the same screen in two states rather than two screens: a contact is
 * mostly short, and a separate edit page would make correcting a phone number a journey.
 *
 * What the page offers depends on what the contact is, and the difference is absolute. A person
 * can be written to or invited; a company has neither — it does not sign in, and a button that
 * existed only to be refused would be a promise the model never made. A company instead shows
 * who works there, which is the question actually asked of a company record.
 */
const ContactDetail = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { contactId } = useParams<{ contactId: string }>();
  const { user } = useAuth();

  const contactsQuery = useContacts();
  const channelsQuery = useContactChannels();
  const { saveIndividual, saveBusiness, isWorking } = useContactActions();

  const contacts: Contact[] = useMemo(() => contactsQuery.data ?? [], [contactsQuery.data]);
  const contact: Contact | null = useMemo(
    () => contactById(contacts, contactId),
    [contacts, contactId],
  );

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [individual, setIndividual] = useState<IndividualDraft | null>(null);
  const [business, setBusiness] = useState<BusinessDraft | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Opening the editor takes a copy of what is stored; the stored row stays the source of truth.
  const beginEdit = useCallback((): void => {
    if (contact === null) return;
    setNotice(null);
    if (contact.contactType === "individual") setIndividual(toIndividualDraft(contact));
    else setBusiness(toBusinessDraft(contact));
    setIsEditing(true);
  }, [contact]);

  // A contact deleted in another tab must not leave the editor open over an empty page.
  useEffect(() => {
    if (contact === null && isEditing) setIsEditing(false);
  }, [contact, isEditing]);

  const save = useCallback(async (): Promise<void> => {
    if (contact === null) return;
    setNotice(null);

    if (contact.contactType === "individual") {
      if (individual === null) return;
      const problem = individualDraftProblem(individual);
      if (problem !== null) {
        setNotice(problem);
        return;
      }
      try {
        await saveIndividual(contact.id, individual);
        setIsEditing(false);
      } catch (error) {
        setNotice((error as Error).message);
      }
      return;
    }

    if (business === null) return;
    const problem = businessDraftProblem(business);
    if (problem !== null) {
      setNotice(problem);
      return;
    }
    try {
      await saveBusiness(contact.id, business);
      setIsEditing(false);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, [contact, individual, business, saveIndividual, saveBusiness]);

  /**
   * Opening the thread uses the same call the rest of the app uses to start a 1-1 — it returns
   * the existing conversation when there is one, so this can never split a history in two.
   */
  const messageMutation = useMutation({
    mutationFn: (otherUserId: string) => createDirectConversation(otherUserId),
    onSuccess: (conversationId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      navigate(`/tin-nhan/${conversationId}`);
    },
    onError: (error: Error) => setNotice(error.message),
  });

  const staff: Contact[] = useMemo(
    () => (contact !== null && contact.contactType === "business" ? staffOf(contacts, contact.id) : []),
    [contacts, contact],
  );

  const extraChannels: ContactChannel[] = useMemo(
    () => (contact === null ? [] : channelsOf(channelsQuery.data ?? [], contact.id)),
    [channelsQuery.data, contact],
  );

  if (contactsQuery.isPending) {
    return (
      <Shell onBack={() => navigate("/lien-he")}>
        <div className="space-y-3" aria-hidden="true">
          <div className="h-[72px] animate-pulse rounded-xl bg-secondary/70" />
          <div className="h-[180px] animate-pulse rounded-xl bg-secondary/50" />
        </div>
      </Shell>
    );
  }

  if (contactsQuery.isError) {
    return (
      <Shell onBack={() => navigate("/lien-he")}>
        <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
          <p className="text-[14px] text-muted-foreground">{(contactsQuery.error as Error).message}</p>
          <Button
            variant="outline"
            className="press mt-3 h-10 px-4"
            onClick={() => void contactsQuery.refetch()}
          >
            Thử lại
          </Button>
        </div>
      </Shell>
    );
  }

  if (contact === null) {
    return (
      <Shell onBack={() => navigate("/lien-he")}>
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <p className="text-[15px] font-medium text-foreground">Không tìm thấy liên hệ này</p>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            Có thể liên hệ đã bị xoá, hoặc đường dẫn không còn đúng.
          </p>
          <Button variant="outline" className="press mt-4 h-10 px-4" onClick={() => navigate("/lien-he")}>
            Về danh bạ
          </Button>
        </div>
      </Shell>
    );
  }

  const isPerson = contact.contactType === "individual";
  const inviterName = peerLabel(user?.user_metadata?.display_name ?? null, user?.email ?? null);

  return (
    <Shell onBack={() => navigate("/lien-he")}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {isPerson ? (
            <InitialsAvatar name={contact.name} size="lg" />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/75">
              <Building2 className="h-6 w-6" strokeWidth={1.6} aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[26px] font-semibold tracking-tight text-foreground">
              {contact.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2.5 py-0.5 text-[12px] text-muted-foreground">
                {isPerson ? "Cá nhân" : "Doanh nghiệp"}
              </span>
              {isPerson && contact.linkedUserId !== null ? <LinkedBadge /> : null}
              {!isPerson ? (
                <span className="text-[13px] text-muted-foreground">{shortTaxCode(contact.taxCode)}</span>
              ) : null}
            </div>
          </div>
        </div>

        {!isEditing ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {canMessageContact(contact) ? (
              <Button
                className="press h-10 gap-2 px-4"
                disabled={messageMutation.isPending}
                onClick={() => {
                  if (contact.linkedUserId !== null) messageMutation.mutate(contact.linkedUserId);
                }}
              >
                <MessageCircle className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {messageMutation.isPending ? "Đang mở…" : "Nhắn tin"}
              </Button>
            ) : null}
            <Button variant="outline" className="press h-10 gap-2 px-4" onClick={beginEdit}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              Sửa
            </Button>
          </div>
        ) : null}
      </header>

      {isEditing ? (
        <section className="mt-7 rounded-xl border border-border bg-card p-5">
          {isPerson && individual !== null ? (
            <IndividualFields
              draft={individual}
              onChange={setIndividual}
              contacts={contacts}
              showEmployer
              excludeId={contact.id}
            />
          ) : null}
          {!isPerson && business !== null ? (
            <BusinessFields draft={business} onChange={setBusiness} />
          ) : null}

          {notice !== null ? (
            <p role="alert" className="mt-4 text-[13px] text-primary">
              {notice}
            </p>
          ) : null}

          <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
            <Button
              variant="outline"
              className="press h-10 px-5"
              onClick={() => {
                setIsEditing(false);
                setNotice(null);
              }}
            >
              Huỷ
            </Button>
            <Button className="press h-10 px-5" disabled={isWorking} onClick={() => void save()}>
              {isWorking ? "Đang lưu…" : "Lưu thay đổi"}
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-7 overflow-hidden rounded-xl border border-border bg-card">
            <dl>
              {isPerson ? (
                <>
                  <DetailRow label="Điện thoại" value={contact.phone} />
                  <DetailRow label="Email" value={contact.email} />
                  <DetailRow label="Ngày sinh" value={formatDate(contact.dateOfBirth)} />
                  <DetailRow label="Quan hệ" value={contact.relationshipTag} />
                  <DetailRow label="Làm việc cho" value={employerName(contacts, contact)} />
                </>
              ) : (
                <>
                  <DetailRow label="Mã số thuế" value={contact.taxCode} />
                  <DetailRow label="Ngành nghề" value={contact.industry} />
                  <DetailRow label="Địa chỉ" value={contact.businessAddress} />
                  <DetailRow label="Điện thoại công ty" value={contact.phone} />
                  <DetailRow label="Email công ty" value={contact.email} />
                  <DetailRow label="Người đại diện" value={contact.representativeName} />
                  <DetailRow label="Điện thoại người đại diện" value={contact.representativePhone} />
                  <DetailRow label="Email người đại diện" value={contact.representativeEmail} />
                </>
              )}
              <DetailRow label="Ghi chú" value={contact.note} />
            </dl>
          </section>

          {notice !== null && !isEditing ? (
            <p role="alert" className="mt-4 text-[13px] text-primary">
              {notice}
            </p>
          ) : null}

          {/* Left out entirely when there are none: a contact with one number has nothing extra
              to say, and an empty "other channels" box would imply something is missing. */}
          {extraChannels.length > 0 ? <ChannelsSection channels={extraChannels} /> : null}

          {/* Always present, unlike the block above: "not a piece of business" is a fact worth
              being able to change from here, so the empty state is one quiet button. */}
          <OpportunitySection contactId={contact.id} contactName={contact.name} />

          {/* A company is not someone who signs in, so it is never offered an invitation. */}
          {canInviteContact(contact) ? (
            <div className="mt-5">
              <InvitePanel contact={contact} inviterName={inviterName} />
            </div>
          ) : null}

          {!isPerson ? <StaffSection staff={staff} /> : null}
        </>
      )}
    </Shell>
  );
};

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

function LinkedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2.5 py-0.5 text-[12px] font-medium text-accent-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 text-money-in" strokeWidth={2} aria-hidden="true" />
      Đã dùng AVORA
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-4 border-b border-border px-5 py-3.5 last:border-b-0">
      <dt className="w-[42%] shrink-0 text-[13.5px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-[14.5px] text-foreground">
        {value !== null && value.trim().length > 0 ? (
          value
        ) : (
          <span className="text-muted-foreground/70">—</span>
        )}
      </dd>
    </div>
  );
}

/**
 * Who works at this company.
 *
 * An empty list says so in one line instead of hiding the section: "nobody recorded yet" and
 * "this company has no staff field" are different facts, and hiding the block would make the
 * first look like the second.
 */
function StaffSection({ staff }: { staff: readonly Contact[] }) {
  const navigate = useNavigate();

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Nhân sự liên quan</h2>
      </header>
      {staff.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13.5px] text-muted-foreground">
          Chưa có nhân sự nào được gắn
        </p>
      ) : (
        <ul>
          {staff.map((person) => (
            <li key={person.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => navigate(`/lien-he/${person.id}`)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/35"
              >
                <InitialsAvatar name={person.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-foreground">
                    {person.name}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {person.phone ?? person.email ?? "Chưa có số điện thoại hoặc email"}
                  </span>
                </span>
                <UserRound
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The other ways to reach this contact.
 *
 * Separate from the block above because those fields are the contact's primary channels — the
 * ones invitations and messages actually use. Mixing a second number into that list would make
 * it ambiguous which one the app will pick.
 */
function ChannelsSection({ channels }: { channels: readonly ContactChannel[] }) {
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Kênh liên hệ khác</h2>
      </header>
      <ul>
        {channels.map((channel) => (
          <li
            key={channel.id}
            className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"
          >
            <ChannelIcon kind={channel.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] text-foreground">{channel.value}</span>
              <span className="block truncate text-[12px] text-muted-foreground">
                {channel.label !== null ? `${channel.label} · ` : ""}
                {channelSourceLabel(channel.source)}
              </span>
            </span>
            {channel.needsReview ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[11.5px] font-medium text-accent-foreground">
                <AlertCircle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                Chưa xác nhận
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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

function employerName(contacts: readonly Contact[], contact: Contact): string | null {
  if (contact.employerContactId === null) return null;
  return contacts.find((entry) => entry.id === contact.employerContactId)?.name ?? null;
}

/** A stored date read back the way it is written in Vietnamese. */
function formatDate(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default ContactDetail;
