import { AlertCircle, Building2, CheckCircle2, Plus, Search, Upload, UserRound } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ImportContactsDialog } from "@/components/contacts/ImportContactsDialog";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import {
  filterContacts,
  individualSubtitle,
  shortTaxCode,
  splitContacts,
  type Contact,
} from "@/lib/contacts";
import { reviewTotal } from "@/lib/contact-channels";
import { CHANNEL_REVIEW_ROUTE } from "@/lib/navigation";
import { useContactsNeedingReview, useSharedChannels } from "@/lib/use-contact-channels";
import { useContacts } from "@/lib/use-contacts";
import { cn } from "@/lib/utils";

type Group = "individual" | "business";

/**
 * The address book: everyone and every company this person has written down.
 *
 * It is no longer a by-product of having chatted. A contact exists because someone decided to
 * keep it, which means the people who matter are here before the first message and stay after
 * the last one — including the ones who are not on AVORA at all.
 *
 * People and companies are two lists behind two tabs, never one mixed list. They are answers to
 * different questions ("who do I call" / "who do I invoice"), they are searched by different
 * fields, and the rows themselves carry different facts — interleaving them by name would put a
 * tax code between two phone numbers.
 */
const Contacts = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState<string>("");
  const [group, setGroup] = useState<Group>("individual");
  const [isNewOpen, setIsNewOpen] = useState<boolean>(false);
  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);

  const contactsQuery = useContacts();
  const review = useContactsNeedingReview();
  const shared = useSharedChannels();

  // One number, because the banner is one sentence. Someone with two unconfirmed numbers and one
  // number shared across contacts has three things to look at, not two counts to add up.
  const reviewCount: number = reviewTotal(review.count, shared.count);

  const { individuals, businesses } = useMemo(
    () => splitContacts(contactsQuery.data ?? []),
    [contactsQuery.data],
  );

  const visible: Contact[] = useMemo(
    () => filterContacts(group === "individual" ? individuals : businesses, query),
    [group, individuals, businesses, query],
  );

  const total: number = group === "individual" ? individuals.length : businesses.length;

  const openContact = useCallback(
    (contactId: string): void => {
      navigate(`/lien-he/${contactId}`);
    },
    [navigate],
  );

  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto max-w-3xl px-6 py-10 md:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Liên hệ</h1>
            <p className="mt-1 text-[15px] text-muted-foreground">Danh bạ của riêng bạn</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsImportOpen(true)}
              className="press inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2.5 text-[14.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
            >
              <Upload className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
              Nhập từ file
            </button>
            <button
              type="button"
              onClick={() => setIsNewOpen(true)}
              className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-5 py-2.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              Thêm liên hệ
            </button>
          </div>
        </header>

        {/* Only ever shown when there is something to do about it — a count of zero is not news. */}
        {reviewCount > 0 ? (
          <button
            type="button"
            onClick={() => navigate(CHANNEL_REVIEW_ROUTE)}
            className="press mt-6 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-5 py-3.5 text-left transition-colors hover:bg-accent/35"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/60">
              <AlertCircle
                className="h-[18px] w-[18px] text-accent-foreground"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium text-foreground">
                {reviewCount} việc cần bạn xem lại
              </span>
              <span className="block text-[13px] text-muted-foreground">
                {/* Says which kind of tangle is waiting, because the two need different
                    thinking — and both at once is worth knowing before opening the screen. */}
                {review.count > 0 && shared.count > 0
                  ? "Kênh liên lạc chưa xác nhận, và kênh đang dùng chung nhiều liên hệ"
                  : shared.count > 0
                    ? "Cùng một số hoặc email đang gắn với nhiều liên hệ"
                    : "Nhiều số điện thoại hoặc email chưa được xác nhận"}
              </span>
            </span>
          </button>
        ) : null}

        <nav aria-label="Loại liên hệ" className="mt-7">
          <ul className="flex flex-wrap gap-1">
            <li>
              <GroupTab
                isActive={group === "individual"}
                count={individuals.length}
                icon={UserRound}
                label="Cá nhân"
                onClick={() => setGroup("individual")}
              />
            </li>
            <li>
              <GroupTab
                isActive={group === "business"}
                count={businesses.length}
                icon={Building2}
                label="Doanh nghiệp"
                onClick={() => setGroup("business")}
              />
            </li>
          </ul>
        </nav>

        <label className="relative mt-4 block">
          <span className="sr-only">Tìm liên hệ</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.6}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              group === "individual" ? "Tìm theo tên, điện thoại hoặc email" : "Tìm theo tên hoặc mã số thuế"
            }
            className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
          />
        </label>

        <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
          {contactsQuery.isPending ? (
            <ul aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0">
                  <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-secondary" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3.5 w-1/3 animate-pulse rounded bg-secondary" />
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-secondary/70" />
                  </span>
                </li>
              ))}
            </ul>
          ) : contactsQuery.isError ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[14px] text-muted-foreground">{(contactsQuery.error as Error).message}</p>
              <button
                type="button"
                onClick={() => void contactsQuery.refetch()}
                className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Thử lại
              </button>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState group={group} hasAny={total > 0} onAdd={() => setIsNewOpen(true)} />
          ) : (
            <ul>
              {visible.map((entry) => (
                <li key={entry.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openContact(entry.id)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/35"
                  >
                    {entry.contactType === "individual" ? (
                      <InitialsAvatar name={entry.name} size="sm" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/75">
                        <Building2 className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-foreground">{entry.name}</span>
                        {entry.contactType === "individual" && entry.linkedUserId !== null ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[11.5px] font-medium text-accent-foreground">
                            <CheckCircle2
                              className="h-3 w-3 text-money-in"
                              strokeWidth={2.2}
                              aria-hidden="true"
                            />
                            Đã dùng AVORA
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                        {entry.contactType === "individual"
                          ? individualSubtitle(entry)
                          : shortTaxCode(entry.taxCode)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewContactDialog
        open={isNewOpen}
        onOpenChange={setIsNewOpen}
        onCreated={(contact) => openContact(contact.id)}
      />

      <ImportContactsDialog open={isImportOpen} onOpenChange={setIsImportOpen} />
    </div>
  );
};

function GroupTab({
  isActive,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  isActive: boolean;
  label: string;
  count: number;
  icon: typeof UserRound;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "press inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-[14px] font-medium transition-colors",
        isActive
          ? "bg-accent/70 text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      {label}
      <span className={cn("tabular text-[12.5px]", isActive ? "opacity-70" : "opacity-60")}>{count}</span>
    </button>
  );
}

function EmptyState({
  group,
  hasAny,
  onAdd,
}: {
  group: Group;
  hasAny: boolean;
  onAdd: () => void;
}) {
  if (hasAny) {
    return <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">Không tìm thấy liên hệ nào.</p>;
  }

  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[15px] font-medium text-foreground">
        {group === "individual" ? "Chưa có liên hệ cá nhân nào" : "Chưa có liên hệ doanh nghiệp nào"}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
        {group === "individual"
          ? "Thêm một người bạn muốn giữ liên lạc — họ không cần có tài khoản AVORA."
          : "Thêm một công ty bạn làm việc cùng, kèm mã số thuế và người đại diện."}
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="press mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-[13.5px] font-medium text-foreground transition-colors hover:bg-accent/40"
      >
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Thêm liên hệ
      </button>
    </div>
  );
}

export default Contacts;
