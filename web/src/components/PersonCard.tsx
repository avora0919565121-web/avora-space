import { useQuery } from "@tanstack/react-query";
import { Ban, Copy, Flag, ListTodo, Mail, MessageCircle, Phone, Settings2, Tag, UserPlus, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { askConfirm, askText } from "@/components/ConfirmHost";
import { InitialsAvatar } from "@/components/InitialsAvatar";
import { InviteMessageDialog } from "@/components/contacts/InviteMessageDialog";
import { ReportDialog, type ReportTarget } from "@/components/chat/ReportDialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { createDirectConversation } from "@/lib/chat";
import { formatPhoneForDisplay } from "@/lib/contact-clean";
import { createContactQuick } from "@/lib/contacts";
import { startGroupConnection, startPinConnection } from "@/lib/connections";
import { initialsOf } from "@/lib/initials";
import { personCardView, type PersonRef } from "@/lib/person-card";
import { REPORT_SENT_TOAST, submitReport } from "@/lib/reports";
import { OPEN_TASK_PARAM } from "@/lib/task-scope";
import { isSharedTask } from "@/lib/tasks";
import { fetchMyPin } from "@/lib/user-pin";
import { useBlocks } from "@/lib/use-blocks";
import { useConnections } from "@/lib/use-connections";
import { useContacts } from "@/lib/use-contacts";
import { useTasks } from "@/lib/use-tasks";
import { ALIAS_MAX } from "@/lib/user-aliases";
import { useUserAliases } from "@/lib/use-user-aliases";
import { cn } from "@/lib/utils";

type Request = { ref: PersonRef; anchor: DOMRect | null };

let publish: ((request: Request) => void) | null = null;

/** Opens the one person card (AVORA-60 · C) — from any avatar, anywhere. */
export function openPersonCard(ref: PersonRef, anchor?: Element | null): void {
  publish?.({ ref, anchor: anchor?.getBoundingClientRect() ?? null });
}

/**
 * An avatar that opens the person card. A `span role="button"` rather than a `<button>`, so it
 * can sit inside a row that is itself a link without nesting interactive elements.
 */
export function PersonAvatarButton({
  person,
  size = "md",
  online,
  className,
}: {
  person: PersonRef & { name: string };
  size?: "sm" | "md" | "lg";
  online?: boolean;
  className?: string;
}) {
  const open = (event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openPersonCard(person, event.currentTarget);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Xem thẻ của ${person.name}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
      className={cn("press no-callout inline-flex shrink-0 cursor-pointer rounded-full", className)}
    >
      <InitialsAvatar name={person.name} size={size} online={online} />
    </span>
  );
}

/** Mounted once for every signed-in screen. Phone: a sheet from below. Computer: anchored to the avatar. */
export function PersonCardHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const isMobile = useIsMobile();
  const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({ getBoundingClientRect: () => new DOMRect() });

  useEffect(() => {
    publish = setRequest;
    return () => {
      publish = null;
    };
  }, []);

  if (request !== null && request.anchor !== null) {
    const rect = request.anchor;
    anchorRef.current = { getBoundingClientRect: () => rect };
  }
  const close = (): void => setRequest(null);
  const body = request === null ? null : <PersonCardBody personRef={request.ref} onClose={close} />;

  if (isMobile || request?.anchor === null) {
    return (
      <Sheet open={request !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[18px] px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-5">
          <SheetTitle className="sr-only">Thẻ người dùng</SheetTitle>
          <SheetDescription className="sr-only">Tên, PIN và các việc nhanh với người này.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={request !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-[320px] p-4">
        {body}
      </PopoverContent>
    </Popover>
  );
}

function ActionTile({ icon, label, onClick, href, disabled }: { icon: ReactNode; label: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = "press flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-border bg-card px-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50";
  if (href !== undefined) {
    return (
      <a href={href} className={cls}>
        {icon}
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      {label}
    </button>
  );
}

function PersonCardBody({ personRef, onClose }: { personRef: PersonRef; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { byId } = useConnections();
  const { data: contacts } = useContacts();
  const { data: tasks } = useTasks();
  const { block, isBlocked } = useBlocks();
  const isSelf = user?.id === personRef.userId;
  const { data: ownPin } = useQuery({ queryKey: ["person-card", "own-pin"], queryFn: fetchMyPin, enabled: isSelf, staleTime: 5 * 60_000 });
  const { aliases, save: saveAlias } = useUserAliases();
  const view = useMemo(
    () => personCardView(personRef, user?.id, byId, contacts ?? [], ownPin ?? null, aliases),
    [personRef, user?.id, byId, contacts, ownPin, aliases],
  );
  /** AVORA-71 · E: a name only I see. Someone already in my Liên hệ is renamed there instead. */
  const editAlias = async (): Promise<void> => {
    const next = await askText({
      title: view.alias === null ? "Đặt tên gợi nhớ" : "Sửa tên gợi nhớ",
      body: `Chỉ mình bạn thấy tên này. ${view.realName} không biết. Để trống để bỏ.`,
      initial: view.alias ?? "",
      confirmLabel: "Lưu",
      maxLength: ALIAS_MAX,
    });
    if (next === null) return;
    try {
      await saveAlias(view.userId, next);
      toast.success(next.trim() === "" ? "Đã bỏ tên gợi nhớ" : "Đã lưu tên gợi nhớ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không lưu được.");
    }
  };
  const [isPhotoOpen, setIsPhotoOpen] = useState<boolean>(false);
  const [isInviteOpen, setIsInviteOpen] = useState<boolean>(false);
  const [isSharedOpen, setIsSharedOpen] = useState<boolean>(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [isReporting, setIsReporting] = useState<boolean>(false);

  const shared = useMemo(
    () =>
      (tasks ?? []).filter(
        (task) =>
          isSharedTask(task) &&
          task.status !== "skipped" &&
          (task.creatorId === view.userId || task.assigneeId === view.userId),
      ),
    [tasks, view.userId],
  );

  const go = useCallback(
    (to: string): void => {
      onClose();
      navigate(to);
    },
    [navigate, onClose],
  );

  const chat = async (): Promise<void> => {
    try {
      go(`/tin-nhan/${await createDirectConversation(view.userId)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không mở được cuộc trò chuyện.");
    }
  };

  const canInvite = !view.isSelf && !view.isFriend && (personRef.groupId != null || view.pin !== null);

  const addContact = async (): Promise<void> => {
    try {
      const made = await createContactQuick({ name: view.realName });
      toast.success("Đã thêm vào Liên hệ");
      go(`/lien-he/${made.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không thêm được liên hệ.");
    }
  };

  const blockPerson = async (): Promise<void> => {
    const yes = await askConfirm({
      title: `Chặn ${view.name}?`,
      body: "Hai bên sẽ không nhắn hay giao việc cho nhau được nữa. Bỏ chặn bất cứ lúc nào trong Tuỳ chọn chung.",
      confirmLabel: "Chặn",
      danger: true,
    });
    if (!yes) return;
    try {
      await block(view.userId);
      toast.success("Đã chặn");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không chặn được.");
    }
  };

  return (
    <div data-person-card="" className="text-left">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setIsPhotoOpen(true)}
          aria-label="Xem ảnh đại diện toàn màn hình"
          className="press flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-secondary text-[26px] font-semibold tracking-wide text-foreground/75"
        >
          {initialsOf(view.name)}
        </button>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[19px] font-semibold leading-tight text-foreground" data-person-name="">{view.name}</p>
          {view.name !== view.realName ? <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground" data-person-real-name="">{view.realName}</p> : null}
          <p className="tabular mt-1 text-[13.5px] text-muted-foreground">{view.pin !== null ? `PIN ${view.pin}` : view.isSelf ? "Chưa có PIN" : "PIN chỉ hiện giữa bạn bè"}</p>
          {view.isFriend ? <p className="mt-0.5 text-[12.5px] font-medium text-primary">Bạn bè</p> : null}
        </div>
      </div>

      {view.phone !== null ? (
        <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-border px-3 py-2">
          <Phone className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <a href={`tel:${view.phone}`} className="tabular min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
            {formatPhoneForDisplay(view.phone)}
          </a>
          <button
            type="button"
            aria-label="Sao chép số điện thoại"
            onClick={() => {
              void navigator.clipboard?.writeText(view.phone ?? "").then(() => toast.success("Đã sao chép"));
            }}
            className="press flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Copy className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {view.email !== null ? (
        <div className="mt-2 flex items-center gap-2 rounded-[12px] border border-border px-3 py-2" data-person-email="">
          <Mail className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          <a href={`mailto:${view.email}`} className="min-w-0 flex-1 truncate text-[14.5px] text-foreground">
            {view.email}
          </a>
          <span className="shrink-0 text-[11.5px] text-muted-foreground">bạn đã lưu</span>
        </div>
      ) : null}
      {view.note !== null ? <p className="mt-2 line-clamp-3 rounded-[12px] bg-secondary/50 px-3 py-2 text-[13px] text-muted-foreground">{view.note}</p> : null}

      <div className="mt-4 flex gap-2">
        {view.isSelf ? (
          <ActionTile icon={<Settings2 className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Sửa hồ sơ" onClick={() => go("/cai-dat")} />
        ) : (
          <>
            {view.isFriend ? (
              <ActionTile icon={<MessageCircle className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Nhắn riêng" onClick={() => void chat()} />
            ) : (
              <ActionTile
                icon={<UserPlus className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />}
                label="Kết bạn"
                disabled={!canInvite}
                onClick={() => setIsInviteOpen(true)}
              />
            )}
            {view.phone !== null ? (
              <ActionTile icon={<Phone className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Gọi" href={`tel:${view.phone}`} />
            ) : null}
            <ActionTile
              icon={<ListTodo className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />}
              label={shared.length > 0 ? `Việc chung · ${shared.length}` : "Việc chung"}
              onClick={() => setIsSharedOpen((current) => !current)}
            />
            {view.contactId !== null ? (
              <ActionTile
                icon={<UserRound className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />}
                label="Sửa tên trong Liên hệ"
                onClick={() => go(`/lien-he/${view.contactId}`)}
              />
            ) : view.isFriend ? (
              <ActionTile icon={<UserRound className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Thêm vào Liên hệ" onClick={() => void addContact()} />
            ) : (
              <ActionTile icon={<Tag className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label={view.alias === null ? "Đặt tên gợi nhớ" : "Sửa tên gợi nhớ"} onClick={() => void editAlias()} />
            )}
          </>
        )}
      </div>

      {isSharedOpen && !view.isSelf ? (
        <div className="mt-3 rounded-[12px] border border-border">
          {shared.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-muted-foreground">Chưa có việc chung nào với {view.name}.</p>
          ) : (
            <ul className="max-h-[220px] divide-y divide-border overflow-y-auto">
              {shared.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => go(`/nhiem-vu?${OPEN_TASK_PARAM}=${encodeURIComponent(task.id)}`)}
                    className="press flex min-h-11 w-full items-center px-3 py-2 text-left text-[14px] hover:bg-accent/30"
                  >
                    <span className={cn("min-w-0 flex-1 truncate", task.status === "done" ? "text-muted-foreground line-through" : "text-foreground")}>{task.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!view.isSelf ? (
        <div className="mt-5 flex items-center justify-center gap-6 border-t border-border pt-3">
          <button
            type="button"
            disabled={isBlocked(view.userId)}
            onClick={() => void blockPerson()}
            className="press inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Ban className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {isBlocked(view.userId) ? "Đã chặn" : "Chặn"}
          </button>
          <button
            type="button"
            onClick={() => setReport({ userId: view.userId, name: view.name, conversationId: null, message: null })}
            className="press inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <Flag className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            Báo cáo
          </button>
        </div>
      ) : null}

      {isPhotoOpen ? (
        <div
          role="dialog"
          aria-label={`Ảnh đại diện của ${view.name}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85"
          onClick={() => setIsPhotoOpen(false)}
        >
          <button type="button" aria-label="Đóng" className="press absolute right-4 top-[calc(env(safe-area-inset-top)+12px)] flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="flex h-[min(70vw,320px)] w-[min(70vw,320px)] items-center justify-center rounded-full bg-secondary text-[min(18vw,88px)] font-semibold text-foreground/75">
            {initialsOf(view.name)}
          </span>
        </div>
      ) : null}

      <InviteMessageDialog
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        recipientLabel={view.name}
        onSend={async (message) => {
          const conversationId =
            personRef.groupId != null
              ? await startGroupConnection(personRef.groupId, view.userId, message)
              : await startPinConnection(view.pin ?? "", message);
          setIsInviteOpen(false);
          go(`/tin-nhan/${conversationId}`);
        }}
      />
      <ReportDialog
        target={report}
        open={report !== null}
        onOpenChange={(next) => (next ? undefined : setReport(null))}
        isBlockedAlready={isBlocked(view.userId)}
        isWorking={isReporting}
        onSubmit={(input) => {
          if (report === null) return;
          setIsReporting(true);
          void submitReport({
            reportedUserId: report.userId,
            reason: input.reason,
            note: input.note,
            conversationId: null,
            messageId: null,
            includeMessage: false,
            alsoBlock: input.alsoBlock,
          })
            .then(() => {
              toast.success(REPORT_SENT_TOAST);
              setReport(null);
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không gửi được báo cáo."))
            .finally(() => setIsReporting(false));
        }}
      />
    </div>
  );
}
