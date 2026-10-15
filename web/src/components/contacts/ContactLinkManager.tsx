import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Search, Unlink, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatPhoneForDisplay } from "@/lib/contact-clean";
import { LINK_UNDO_MS, closeContactLinkManager, useContactLinkRequest, type ContactLinkRequest } from "@/lib/contact-link-store";
import { linkTargets, matchesContactQuery, type Contact } from "@/lib/contacts";
import { useConnections } from "@/lib/use-connections";
import { useContactLink, type LinkChange } from "@/lib/use-contact-link";
import { useContacts } from "@/lib/use-contacts";

type Step = "menu" | "pick" | "confirm-unlink" | "confirm-move";

/**
 * AVORA-117 · the one place a contact's AVORA link is removed, moved or set. Mounted once; opened from a
 * contact page (`Quản lý liên kết AVORA`) or a person card (`Đổi tên trong danh bạ`, `Liên kết với liên hệ…`).
 * The contact itself is never edited here: only which contact the account is attached to.
 */
export function ContactLinkHost() {
  const request = useContactLinkRequest();
  return (
    <Dialog open={request !== null} onOpenChange={(next) => (next ? undefined : closeContactLinkManager())}>
      <DialogContent className="gap-0 p-0 sm:max-w-[440px]" data-contact-link-manager="">
        {request !== null ? <Body key={JSON.stringify(request)} request={request} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ request }: { request: ContactLinkRequest }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: contacts } = useContacts();
  const { byId } = useConnections();
  const { change, undo, isWorking } = useContactLink();

  const all: Contact[] = useMemo(() => contacts ?? [], [contacts]);
  const source: Contact | null = request.kind === "manage" ? (all.find((c) => c.id === request.contactId) ?? null) : null;
  const userId = request.kind === "manage" ? (source?.linkedUserId ?? null) : request.userId;
  const avoraName =
    request.kind === "link-friend" ? request.avoraName : userId === null ? null : (byId.get(userId)?.displayName?.trim() || null);

  const [step, setStep] = useState<Step>(request.kind === "link-friend" ? "pick" : (request.startAt ?? "menu"));
  const [target, setTarget] = useState<Contact | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const finish = useCallback(
    async (linkChange: LinkChange, done: string): Promise<void> => {
      setProblem(null);
      try {
        const result = await change(linkChange);
        closeContactLinkManager();
        toast.success(done, {
          duration: LINK_UNDO_MS,
          action: {
            label: "Hoàn tác",
            onClick: () => {
              undo(result)
                .then(() => toast.success("Đã hoàn tác"))
                .catch((error: unknown) =>
                  toast.error(`Chưa hoàn tác được. ${error instanceof Error ? error.message : "Vui lòng thử lại."}`),
                );
            },
          },
        });
      } catch (error) {
        setProblem(error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");
      }
    },
    [change, undo],
  );

  // The link moved away under us (another tab): nothing left to manage.
  if (request.kind === "manage" && (source === null || source.linkedUserId === null) && !isWorking) {
    return (
      <Section title="Quản lý liên kết AVORA">
        <p className="text-[14px] text-muted-foreground">Liên hệ này không còn gắn với tài khoản AVORA nào.</p>
        <div className="mt-5 flex justify-end">
          <Button variant="outline" className="press h-11 px-5" onClick={closeContactLinkManager}>
            Đóng
          </Button>
        </div>
      </Section>
    );
  }

  const accountLabel = avoraName === null ? "Tài khoản AVORA này" : `Tài khoản AVORA ${avoraName}`;

  if (step === "menu" && source !== null) {
    const onThisContact = location.pathname === `/lien-he/${source.id}`;
    return (
      <Section title="Quản lý liên kết AVORA">
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          {accountLabel} đang gắn với liên hệ <b className="font-semibold text-foreground">{source.name}</b>.
        </p>
        <div className="mt-4 overflow-hidden rounded-[14px] border border-border">
          <MenuRow
            icon={<ArrowLeftRight className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />}
            title="Chuyển sang liên hệ khác…"
            detail={`Giữ nguyên ${source.name}, gắn tài khoản này với liên hệ đúng.`}
            onClick={() => setStep("pick")}
          />
          <MenuRow
            icon={<Unlink className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />}
            title="Gỡ liên kết"
            detail={`${source.name} vẫn còn nguyên tên, số, ghi chú.`}
            onClick={() => setStep("confirm-unlink")}
          />
          {!onThisContact ? (
            <MenuRow
              icon={<UserRound className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />}
              title={`Mở liên hệ ${source.name}`}
              detail="Sửa tên, số hay ghi chú của liên hệ này."
              onClick={() => {
                closeContactLinkManager();
                navigate(`/lien-he/${source.id}`);
              }}
            />
          ) : null}
        </div>
      </Section>
    );
  }

  if (step === "pick") {
    return (
      <Section
        title={request.kind === "link-friend" ? "Liên kết với liên hệ" : "Chọn liên hệ đúng"}
        onBack={request.kind === "manage" ? () => setStep("menu") : undefined}
      >
        <p className="text-[13.5px] text-muted-foreground">
          {request.kind === "link-friend"
            ? `Chọn liên hệ cá nhân trong danh bạ là ${avoraName ?? "người này"}. Chỉ hiện liên hệ chưa gắn với ai.`
            : "Chỉ hiện liên hệ cá nhân chưa gắn với tài khoản AVORA nào."}
        </p>
        <ContactPicker
          contacts={linkTargets(all, source?.id ?? null)}
          onPick={(contact) => {
            setTarget(contact);
            setProblem(null);
            setStep("confirm-move");
          }}
        />
      </Section>
    );
  }

  if (step === "confirm-unlink" && source !== null) {
    return (
      <Section title={`Gỡ liên kết với ${source.name}?`} onBack={() => setStep("menu")}>
        <p className="text-[14px] leading-relaxed text-muted-foreground">
          Liên hệ <b className="font-semibold text-foreground">{source.name}</b> vẫn còn nguyên (tên, số, ghi chú). Trong chat, nhóm
          và giao việc, người này sẽ hiện bằng tên AVORA của chính họ{avoraName !== null ? `: ${avoraName}` : ""}.
        </p>
        <Problem text={problem} />
        <Actions
          confirmLabel={problem !== null ? "Thử lại" : "Gỡ liên kết"}
          isWorking={isWorking}
          onCancel={closeContactLinkManager}
          onConfirm={() => void finish({ kind: "unlink", contactId: source.id }, `Đã gỡ liên kết khỏi ${source.name}`)}
        />
      </Section>
    );
  }

  if (step === "confirm-move" && target !== null) {
    const isMove = request.kind === "manage" && source !== null;
    return (
      <Section title={isMove ? "Chuyển liên kết?" : "Liên kết với liên hệ này?"} onBack={() => setStep("pick")}>
        <p className="text-[14px] leading-relaxed text-muted-foreground" data-link-confirm="">
          {isMove ? (
            <>
              {accountLabel} đang gắn với liên hệ <b className="font-semibold text-foreground">{source.name}</b>. Chuyển sang{" "}
              <b className="font-semibold text-foreground">{target.name}</b>? Liên hệ {source.name} vẫn còn nguyên (tên, số, ghi chú).
            </>
          ) : (
            <>
              Gắn {accountLabel.charAt(0).toLowerCase() + accountLabel.slice(1)} với liên hệ{" "}
              <b className="font-semibold text-foreground">{target.name}</b>? Liên hệ {target.name} vẫn giữ nguyên tên, số, ghi chú.
            </>
          )}{" "}
          Trong chat, nhóm và giao việc, người này sẽ hiện tên <b className="font-semibold text-foreground">{target.name}</b>.
        </p>
        <Problem text={problem} />
        <Actions
          confirmLabel={problem !== null ? "Thử lại" : isMove ? "Chuyển liên kết" : "Liên kết"}
          isWorking={isWorking}
          onCancel={closeContactLinkManager}
          onConfirm={() => {
            if (isMove) void finish({ kind: "relink", fromId: source.id, toId: target.id }, `Đã chuyển liên kết sang ${target.name}`);
            else if (userId !== null) void finish({ kind: "link", contactId: target.id, userId }, `Đã liên kết với ${target.name}`);
          }}
        />
      </Section>
    );
  }

  return null;
}

function Section({ title, onBack, children }: { title: string; onBack?: () => void; children: ReactNode }) {
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex min-h-11 items-center gap-1 pr-10">
        {onBack !== undefined ? (
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            className="press -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <DialogTitle className="min-w-0 break-words text-[18px] font-semibold tracking-tight text-foreground">{title}</DialogTitle>
      </div>
      <DialogDescription className="sr-only">Gỡ hoặc chuyển liên kết giữa liên hệ và tài khoản AVORA.</DialogDescription>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MenuRow({ icon, title, detail, onClick }: { icon: ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex min-h-[64px] w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-accent/35"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/75">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[15px] font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block break-words text-[12.5px] text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function Problem({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <p role="alert" className="mt-3 rounded-[12px] bg-secondary/70 px-3 py-2 text-[13px] text-foreground">
      {text}
    </p>
  );
}

function Actions({
  confirmLabel,
  isWorking,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  isWorking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2.5">
      <Button variant="outline" className="press h-11 px-5" onClick={onCancel} disabled={isWorking}>
        Huỷ
      </Button>
      <Button className="press h-11 px-5" onClick={onConfirm} disabled={isWorking}>
        {isWorking ? "Đang lưu…" : confirmLabel}
      </Button>
    </div>
  );
}

/** Search (tên, số) over a virtualised list, so a book of 1 000 people scrolls like one of ten. */
function ContactPicker({ contacts, onPick }: { contacts: readonly Contact[]; onPick: (contact: Contact) => void }) {
  const [query, setQuery] = useState<string>("");
  const rows = useMemo(() => contacts.filter((contact) => matchesContactQuery(contact, query)), [contacts, query]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 8,
    getItemKey: useCallback((index: number) => rows[index].id, [rows]),
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  return (
    <div className="mt-3">
      <label className="flex h-11 items-center gap-2 rounded-[12px] border border-border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo tên hoặc số"
          aria-label="Tìm liên hệ"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[15px]"
          enterKeyHint="search"
        />
      </label>
      <div ref={scrollRef} className="mt-2 h-[min(52dvh,380px)] scroll-y-free" data-link-picker="">
        {rows.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13.5px] text-muted-foreground">
            {contacts.length === 0 ? "Không có liên hệ cá nhân nào chưa gắn với tài khoản." : `Không tìm thấy “${query.trim()}”.`}
          </p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const contact = rows[item.index];
              return (
                <button
                  key={item.key}
                  type="button"
                  data-link-target={contact.id}
                  onClick={() => onPick(contact)}
                  className="press absolute left-0 top-0 flex h-[60px] w-full items-center gap-3 rounded-[12px] px-2 text-left hover:bg-accent/35"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <UserAvatar userId={null} name={contact.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-foreground">{contact.name}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      {contact.phone !== null ? formatPhoneForDisplay(contact.phone) : (contact.email ?? "Chưa có số điện thoại")}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
