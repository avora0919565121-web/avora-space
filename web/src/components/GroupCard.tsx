import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays, ChevronRight, ListTodo, MessageCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { openPersonCard } from "@/components/PersonCard";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { peerLabel } from "@/lib/initials";
import { fetchGroupMembers, groupKeys, type GroupMember } from "@/lib/groups";
import { useContacts } from "@/lib/use-contacts";
import { useTasks } from "@/lib/use-tasks";
import { matchesPersonSearch, myNameFor } from "@/lib/user-aliases";
import { useUserAliases } from "@/lib/use-user-aliases";

/** The address key that opens something of a conversation on arrival (`?mo=thong-tin`). */
export const OPEN_PANEL_PARAM = "mo";
export type OpenPanel = "thong-tin" | "lich" | "nhiem-vu";

export type GroupRef = { conversationId: string; name: string; memberCount?: number | null; description?: string | null };

type Request = { ref: GroupRef; anchor: DOMRect | null };
let publish: ((request: Request) => void) | null = null;

/** Opens the group card (AVORA-71 · D) — the same frame as the person card. */
export function openGroupCard(ref: GroupRef, anchor?: Element | null): void {
  publish?.({ ref, anchor: anchor?.getBoundingClientRect() ?? null });
}

/** A group's face that opens its card; a `span role="button"` so it can live inside a row link. */
export function GroupAvatarButton({ group, size = "md" }: { group: GroupRef; size?: "sm" | "md" | "lg" }) {
  const open = (event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    openGroupCard(group, event.currentTarget);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Xem thẻ nhóm ${group.name}`}
      data-group-avatar=""
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      }}
      className="press no-callout inline-flex shrink-0 cursor-pointer rounded-full"
    >
      <InitialsAvatar name={group.name} size={size} />
    </span>
  );
}

/** Admins first, then the order people joined. */
export function groupCardMembers(members: readonly GroupMember[]): GroupMember[] {
  const rank = (member: GroupMember): number => (member.role === "owner" ? 0 : member.role === "admin" ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.joinedAt.localeCompare(b.joinedAt));
}

/** Mounted once for every signed-in screen. Phone: a sheet from below. Computer: anchored to the avatar. */
export function GroupCardHost() {
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
  const body = request === null ? null : <GroupCardBody group={request.ref} onClose={close} />;
  if (isMobile || request?.anchor === null) {
    return (
      <Sheet open={request !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[18px] px-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-5">
          <SheetTitle className="sr-only">Thẻ nhóm</SheetTitle>
          <SheetDescription className="sr-only">Tên nhóm, thành viên và các việc nhanh.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={request !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-[340px] p-4">
        {body}
      </PopoverContent>
    </Popover>
  );
}

function Tile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex min-h-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-[12px] border border-border bg-card px-1 text-[12px] font-medium text-foreground transition-colors hover:bg-accent/40"
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/**
 * The group card (AVORA-71 · D): big face, name, N thành viên; Nhắn · Lịch · Nhiệm vụ · Thông báo;
 * eight faces (admins first) and `+N`; `Tất cả tuỳ chọn ⋯`. Never an email, a number or a PIN of
 * anyone — those live on a person's own card, and only from my own Liên hệ.
 */
function GroupCardBody({ group, onClose }: { group: GroupRef; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { aliases } = useUserAliases();
  const { data: contacts } = useContacts();
  const { data: tasks } = useTasks();
  const membersQuery = useQuery({ queryKey: groupKeys.members(group.conversationId), queryFn: () => fetchGroupMembers(group.conversationId) });
  const [isListOpen, setIsListOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");

  const contactName = useMemo(
    () => new Map((contacts ?? []).filter((contact) => contact.linkedUserId !== null).map((contact) => [contact.linkedUserId as string, contact.name] as const)),
    [contacts],
  );
  const members = groupCardMembers(membersQuery.data ?? []);
  const nameOf = (member: GroupMember): string =>
    member.userId === user?.id ? "Bạn" : myNameFor({ contactName: contactName.get(member.userId), alias: aliases.get(member.userId), shownName: peerLabel(member.displayName) });
  const myTasks = (tasks ?? []).filter((task) => task.conversationId === group.conversationId && task.status !== "done" && task.status !== "skipped" && task.assigneeId === user?.id).length;
  const count = membersQuery.data?.length ?? group.memberCount ?? null;

  const go = (panel?: OpenPanel): void => {
    onClose();
    navigate(panel === undefined ? `/tin-nhan/${group.conversationId}` : `/tin-nhan/${group.conversationId}?${OPEN_PANEL_PARAM}=${panel}`);
  };
  const shown = members.filter((member) => matchesPersonSearch(query, [nameOf(member), member.displayName]));

  return (
    <div data-group-card="" className="text-left">
      <div className="flex items-center gap-4">
        <InitialsAvatar name={group.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[19px] font-semibold leading-tight text-foreground">{group.name}</p>
          <p className="tabular mt-1 text-[13.5px] text-muted-foreground">{count === null ? "Nhóm" : `${count} thành viên`}</p>
          {group.description ? <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{group.description}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Tile icon={<MessageCircle className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Nhắn" onClick={() => go()} />
        <Tile icon={<CalendarDays className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Lịch" onClick={() => go("lich")} />
        <Tile icon={<ListTodo className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label={`Nhiệm vụ · ${myTasks}`} onClick={() => go("nhiem-vu")} />
        <Tile icon={<Bell className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />} label="Thông báo" onClick={() => go("thong-tin")} />
      </div>

      <div className="mt-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Thành viên</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-group-faces="">
          {members.slice(0, 8).map((member) => (
            <button
              key={member.userId}
              type="button"
              aria-label={`Xem thẻ của ${nameOf(member)}`}
              onClick={(event) => openPersonCard({ userId: member.userId, name: member.displayName, groupId: group.conversationId }, event.currentTarget)}
              className="press rounded-full"
            >
              <InitialsAvatar name={nameOf(member)} size="sm" />
            </button>
          ))}
          {members.length > 8 || members.length > 0 ? (
            <button
              type="button"
              onClick={() => setIsListOpen((current) => !current)}
              aria-expanded={isListOpen}
              className="press inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border px-2.5 text-[12.5px] font-semibold text-muted-foreground"
            >
              {members.length > 8 ? `+${members.length - 8}` : "Xem tất cả"}
            </button>
          ) : null}
        </div>
        {isListOpen ? (
          <div className="mt-2 rounded-[12px] border border-border">
            {members.length > 10 ? (
              <label className="flex items-center gap-2 border-b border-border px-3">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm theo tên"
                  aria-label="Tìm thành viên"
                  className="h-10 min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]"
                />
              </label>
            ) : null}
            <ul className="max-h-[240px] divide-y divide-border overflow-y-auto">
              {shown.map((member) => (
                <li key={member.userId}>
                  <button
                    type="button"
                    onClick={(event) => openPersonCard({ userId: member.userId, name: member.displayName, groupId: group.conversationId }, event.currentTarget)}
                    className="press flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left text-[14px] hover:bg-accent/30"
                  >
                    <InitialsAvatar name={nameOf(member)} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{nameOf(member)}</span>
                    {member.role !== "member" ? <span className="text-[11.5px] text-muted-foreground">{member.role === "owner" ? "Chủ nhóm" : "Quản trị"}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => go("thong-tin")}
        className="press mt-4 flex min-h-11 w-full items-center gap-2 border-t border-border pt-3 text-left text-[14px] font-medium text-foreground"
      >
        <span className="flex-1">Tất cả tuỳ chọn ⋯</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}
