import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Copy,
  Crown,
  Link2,
  LogOut,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  ShieldMinus,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { FamilyFlagCard } from "@/components/chat/FamilyFlagCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { chatKeys } from "@/lib/chat";
import {
  adminSeatTakenMessage,
  buildInviteLink,
  canAppointAdmin,
  canLeaveGroup,
  canManageGroupInvite,
  canRenameGroup,
  canResolveRemovalRequests,
  canSeeRemovalRequests,
  canSubmitGroupRename,
  fetchGroupInvite,
  fetchGroupMembers,
  fetchGroupMeta,
  fetchPendingRemovalRequests,
  filterGroupMembers,
  findGroupAdmin,
  groupKeys,
  INVITE_BLOCKED_MESSAGE,
  INVITE_UNAVAILABLE_MESSAGE,
  LEAVE_BLOCKED_MESSAGE,
  leaveGroupConversation,
  memberActionsFor,
  memberMatchesQuery,
  openGroupDirectMessage,
  GROUP_NAME_MAX_LENGTH,
  removeGroupParticipant,
  RENAME_BLOCKED_MESSAGE,
  renameGroupConversation,
  requestRemoveParticipant,
  resolveInviteSectionState,
  resolveRemovalRequest,
  revokeGroupInvite,
  rotateGroupInvite,
  roleLabel,
  setGroupAdmin,
  shouldShowMemberSearch,
  sortGroupMembers,
  transferGroupOwnership,
  type GroupMember,
  type GroupRole,
} from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import { cn } from "@/lib/utils";

type ConfirmAction =
  | {
      kind: "remove" | "requestRemove" | "transferOwnership" | "makeAdmin" | "revokeAdmin";
      member: GroupMember;
    }
  /** Leaving is about yourself, so it carries no target member. */
  | { kind: "leave" }
  /** Rotating and revoking the invite link concern the door, not any one member. */
  | { kind: "rotateInvite" }
  | { kind: "revokeInvite" };

type GroupInfoSheetProps = {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fallback identity for a direct conversation, which has no member list to show. */
  peerName?: string;
  peerEmail?: string | null;
  /** The other person in a 1-1 — who the Gia đình mark is about. Absent in a group. */
  peerId?: string | null;
  /** Opens another thread (the private one started with "Nhắn riêng"). */
  onOpenConversation: (conversationId: string) => void;
  /** Called after the viewer leaves the group, once the thread is no longer theirs to read. */
  onLeft: () => void;
};

const roleBadgeClasses: Record<GroupRole, string> = {
  owner: "border-primary/40 bg-primary/10 text-primary",
  admin: "border-border bg-accent/60 text-foreground",
  member: "border-border bg-transparent text-muted-foreground",
};

/**
 * The group's roster and everything accountability needs on it: an admin may only ask for a
 * removal, an owner removes outright, and pending asks are visible with a name attached.
 * Every button shown is decided by {@link memberActionsFor} — the same rules the database enforces.
 */
export function GroupInfoSheet({
  conversationId,
  open,
  onOpenChange,
  peerName,
  peerEmail,
  peerId,
  onOpenConversation,
  onLeft,
}: GroupInfoSheetProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId: string | undefined = user?.id;
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [search, setSearch] = useState("");
  const [isRenaming, setIsRenaming] = useState<boolean>(false);
  const [nameDraft, setNameDraft] = useState<string>("");

  // A stale filter is a trap: the query belonged to the roster it was typed against, so it is
  // dropped whenever the panel is closed or pointed at another group.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open, conversationId]);

  const metaQuery = useQuery({
    queryKey: groupKeys.meta(conversationId),
    queryFn: () => fetchGroupMeta(conversationId),
    enabled: open,
  });

  const isGroup = metaQuery.data !== null;

  const membersQuery = useQuery({
    queryKey: groupKeys.members(conversationId),
    queryFn: () => fetchGroupMembers(conversationId),
    enabled: open && isGroup && Boolean(userId),
  });

  const members: GroupMember[] = membersQuery.data ?? [];
  const myRole: GroupRole | undefined = members.find((member) => member.userId === userId)?.role;

  const requestsQuery = useQuery({
    queryKey: groupKeys.removalRequests(conversationId),
    queryFn: () => fetchPendingRemovalRequests(conversationId),
    enabled: open && isGroup && Boolean(myRole) && canSeeRemovalRequests(myRole as GroupRole),
  });

  const inviteQuery = useQuery({
    queryKey: groupKeys.invite(conversationId),
    queryFn: () => fetchGroupInvite(conversationId),
    enabled: open && isGroup && Boolean(myRole),
  });

  const activeInvite = inviteQuery.data ?? null;
  const inviteState = resolveInviteSectionState({
    membersFailed: membersQuery.isError,
    roleKnown: Boolean(myRole),
    inviteFailed: inviteQuery.isError,
    inviteLoaded: inviteQuery.isSuccess,
  });
  const canManageInvite: boolean = Boolean(myRole) && canManageGroupInvite(myRole as GroupRole);
  const inviteLink: string | null = activeInvite
    ? buildInviteLink(window.location.origin, activeInvite.token)
    : null;

  const invalidateGroup = (): void => {
    void queryClient.invalidateQueries({ queryKey: groupKeys.members(conversationId) });
    void queryClient.invalidateQueries({ queryKey: groupKeys.removalRequests(conversationId) });
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  };

  const transferMutation = useMutation({
    mutationFn: (newOwnerUserId: string) => transferGroupOwnership(conversationId, newOwnerUserId),
    onSuccess: () => {
      toast.success("Đã chuyển quyền chủ nhóm.");
      setConfirmAction(null);
      // The old owner's own role changed too, so the meta (owner id) must refresh alongside the
      // roster or the panel would keep showing the viewer as owner.
      void queryClient.invalidateQueries({ queryKey: groupKeys.meta(conversationId) });
      invalidateGroup();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeMutation = useMutation({
    mutationFn: (targetUserId: string) => removeGroupParticipant(conversationId, targetUserId),
    onSuccess: () => {
      toast.success("Đã xoá thành viên khỏi nhóm.");
      setConfirmAction(null);
      invalidateGroup();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const requestMutation = useMutation({
    mutationFn: (targetUserId: string) => requestRemoveParticipant(conversationId, targetUserId),
    onSuccess: () => {
      toast.success("Đã gửi đề nghị xoá tới chủ nhóm.");
      setConfirmAction(null);
      invalidateGroup();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) =>
      resolveRemovalRequest(requestId, approve),
    onSuccess: (_data, variables) => {
      toast.success(variables.approve ? "Đã duyệt — thành viên bị xoá khỏi nhóm." : "Đã từ chối đề nghị.");
      invalidateGroup();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const leaveMutation = useMutation({
    mutationFn: () => leaveGroupConversation(conversationId),
    onSuccess: () => {
      toast.success("Bạn đã rời nhóm.");
      setConfirmAction(null);
      onOpenChange(false);
      // The group is no longer readable by this viewer; drop its cached roster rather than
      // refetching it into a permission error.
      queryClient.removeQueries({ queryKey: groupKeys.members(conversationId) });
      queryClient.removeQueries({ queryKey: groupKeys.removalRequests(conversationId) });
      queryClient.removeQueries({ queryKey: groupKeys.meta(conversationId) });
      queryClient.removeQueries({ queryKey: chatKeys.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onLeft();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const groupName: string | null = metaQuery.data?.name ?? null;

  const renameMutation = useMutation({
    mutationFn: (nextName: string) => renameGroupConversation(conversationId, nextName),
    onSuccess: (storedName: string) => {
      toast.success(`Đã đổi tên nhóm thành “${storedName}”.`);
      setIsRenaming(false);
      // The name is the group's identity everywhere: the panel header, the thread header and
      // every row of the inbox list read it, so all three are refreshed together.
      void queryClient.invalidateQueries({ queryKey: groupKeys.meta(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const adminMutation = useMutation({
    mutationFn: ({ targetUserId, makeAdmin }: { targetUserId: string; makeAdmin: boolean }) =>
      setGroupAdmin(conversationId, targetUserId, makeAdmin),
    onSuccess: (_data, variables) => {
      toast.success(
        variables.makeAdmin ? "Đã bổ nhiệm quản trị viên." : "Đã thu hồi quyền quản trị viên.",
      );
      setConfirmAction(null);
      // The seat decides who may see and raise removal requests, so the roster and the pending
      // list are refreshed together.
      invalidateGroup();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const dmMutation = useMutation({
    mutationFn: (targetUserId: string) => openGroupDirectMessage(targetUserId, conversationId),
    onSuccess: (directConversationId: string) => {
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      onOpenConversation(directConversationId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rotateInviteMutation = useMutation({
    mutationFn: () => rotateGroupInvite(conversationId),
    onSuccess: () => {
      toast.success("Đã tạo liên kết mời mới.");
      setConfirmAction(null);
      void queryClient.invalidateQueries({ queryKey: groupKeys.invite(conversationId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: () => revokeGroupInvite(conversationId),
    onSuccess: () => {
      toast.success("Đã thu hồi liên kết mời.");
      setConfirmAction(null);
      void queryClient.invalidateQueries({ queryKey: groupKeys.invite(conversationId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isBusy =
    removeMutation.isPending ||
    requestMutation.isPending ||
    resolveMutation.isPending ||
    dmMutation.isPending ||
    leaveMutation.isPending ||
    transferMutation.isPending ||
    renameMutation.isPending ||
    adminMutation.isPending ||
    rotateInviteMutation.isPending ||
    revokeInviteMutation.isPending;

  const canRename: boolean = Boolean(myRole) && canRenameGroup(myRole as GroupRole);

  const openRename = (): void => {
    setNameDraft(groupName ?? "");
    setIsRenaming(true);
  };

  const submitRename = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSubmitGroupRename(nameDraft, groupName) || renameMutation.isPending) return;
    renameMutation.mutate(nameDraft);
  };

  const memberName = (member: GroupMember): string => peerLabel(member.displayName, member.email);

  /** Copies the invite link; the fallback for browsers without the share sheet. */
  const copyInviteLink = async (): Promise<void> => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Đã sao chép liên kết mời.");
    } catch {
      toast.error("Không sao chép được liên kết. Hãy thử lại.");
    }
  };

  /** Opens the native share sheet when there is one; otherwise falls back to copying. */
  const shareInviteLink = async (): Promise<void> => {
    if (!inviteLink) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: groupName ?? "Nhóm",
          text: `Tham gia nhóm “${groupName ?? "Nhóm"}” nhé!`,
          url: inviteLink,
        });
        return;
      } catch {
        return; // the visitor closed the share sheet — not an error.
      }
    }
    await copyInviteLink();
  };

  // One admin seat per group: the appoint button is offered only while it is empty, and the
  // current holder's name explains why when it is not.
  const currentAdmin: GroupMember | null = findGroupAdmin(members);
  const adminSeatFree: boolean = canAppointAdmin(members);

  const showSearch = shouldShowMemberSearch(members.length);

  /** The words the confirmation dialog says for one pending decision. */
  const confirmCopy = (
    action: ConfirmAction,
  ): { title: string; description: string; confirmLabel: string; destructive: boolean } => {
    if (action.kind === "leave") {
      return {
        title: "Rời nhóm này?",
        description:
          "Bạn sẽ không còn đọc được tin nhắn của nhóm nữa. Muốn quay lại, bạn cần được chủ nhóm thêm vào lần nữa.",
        confirmLabel: "Rời nhóm",
        destructive: true,
      };
    }
    if (action.kind === "rotateInvite") {
      return {
        title: activeInvite ? "Tạo liên kết mời mới?" : "Tạo liên kết mời?",
        description:
          "Ai giữ liên kết này và có tài khoản sẽ vào được nhóm với tư cách thành viên thường. Nếu đã có liên kết cũ, nó sẽ ngưng hoạt động ngay lập tức.",
        confirmLabel: activeInvite ? "Tạo liên kết mới" : "Tạo liên kết",
        destructive: false,
      };
    }
    if (action.kind === "revokeInvite") {
      return {
        title: "Thu hồi liên kết mời?",
        description:
          "Không ai còn tham gia nhóm qua liên kết này nữa. Bạn có thể tạo liên kết mới bất cứ lúc nào.",
        confirmLabel: "Thu hồi",
        destructive: true,
      };
    }
    const name = memberName(action.member);
    if (action.kind === "transferOwnership") {
      return {
        title: `Chuyển quyền chủ nhóm cho ${name}?`,
        description: `${name} sẽ trở thành chủ nhóm. Bạn sẽ trở thành thành viên thường, và chỉ chủ nhóm mới có thể chuyển quyền đi nơi khác.`,
        confirmLabel: "Chuyển quyền",
        destructive: false,
      };
    }
    if (action.kind === "remove") {
      return {
        title: `Xoá ${name} khỏi nhóm?`,
        description: "Người này sẽ mất quyền truy cập vào nhóm và toàn bộ tin nhắn của nhóm ngay lập tức.",
        confirmLabel: "Xoá khỏi nhóm",
        destructive: true,
      };
    }
    if (action.kind === "makeAdmin") {
      return {
        title: `Bổ nhiệm ${name} làm quản trị viên?`,
        description: `${name} sẽ xem được các đề nghị xoá và được gửi đề nghị xoá thành viên thường — nhưng không tự xoá được ai, và bạn vẫn là chủ nhóm. Mỗi nhóm chỉ có một quản trị viên.`,
        confirmLabel: "Bổ nhiệm",
        destructive: false,
      };
    }
    if (action.kind === "revokeAdmin") {
      return {
        title: `Thu hồi quyền quản trị của ${name}?`,
        description: `${name} trở lại làm thành viên thường và không còn xem hay gửi được đề nghị xoá. Người này vẫn ở trong nhóm.`,
        confirmLabel: "Thu hồi quyền",
        destructive: false,
      };
    }
    return {
      title: `Đề nghị xoá ${name}?`,
      description:
        "Chủ nhóm sẽ nhận được đề nghị này và quyết định duyệt hay từ chối. Tên của bạn sẽ hiện kèm đề nghị.",
      confirmLabel: "Gửi đề nghị",
      destructive: false,
    };
  };

  const runConfirmedAction = (action: ConfirmAction): void => {
    if (action.kind === "leave") {
      leaveMutation.mutate();
      return;
    }
    if (action.kind === "remove") {
      removeMutation.mutate(action.member.userId);
      return;
    }
    if (action.kind === "transferOwnership") {
      transferMutation.mutate(action.member.userId);
      return;
    }
    if (action.kind === "makeAdmin" || action.kind === "revokeAdmin") {
      adminMutation.mutate({
        targetUserId: action.member.userId,
        makeAdmin: action.kind === "makeAdmin",
      });
      return;
    }
    if (action.kind === "rotateInvite") {
      rotateInviteMutation.mutate();
      return;
    }
    if (action.kind === "revokeInvite") {
      revokeInviteMutation.mutate();
      return;
    }
    requestMutation.mutate(action.member.userId);
  };
  const sortedMembers = sortGroupMembers(members);
  const visibleMembers = filterGroupMembers(sortedMembers, search);
  // The pending-removal list follows the same filter so an admin can pull up one person and see
  // both what they may do and what is already being asked about them.
  const visibleRequests = (requestsQuery.data ?? []).filter(
    (request) =>
      memberMatchesQuery(
        members.find((member) => member.userId === request.targetUserId) ?? {
          userId: request.targetUserId,
          displayName: null,
          email: null,
          role: "member",
          joinedAt: "",
        },
        search,
      ),
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md">
          {metaQuery.isPending ? (
            <p className="p-6 text-[14px] text-muted-foreground">Đang tải…</p>
          ) : metaQuery.isError ? (
            <div className="p-6">
              <p className="text-[14px] text-muted-foreground">{(metaQuery.error as Error).message}</p>
              <button
                type="button"
                onClick={() => void metaQuery.refetch()}
                className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Thử lại
              </button>
            </div>
          ) : isGroup ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-start gap-3 border-b border-border px-6 pb-5 pt-7">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-[20px] font-semibold tracking-tight text-foreground">
                    {groupName ?? "Nhóm"}
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
                    {membersQuery.isPending ? "Đang tải thành viên…" : `${members.length} thành viên`}
                  </SheetDescription>
                </div>
                {myRole ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Cài đặt nhóm"
                        className="press mt-0.5 shrink-0 rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                      >
                        <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60 border-border bg-card">
                      <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Cài đặt nhóm
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        disabled={!canRename || isBusy}
                        onSelect={(event) => {
                          event.preventDefault();
                          if (!canRename || isBusy) return;
                          openRename();
                        }}
                        className="gap-2 text-[14px]"
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                        Đổi tên nhóm
                      </DropdownMenuItem>
                      {canRename ? null : (
                        <p className="px-2 pb-2 pt-1 text-[12px] leading-snug text-muted-foreground">
                          {RENAME_BLOCKED_MESSAGE}.
                        </p>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                {canSeeRemovalRequests(myRole as GroupRole) && (requestsQuery.data ?? []).length > 0 ? (
                  <section className="mb-5 px-3" aria-label="Đề nghị xoá đang chờ duyệt">
                    <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <ShieldQuestion className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                      Đề nghị xoá đang chờ duyệt
                    </h3>
                    <ul className="mt-2 space-y-2">
                      {visibleRequests.map((request) => {
                        const target = members.find((member) => member.userId === request.targetUserId);
                        const requester = members.find((member) => member.userId === request.requestedBy);
                        const canResolve = Boolean(myRole) && canResolveRemovalRequests(myRole as GroupRole);
                        return (
                          <li
                            key={request.id}
                            className="rounded-lg border border-border bg-background/60 px-3 py-3"
                          >
                            <p className="text-[14px] text-foreground">
                              <span className="font-semibold">
                                {target ? memberName(target) : "Thành viên"}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                — đề nghị bởi {requester ? memberName(requester) : "quản trị viên"}
                              </span>
                            </p>
                            <div className="mt-2.5 flex items-center gap-2">
                              {canResolve ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      resolveMutation.mutate({ requestId: request.id, approve: true })
                                    }
                                    className="press rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-45"
                                  >
                                    Duyệt
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      resolveMutation.mutate({ requestId: request.id, approve: false })
                                    }
                                    className="press rounded-md border border-border px-3.5 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
                                  >
                                    Từ chối
                                  </button>
                                </>
                              ) : (
                                <span className="text-[12px] italic text-muted-foreground">
                                  Đang chờ chủ nhóm duyệt.
                                </span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                      {visibleRequests.length === 0 ? (
                        <li className="rounded-lg border border-border bg-background/60 px-3 py-3 text-[13px] italic text-muted-foreground">
                          Không có đề nghị nào khớp từ khoá hiện tại.
                        </li>
                      ) : null}
                    </ul>
                  </section>
                ) : null}

                <section className="mb-5 px-3" aria-label="Liên kết mời tham gia nhóm">
                  <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                    Liên kết mời
                  </h3>
                  {inviteState === "loading" ? (
                    <p className="mt-2 text-[13px] text-muted-foreground">Đang tải liên kết…</p>
                  ) : inviteState === "unavailable" ? (
                    <div className="mt-2 rounded-lg border border-dashed border-border bg-background/60 px-3 py-3">
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        {INVITE_UNAVAILABLE_MESSAGE}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void membersQuery.refetch();
                        }}
                        className="press mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                        Thử lại
                      </button>
                    </div>
                  ) : inviteState === "error" ? (
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      {(inviteQuery.error as Error).message}
                    </p>
                  ) : inviteLink ? (
                    <div className="mt-2 rounded-lg border border-border bg-background/60 px-3 py-3">
                      <p
                        className="truncate rounded-md border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground"
                        title={inviteLink}
                      >
                        {inviteLink}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void shareInviteLink()}
                          className="press inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-45"
                        >
                          <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                          Chia sẻ
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void copyInviteLink()}
                          className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
                        >
                          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                          Sao chép
                        </button>
                        {canManageInvite ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmAction({ kind: "rotateInvite" })}
                              className="press inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
                            >
                              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                              Làm mới
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setConfirmAction({ kind: "revokeInvite" })}
                              className="press inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-45"
                            >
                              <Ban className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                              Thu hồi
                            </button>
                          </>
                        ) : (
                          <p className="text-[12px] italic text-muted-foreground">
                            {INVITE_BLOCKED_MESSAGE} — bạn vẫn có thể chia sẻ liên kết.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : canManageInvite ? (
                    <div className="mt-2 rounded-lg border border-dashed border-border bg-background/60 px-3 py-3">
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Tạo một liên kết để gửi cho người bạn muốn thêm vào nhóm. Ai giữ liên kết và có tài
                        khoản sẽ vào nhóm với tư cách thành viên thường.
                      </p>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setConfirmAction({ kind: "rotateInvite" })}
                        className="press mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-45"
                      >
                        <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                        Tạo liên kết mời
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[13px] italic text-muted-foreground">
                      Chưa có liên kết mời — chỉ chủ nhóm mới tạo được.
                    </p>
                  )}
                </section>

                <section aria-label="Danh sách thành viên">
                  <h3 className="px-3 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Thành viên
                  </h3>
                  {showSearch ? (
                    <div className="relative mx-3 mt-2">
                      <Search
                        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Tìm theo tên hoặc email"
                        aria-label="Tìm thành viên"
                        className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-9 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60 [&::-webkit-search-cancel-button]:hidden"
                      />
                      {search ? (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          aria-label="Xoá từ khoá tìm kiếm"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {membersQuery.isError ? (
                    <p className="px-3 py-6 text-[14px] text-muted-foreground">
                      {(membersQuery.error as Error).message}
                    </p>
                  ) : membersQuery.isPending ? (
                    <ul className="mt-2 space-y-1 px-3" aria-hidden="true">
                      {[0, 1, 2].map((row) => (
                        <li key={row} className="flex items-center gap-3 py-3">
                          <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-secondary" />
                          <span className="min-w-0 flex-1 space-y-2">
                            <span className="block h-3.5 w-1/3 animate-pulse rounded bg-secondary" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="mt-1">
                      {visibleMembers.map((member) => {
                        const isSelf = member.userId === userId;
                        const actions =
                          Boolean(userId) && Boolean(myRole)
                            ? memberActionsFor(myRole as GroupRole, member.role, isSelf)
                            : [];
                        return (
                          <li
                            key={member.userId}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/30"
                          >
                            <InitialsAvatar name={memberName(member)} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[15px] font-medium text-foreground">
                                  {memberName(member)}
                                  {isSelf ? <span className="text-muted-foreground"> (bạn)</span> : null}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-none",
                                    roleBadgeClasses[member.role],
                                  )}
                                >
                                  {roleLabel(member.role)}
                                </span>
                              </p>
                              {member.email ? (
                                <p className="truncate text-[12.5px] text-muted-foreground">{member.email}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {actions.includes("requestRemove") ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setConfirmAction({ member, kind: "requestRemove" })}
                                  className="press rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
                                >
                                  Đề nghị xoá
                                </button>
                              ) : null}
                              {actions.includes("remove") ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  aria-label={`Xoá ${memberName(member)} khỏi nhóm`}
                                  onClick={() => setConfirmAction({ member, kind: "remove" })}
                                  className="press inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1.5 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-45"
                                >
                                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                  Xoá
                                </button>
                              ) : null}
                              {actions.includes("makeAdmin") ? (
                                <button
                                  type="button"
                                  disabled={isBusy || !adminSeatFree}
                                  title={
                                    adminSeatFree || !currentAdmin
                                      ? undefined
                                      : adminSeatTakenMessage(memberName(currentAdmin))
                                  }
                                  aria-label={`Bổ nhiệm ${memberName(member)} làm quản trị viên`}
                                  onClick={() => setConfirmAction({ member, kind: "makeAdmin" })}
                                  className="press inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                  Làm quản trị
                                </button>
                              ) : null}
                              {actions.includes("revokeAdmin") ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  aria-label={`Thu hồi quyền quản trị của ${memberName(member)}`}
                                  onClick={() => setConfirmAction({ member, kind: "revokeAdmin" })}
                                  className="press inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-45"
                                >
                                  <ShieldMinus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                  Thu hồi quyền
                                </button>
                              ) : null}
                              {actions.includes("transferOwnership") ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  aria-label={`Chuyển quyền chủ nhóm cho ${memberName(member)}`}
                                  onClick={() => setConfirmAction({ member, kind: "transferOwnership" })}
                                  className="press inline-flex items-center gap-1 rounded-md border border-primary/40 px-2.5 py-1.5 text-[12.5px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-45"
                                >
                                  <Crown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                  Chuyển quyền
                                </button>
                              ) : null}
                              {actions.includes("directMessage") ? (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  aria-label={`Nhắn riêng với ${memberName(member)}`}
                                  onClick={() => dmMutation.mutate(member.userId)}
                                  className="press inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-45"
                                >
                                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                  Nhắn riêng
                                </button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!membersQuery.isPending && !membersQuery.isError && visibleMembers.length === 0 ? (
                    <p className="px-3 py-6 text-[14px] text-muted-foreground">
                      Không có thành viên nào khớp “{search.trim()}”.
                    </p>
                  ) : null}
                </section>
              </div>

              {myRole ? (
                <div className="border-t border-border px-6 py-4">
                  {canLeaveGroup(myRole) ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmAction({ kind: "leave" })}
                      className="press inline-flex items-center gap-2 rounded-md border border-destructive/30 px-4 py-2.5 text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-45"
                    >
                      <LogOut className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                      {leaveMutation.isPending ? "Đang rời nhóm…" : "Rời nhóm"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled
                        aria-describedby="leave-blocked-notice"
                        className="press inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-border px-4 py-2.5 text-[14px] font-medium text-muted-foreground opacity-70"
                      >
                        <LogOut className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                        Rời nhóm
                      </button>
                      <p id="leave-blocked-notice" className="mt-2 text-[12.5px] text-muted-foreground">
                        {LEAVE_BLOCKED_MESSAGE}.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border px-6 pb-5 pt-7">
                <SheetTitle className="text-[20px] font-semibold tracking-tight text-foreground">
                  Thông tin cuộc trò chuyện
                </SheetTitle>
                <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
                  Cuộc trò chuyện trực tiếp giữa hai người
                </SheetDescription>
              </div>
              <div className="flex items-center gap-3 px-6 py-5">
                <InitialsAvatar name={peerName ?? "?"} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-foreground">{peerName}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {peerEmail ?? "Người dùng AVORA"}
                  </p>
                </div>
              </div>

              {/* Only in a 1-1: family is a relationship between two people, not a room. */}
              {peerId ? (
                <FamilyFlagCard peerId={peerId} peerName={peerName ?? "người này"} />
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={isRenaming} onOpenChange={(next) => (next ? undefined : setIsRenaming(false))}>
        <DialogContent className="border-border bg-card sm:max-w-md">
          <DialogTitle className="text-[18px] font-semibold tracking-tight text-foreground">
            Đổi tên nhóm
          </DialogTitle>
          <DialogDescription className="text-[13.5px] text-muted-foreground">
            Tên mới hiện ngay với mọi thành viên. Thành viên và quyền trong nhóm không thay đổi.
          </DialogDescription>
          <form onSubmit={submitRename} className="mt-1 space-y-4">
            <div>
              <label htmlFor="group-rename-input" className="sr-only">
                Tên nhóm
              </label>
              <input
                id="group-rename-input"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                maxLength={GROUP_NAME_MAX_LENGTH}
                autoFocus
                placeholder="Tên nhóm"
                className="h-11 w-full rounded-md border border-border bg-background px-3.5 text-[15px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
              <p className="mt-1.5 text-right text-[12px] text-muted-foreground">
                {nameDraft.trim().length}/{GROUP_NAME_MAX_LENGTH}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsRenaming(false)}
                className="press rounded-md border border-border px-4 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={!canSubmitGroupRename(nameDraft, groupName) || renameMutation.isPending}
                className="press rounded-md bg-primary px-4 py-2 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92 disabled:opacity-45"
              >
                {renameMutation.isPending ? "Đang lưu…" : "Lưu tên"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction !== null} onOpenChange={(next) => (!next ? setConfirmAction(null) : undefined)}>
        {confirmAction ? (
          <AlertDialogContent className="border-border bg-card">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">
                {confirmCopy(confirmAction).title}
              </AlertDialogTitle>
              <AlertDialogDescription>{confirmCopy(confirmAction).description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border bg-transparent text-foreground hover:bg-accent/40">
                Huỷ
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => runConfirmedAction(confirmAction)}
                className={cn(
                  confirmCopy(confirmAction).destructive
                    ? "bg-destructive text-white hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/92",
                )}
              >
                {confirmCopy(confirmAction).confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </>
  );
}
