import { logError } from "@/lib/log";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  Check,
  Clock3,
  CalendarClock,
  ClipboardPaste,
  CircleAlert,
  ChevronLeft,
  FolderKanban,
  Hand,
  ListPlus,
  ListTodo,
  Mail,
  MessageSquarePlus,
  MoreHorizontal,
  NotebookPen,
  Plus,
  QrCode,
  Search,
  SquarePen,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** The one "Sắp ra mắt" screen the remaining placeholder tab shows, in both panes. */
function PlaceholderComingSoon({ id }: { id: MessageTab }) {
  if (!isPlaceholderTab(id)) return null;
  const content = PLACEHOLDER_CONTENT[id];
  return (
    <ComingSoon
      icon={content.icon}
      title={content.title}
      description={content.description}
    />
  );
}
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ComingSoon } from "@/components/ComingSoon";
import { NewChatDialog } from "@/components/NewChatDialog";
import { ResizeHandle } from "@/components/ResizeHandle";
import { NewGroupDialog } from "@/components/NewGroupDialog";
import { ChatSuggestionPanel, useChatSuggestions } from "@/components/chat/ChatSuggestionPanel";
import { ThreadChipRow, type ThreadChip, type ThreadChipId } from "@/components/chat/ThreadChipRow";
import { askConfirm } from "@/components/ConfirmHost";
import { JournalTrashSheet, useJournalTrashCount } from "@/components/chat/JournalTrashSheet";
import { ReturnChip } from "@/components/nav/ReturnChip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { firstVisibleMessage, forgetThreadPlace, readThreadPlace, rememberThreadPlace } from "@/lib/thread-place";
import { ChatTaskPanel, useChatThreadTasks } from "@/components/chat/ChatTaskPanel";
import { GroupDecisionSheet } from "@/components/chat/GroupDecisionSheet";
import { GroupInfoSheet } from "@/components/chat/GroupInfoSheet";
import { GroupTaskListSheet } from "@/components/chat/GroupTaskListSheet";
import { ComposerPlusMenu } from "@/components/chat/ComposerPlusMenu";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { AttachActions, StagedAttachmentBar } from "@/components/chat/ComposerAttachments";
import { MessageAttachments } from "@/components/chat/MessageAttachments";
import { ForwardDialog } from "@/components/chat/ForwardDialog";
import { ForwardBundleCard } from "@/components/chat/ForwardBundleCard";
import { ScheduleMessageDialog } from "@/components/chat/ScheduleMessageDialog";
import { ScheduledStrip, waitingScheduled } from "@/components/chat/ScheduledStrip";
import { ProposalCard } from "@/components/chat/ProposalCard";
import { useProposals } from "@/lib/use-think-hub-shelf";
import { sendAtLine, useMyScheduled, useScheduleActions } from "@/lib/scheduled-messages";
import { SelectionBar } from "@/components/chat/SelectionBar";
import {
  MessageActionsAffordance,
  type MessageAction,
} from "@/components/chat/MessageActionsMenu";
import { MessageReactions, ReactionPicker } from "@/components/chat/MessageReactions";
import { MessageTaskDot } from "@/components/chat/MessageTaskDot";
import { PinChoiceDialog, PinnedStrip } from "@/components/chat/PinnedStrip";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { ProjectList } from "@/components/projects/ProjectList";
import { TableStrip } from "@/components/projects/TableStrip";
import { ThreadSearch } from "@/components/chat/ThreadSearch";
import {
  extractMentionedIds,
  mentionCandidates as buildMentionCandidates,
  splitMentions,
} from "@/lib/mentions";
import { TaskFromChatDialog } from "@/components/chat/TaskFromChatDialog";
import { DiaryCountRow, DiaryFilesView, DiaryHeaderIcon, DiaryLinksView, DiaryList, DiarySourcesView } from "@/components/chat/DiaryViews";
import { Switch } from "@/components/ui/switch";
import { closeNotificationsFor, offerPushSoon } from "@/lib/push";
import { AvoraSearchButton, SearchEverywhereLine } from "@/components/search/AvoraSearch";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { toAttachmentView } from "@/components/notes/NoteEditor";
import { NoteExits, type BoardExit, type TaskExit } from "@/components/notes/NoteExits";
import { useNotes } from "@/lib/use-notes";
import { ConversationMoreSections } from "@/components/chat/ConversationMoreSections";
import { BlockConfirmDialog } from "@/components/chat/BlockConfirmDialog";
import { ReportDialog, type ReportTarget } from "@/components/chat/ReportDialog";
import { BLOCKED_SEND_NOTICE } from "@/lib/blocks";
import { NOT_CONNECTED_NOTICE } from "@/lib/connections";
import { VerificationPanel } from "@/components/chat/VerificationPanel";
import { REPORT_SENT_TOAST, submitReport, type ReportReason } from "@/lib/reports";
import { useBlocks } from "@/lib/use-blocks";
import { TaskDetailSheet } from "@/components/tasks/TaskDetailSheet";
import {
  DIARY_VIEW_PARAM,
  DIARY_VIEWS,
  diaryFileNotes,
  diaryLinks,
  diaryPrimaryPlace,
  diaryViewFromSlug,
  diaryViewSlug,
  entryChips,
  hasNewSince,
  journalTimeline,
  latestOf,
  markDiarySeen,
  readDiarySeen,
  readLastDiaryView,
  rememberDiaryView,
  type DiaryFileNote,
  type DiaryLink,
  type DiaryView,
} from "@/lib/diary-views";
import { isDeletedFor } from "@/lib/tasks";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  countSavedMeetingNotes,
  DECISION_PARAM,
  meetingNoteKeys,
  parseSavedMeetingNote,
  type SavedMeetingNote,
} from "@/lib/meeting-notes";
import { pasteSourceTasks } from "@/lib/paste-intake";
import { usePasteTask } from "@/hooks/use-paste-task";
import {
  attachmentKeys,
  fetchThreadAttachments,
  sendMessageWithAttachments,
  stageAttachment,
  uploadStagedAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type AttachmentPermission,
  type MessageAttachment,
  type StagedAttachment,
} from "@/lib/attachments";
import { useThreadAttachments } from "@/lib/use-attachments";
import {
  cancelRecording,
  isRecordingSupported,
  getRecorderState as getRecorderStateSafe,
  startRecording as startGlobalRecording,
  stopRecording as stopGlobalRecording,
  useRecorder,
} from "@/lib/recorder";
import {
  deleteJournalMessages,
  deleteSummaryText,
  restoreJournalMessages,
  forwardedFromLabel,
  toggleSelected,
} from "@/lib/forwarding";
import { useAuth } from "@/lib/auth";
import { useChatRealtime } from "@/lib/realtime";
import { useConversations } from "@/lib/use-conversations";
import { useDocumentVisible } from "@/lib/use-document-visible";
import {
  chatKeys,
  clearUnread,
  conversationSubtitle,
  conversationTitle,
  JOURNAL_TITLE,
  editMessage,
  ensureJournalConversation,
  fetchConversationPeer,
  canReplyToMessage,
  fetchMessages,
  fetchMessageTime,
  fetchOlderMessages,
  MESSAGE_PAGE_SIZE,
  filterConversationsByTab,
  formatClock,
  formatInboxTime,
  formatMissedMessages,
  formatUnreadBadge,
  groupMessagesByDay,
  firstUnreadByCount,
  isEdited,
  isNearThreadBottom,
  isPlaceholderTab,
  isProjectTab,
  isRecalled,
  lastOutgoingId,
  ORIGIN_GROUP_PARAM,
  markConversationRead,
  matchesConversationQuery,
  messageBodyText,
  MESSAGE_TABS,
  quotePreview,
  recallMessage,
  sendMessage,
  sendReceiptLabel,
  tabForOpenedThread,
  threadScrollDecision,
  unreadForTab,
  failedSendIdOf,
  withFailedSends,
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
  type FailedSend,
  type MessageTab,
} from "@/lib/chat";
import { LIST_COLUMN, useColumnWidth } from "@/lib/column-width";
import { fetchGroupMembers, fetchGroupParents, groupKeys } from "@/lib/groups";
import { buildGroupTree } from "@/lib/group-tree";
import { GroupTree } from "@/components/chat/GroupTree";
import { CallMenu } from "@/components/chat/CallMenu";
import { ScheduleCallDialog } from "@/components/chat/ScheduleCallDialog";
import { splitLinks } from "@/lib/calls";
import { peerLabel } from "@/lib/initials";
import {
  CONTEXT_TASK_PARAM,
  DELETED_MESSAGE_NOTE,
  isOriginalMessageMissing,
} from "@/lib/task-context";
import { projectLink } from "@/lib/projects";
import { hereFrom, readReturn, withReturn } from "@/lib/return-to";
import { TaskContextStrip } from "@/components/chat/TaskContextStrip";
import { placeSilentSkipNotices, silentSkipNotices, silentSkipNote, TASK_DESCRIPTION_MAX_LEN, todayIso } from "@/lib/tasks";
import { silentlySkippedInConversation } from "@/lib/task-suggestions";
import { canPinForGroup } from "@/lib/pins";
import { useThreadPins } from "@/lib/use-pins";
import { recallRequestNote } from "@/lib/recall-requests";
import { useRecallRequests } from "@/lib/use-recall-requests";
import type { MessageTaskSummary } from "@/lib/message-tasks";
import { useMessageTasks } from "@/lib/use-message-tasks";
import { useThreadReactions } from "@/lib/use-reactions";
import { useThreadCelebrations } from "@/lib/use-task-celebrations";
import { useProfileSettings } from "@/lib/use-settings";
import { useProjects } from "@/lib/use-projects";
import { useTasks } from "@/lib/use-tasks";
import { useTaskSuggestions } from "@/lib/use-task-suggestions";
import { typingText, useThreadPresence } from "@/lib/use-thread-presence";
import { cn } from "@/lib/utils";
import { transcriptText } from "@/lib/chat-transcript";
import { draftPreview, readDraft, useDraftsVersion, writeDraft } from "@/lib/chat-drafts";
import { CalendarPeekButton } from "@/components/tasks/CalendarPeekSheet";

/**
 * Realtime is the delivery path. This interval only engages while the socket is down
 * (blocked websockets, flaky network) so the app degrades instead of going silent.
 */
const OFFLINE_THREAD_POLL_MS = 5_000;

/**
 * The one direction still named in the strip but not built. Borrowed from the same
 * "Sắp ra mắt" page Mật khẩu and Avora AI use — no inputs, no promise of a function
 * that cannot answer.
 */
const PLACEHOLDER_CONTENT: Readonly<
  Record<"email", { icon: LucideIcon; title: string; description: string }>
> = {
  email: {
    icon: Mail,
    title: "Email",
    description:
      "Đọc email của bạn ngay trong AVORA, biến một email thành việc, mục trong Két sắt, hoặc tham chiếu vào cuộc trò chuyện — trả lời vẫn mở đúng email thật của bạn. Đang được xây, chưa mở ở đây.",
  },
};

const Messages = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId: string | undefined = user?.id;
  // ADR-031: proposal cards in the thread read their live state from here.
  const proposalsQuery = useProposals();
  const proposalsByMessage = useMemo(
    () => new Map((proposalsQuery.data ?? []).flatMap((proposal) => (proposal.messageId === null ? [] : [[proposal.messageId, proposal] as const]))),
    [proposalsQuery.data],
  );
  const { isLive, setReadingConversation } = useChatRealtime();
  const isTabVisible = useDocumentVisible();

  const [query, setQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<MessageTab>("direct");
  /** A direction named in the strip but not built yet: Email. */
  const isPlaceholder = isPlaceholderTab(activeTab);
  /** Dự án lists projects rather than threads, so the pane below the strip changes entirely. */
  const isProjects = isProjectTab(activeTab);
  // Desktop only: the list column's width, as the reader last dragged it.
  const listColumn = useColumnWidth(LIST_COLUMN);
  const listSectionRef = useRef<HTMLElement | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState<boolean>(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = useState<boolean>(false);
  /**
   * Which conversation a new project will live in, or null when the dialog is closed.
   *
   * Held as the conversation rather than as a boolean because the same dialog serves all three
   * kinds: the tab opens it on the journal, a thread opens it on itself.
   */
  const [projectTarget, setProjectTarget] = useState<ConversationSummary | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState<boolean>(false);
  const [isGroupTasksOpen, setIsGroupTasksOpen] = useState<boolean>(false);
  const [isDecisionsOpen, setIsDecisionsOpen] = useState<boolean>(false);
  const [isScheduleCallOpen, setIsScheduleCallOpen] = useState<boolean>(false);
  /** AVORA-49 · 2.1: which chip of the thread's chip row is open (nothing opens on its own). */
  const [openChip, setOpenChip] = useState<ThreadChipId | null>(null);
  /** AVORA-49 · 2.1c: the "not live" line, hidden with ✕ until the connection changes. */
  const [isLiveNoticeHidden, setIsLiveNoticeHidden] = useState<boolean>(false);
  /** AVORA-44 · việc 8: Nhật ký's Thùng rác (entries kept 30 days). */
  const [isJournalTrashOpen, setIsJournalTrashOpen] = useState<boolean>(false);
  /**
   * The message a new task will quote. Null means "whatever was said last", which is what the
   * button beside the composer means; a bubble's own action names that bubble instead.
   */
  const [taskSourceMessage, setTaskSourceMessage] = useState<ChatMessage | null>(null);
  /**
   * The composer belongs to exactly one conversation (Đợt gộp 2 · A8). Its words are stored with
   * their owner, so a render for another thread can never show — or send — them: that thread
   * reads its own saved draft instead.
   */
  const [composer, setComposer] = useState<{ owner: string | undefined; text: string }>({ owner: undefined, text: "" });
  const draft: string = composer.owner === conversationId ? composer.text : readDraft(userId, conversationId);
  const setDraft = useCallback(
    (next: string | ((current: string) => string)): void => {
      setComposer((current) => {
        const base = current.owner === conversationId ? current.text : readDraft(userId, conversationId);
        const text = typeof next === "function" ? next(base) : next;
        writeDraft(userId, conversationId, text);
        return { owner: conversationId, text };
      });
    },
    [conversationId, userId],
  );
  /** The thread on screen right now, for the last-line check before a send. */
  const activeConversationRef = useRef<string | undefined>(conversationId);
  activeConversationRef.current = conversationId;
  /**
   * Files chosen but not yet sent. Held here rather than inside the composer so that leaving
   * the thread genuinely abandons them — a file staged in one conversation must never follow
   * the reader into another one.
   */
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  /**
   * Picking several messages at once. Off by default: a tick box on every bubble would make
   * reading a conversation feel like auditing one.
   */
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isForwardOpen, setIsForwardOpen] = useState<boolean>(false);
  /** "Gửi hẹn giờ" dialog (Đợt gộp 2 · B2). */
  const [isScheduleOpen, setIsScheduleOpen] = useState<boolean>(false);
  /** A task made from the picked messages (Đợt gộp 2 · A5): ids oldest first + the words. */
  const [taskSelection, setTaskSelection] = useState<{ messageIds: string[]; transcript: string } | null>(null);
  /** Chặn / Báo cáo (AVORA-37). */
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState<boolean>(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  /**
   * The conversation where the last send was refused because of a block. Shown to the sender
   * as one neutral line — never the word "chặn" — and cleared by the next successful send.
   */
  const [refusedSendConversationId, setRefusedSendConversationId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** The message the next send will answer, shown as a quote above the composer. */
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  /** Which bubble is currently open for correction, and the text being corrected. */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  /** A result just jumped to, lit briefly so the eye can find it among its neighbours. */
  const [flashedMessageId, setFlashedMessageId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  /** A suggestion the reader asked to see, from the dot on the message it came out of. */
  const [focusedSuggestionId, setFocusedSuggestionId] = useState<string | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is watching the live end of the thread, and how many messages have
  // landed since they last were — together they decide the jump-to-newest pill.
  const [isThreadAtBottom, setIsThreadAtBottom] = useState<boolean>(true);
  const [missedMessages, setMissedMessages] = useState<number>(0);
  /**
   * Paged thread (Đợt gộp 2 · A7): per conversation, the oldest moment already loaded (null = only
   * the newest page) and whether the start of the conversation has been reached.
   */
  const windowSinceRef = useRef<Map<string, string>>(new Map());
  const [reachedStart, setReachedStart] = useState<Record<string, boolean>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  /** Messages looked up and found gone for good (deleted, or never readable). */
  const [missingMessageIds, setMissingMessageIds] = useState<ReadonlySet<string>>(new Set());

  const conversationsQuery = useConversations();

  const conversations: ConversationSummary[] = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  /** The chosen direction first, then the search box within it. */
  const tabConversations: ConversationSummary[] = useMemo(
    () => filterConversationsByTab(conversations, activeTab),
    [conversations, activeTab],
  );

  /** Any draft changing re-reads the list rows' "✎ Nháp" lines (A8). */
  const draftsVersion: number = useDraftsVersion();
  const visibleConversations: ConversationSummary[] = useMemo(
    () => tabConversations.filter((item) => matchesConversationQuery(item, query)),
    [tabConversations, query],
  );

  const activeSummary: ConversationSummary | undefined = useMemo(
    () => conversations.find((item) => item.conversationId === conversationId),
    [conversations, conversationId],
  );

  const projectsQuery = useProjects();
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  /** Every group the viewer is in, for drawing the Nhóm tab as a tree (Nhóm → Sub-group → Project). */
  const groupIds: string[] = useMemo(
    () => conversations.filter((item) => item.kind === "group").map((item) => item.conversationId).sort(),
    [conversations],
  );
  const groupParentsQuery = useQuery({
    queryKey: groupKeys.parents(groupIds),
    queryFn: () => fetchGroupParents(groupIds),
    enabled: activeTab === "group" && groupIds.length > 0,
    staleTime: 60_000,
  });
  const projectByIdMap = useMemo(() => new Map(projects.map((project) => [project.id, project] as const)), [projects]);
  const groupTree = useMemo(() => {
    const projectOfConversation = new Map(projects.map((project) => [project.conversationId, project.id] as const));
    // Until the parents arrive, a project's own parent is already known from the project list.
    const parents = new Map<string, string | null>(groupParentsQuery.data ?? []);
    for (const project of projects) {
      if (!parents.has(project.conversationId)) parents.set(project.conversationId, project.parentGroupId);
    }
    return buildGroupTree(tabConversations.filter((item) => item.kind === "group"), parents, projectOfConversation);
  }, [tabConversations, groupParentsQuery.data, projects]);

  /** The projects belonging to the thread on screen, for the 📁 Dự án strip above it. */
  const threadProjects = useMemo(
    () => projects.filter((project) => project.parentGroupId === conversationId),
    [projects, conversationId],
  );

  /** When the thread on screen is a project's own sub-group: that project. */
  const projectHere = useMemo(
    () => projects.find((project) => project.conversationId === conversationId),
    [projects, conversationId],
  );
  const isProjectChatClosed: boolean = projectHere !== undefined && projectHere.status !== "active";

  /** The journal, which is where a personal project is opened from the tab. */
  const journalSummary: ConversationSummary | undefined = useMemo(
    () => conversations.find((item) => item.kind === "personal"),
    [conversations],
  );

  // A thread can be opened straight from its URL before the inbox has loaded.
  const peerQuery = useQuery({
    queryKey: chatKeys.peer(conversationId ?? ""),
    queryFn: () => fetchConversationPeer(conversationId as string),
    enabled: Boolean(conversationId) && Boolean(userId) && activeSummary === undefined,
  });

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: chatKeys.messages(conversationId ?? ""),
    queryFn: async () => {
      const id = conversationId as string;
      const since = windowSinceRef.current.get(id) ?? null;
      const rows = await fetchMessages(id, since);
      // A first page shorter than a page is the whole conversation.
      if (since === null && rows.length < MESSAGE_PAGE_SIZE) setReachedStart((current) => ({ ...current, [id]: true }));
      return rows;
    },
    enabled: Boolean(conversationId) && Boolean(userId),
    refetchInterval: isLive ? false : OFFLINE_THREAD_POLL_MS,
  });

  const peerName: string = activeSummary?.peerName ?? peerQuery.data?.peerName ?? "Cuộc trò chuyện";

  const activeKind: ConversationKind = activeSummary?.kind ?? "direct";
  const threadTitle: string = activeSummary ? conversationTitle(activeSummary) : peerName;
  const threadSubtitle: string = activeSummary
    ? conversationSubtitle(activeSummary)
    : "Người dùng AVORA";

  /** The other person in a 1-1; null in a group or journal. */
  const directPeerId: string | null =
    activeKind === "direct" ? (activeSummary?.peerId ?? peerQuery.data?.peerId ?? null) : null;
  const { isBlocked: isUserBlocked, block: blockPeer, unblock: unblockPeer, isWorking: isBlockWorking } = useBlocks();
  /** True when the viewer blocked the peer of this 1-1. Never reveals the reverse. */
  const hasBlockedPeer: boolean = directPeerId !== null && isUserBlocked(directPeerId);
  /** AVORA-38: an open "Chờ kết bạn" frame, or a 1-1 whose pair is no longer bạn. */
  const activeVerification = activeKind === "direct" ? (activeSummary?.verification ?? null) : null;
  const isNoLongerConnected: boolean =
    activeKind === "direct" && activeVerification === null && activeSummary?.isConnected === false;
  /** Send later (B2): not in the journal, a verification frame, or a 1-1 that can no longer talk. */
  const canSchedule: boolean =
    activeKind !== "personal" && activeVerification === null && !isNoLongerConnected;
  const scheduledQuery = useMyScheduled(conversationId, canSchedule);
  const scheduleActions = useScheduleActions(conversationId);
  const scheduledSentIds: ReadonlySet<string> = useMemo(
    () => new Set((scheduledQuery.data ?? []).filter((item) => item.status === "sent" && item.sentMessageId !== null).map((item) => item.sentMessageId as string)),
    [scheduledQuery.data],
  );

  const reportMutation = useMutation({
    mutationFn: (input: { target: ReportTarget; reason: ReportReason; note: string; alsoBlock: boolean }) =>
      submitReport({
        reportedUserId: input.target.userId,
        reason: input.reason,
        note: input.note,
        conversationId: input.target.conversationId,
        messageId: input.target.message?.id ?? null,
        includeMessage: input.target.message !== null,
        alsoBlock: input.alsoBlock,
      }),
    onSuccess: (_id, input) => {
      setReportTarget(null);
      toast.success(REPORT_SENT_TOAST);
      if (input.alsoBlock) void queryClient.invalidateQueries({ queryKey: ["user-blocks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const confirmBlock = useCallback((): void => {
    if (directPeerId === null) return;
    void blockPeer(directPeerId)
      .then(() => {
        setIsBlockConfirmOpen(false);
        toast.success(`Đã chặn ${threadTitle}.`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa lưu được."));
  }, [directPeerId, blockPeer, threadTitle]);

  const handleUnblock = useCallback((): void => {
    if (directPeerId === null) return;
    void unblockPeer(directPeerId)
      .then(() => {
        setRefusedSendConversationId(null);
        toast.success(`Đã bỏ chặn ${threadTitle}.`);
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Chưa lưu được."));
  }, [directPeerId, unblockPeer, threadTitle]);

  /**
   * A group resolves no peer by design, so "no peer" alone cannot mean "no access".
   * The inbox is the authority: once it has loaded without this thread, the viewer is
   * genuinely not a participant.
   */
  const isUnknownConversation: boolean =
    Boolean(conversationId) &&
    conversationsQuery.isSuccess &&
    activeSummary === undefined &&
    peerQuery.isSuccess &&
    peerQuery.data === null;

  // Group messages come from many people, so each incoming bubble needs a name on it.
  const groupMembersQuery = useQuery({
    queryKey: groupKeys.members(conversationId ?? ""),
    queryFn: () => fetchGroupMembers(conversationId as string),
    enabled: Boolean(conversationId) && activeKind === "group",
  });

  const senderNames: Map<string, string> = useMemo(() => {
    const names = new Map<string, string>();
    for (const member of groupMembersQuery.data ?? []) {
      names.set(member.userId, peerLabel(member.displayName));
    }
    return names;
  }, [groupMembersQuery.data]);

  /**
   * Sends that failed, kept on screen where they were written until they go through or are
   * dropped. In memory only: they survive switching threads, not a reload.
   */
  const [failedSends, setFailedSends] = useState<FailedSend[]>([]);
  /** The files a failed send was carrying, so a retry sends exactly what was attached. */
  const failedFilesRef = useRef<Map<string, StagedAttachment[]>>(new Map());
  const messages: ChatMessage[] = useMemo(
    () => withFailedSends(messagesQuery.data ?? [], failedSends, conversationId),
    [messagesQuery.data, failedSends, conversationId],
  );
  const lastOwnMessageId: string | null = useMemo(
    () => (userId ? lastOutgoingId(messages, userId) : null),
    [messages, userId],
  );

  const newestMessage: ChatMessage | null = messages.length > 0 ? messages[messages.length - 1] : null;

  /**
   * The group this visit came from, when the thread was opened from a group's member list.
   *
   * Only meaningful in a 1-1: a pair keeps one conversation wherever they open it from, so
   * what ties a message to a room is the message itself. Null everywhere else, which is what
   * makes an ordinary message ordinary.
   */
  const originGroupId: string | null =
    activeKind === "direct" ? searchParams.get(ORIGIN_GROUP_PARAM) : null;

  // Arriving from "Xem trong ngữ cảnh": which task sent us here, and what it remembers.
  const highlightTaskId: string | null = searchParams.get(CONTEXT_TASK_PARAM);
  const { data: allTasks } = useTasks();
  const { data: suggestions } = useTaskSuggestions();
  const highlightTask = useMemo(
    () => (allTasks ?? []).find((task) => task.id === highlightTaskId) ?? null,
    [allTasks, highlightTaskId],
  );
  /*
   * The quoted message only lives in the chat it was sent in. Project work agreed in the parent
   * group opens in the project's sub-group, where that message was never meant to be — so there
   * it is neither scrolled to nor reported as deleted.
   */
  const rawHighlightSnapshot = highlightTask?.contextSnapshot ?? null;
  const highlightSnapshot =
    rawHighlightSnapshot !== null &&
    conversationId !== undefined &&
    rawHighlightSnapshot.conversationId === conversationId
      ? rawHighlightSnapshot
      : null;
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const isQuotedMessageGone: boolean =
    highlightSnapshot !== null &&
    !messagesQuery.isPending &&
    isOriginalMessageMissing(highlightSnapshot, messageIds);
  const quotedMessageId: string | null = isQuotedMessageGone
    ? null
    : (highlightSnapshot?.originalMessageId ?? null);

  /**
   * Declines made without a word, placed where they happened.
   *
   * Derived from the tasks rather than stored as messages, because a silent decline creates
   * no message — that is the whole point of it. The thread shows a quiet annotation so the
   * other person can see the request was answered, without the app putting words in anyone's
   * mouth.
   */
  const silentSkipsByMessage = useMemo(() => {
    if (!conversationId) return new Map<string, ReturnType<typeof silentSkipNotices>>();
    // Two sources, one line: declines of a suggestion (the current path) and declines of a
    // shared task raised before suggestions were split out. Both are the same event to a
    // reader, so they render identically rather than as two kinds of annotation.
    const fromSuggestions = silentlySkippedInConversation(
      suggestions ?? [],
      conversationId,
    ).map((entry) => ({ taskId: entry.id, assigneeId: entry.assigneeId, at: entry.at }));
    const merged = [...silentSkipNotices(allTasks ?? [], conversationId), ...fromSuggestions].sort(
      (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0),
    );
    return placeSilentSkipNotices(merged, messages);
  }, [allTasks, suggestions, conversationId, messages]);

  /** Who declined, named — in a 1-1 that is the person the thread is with. */
  const skipActorName = useCallback(
    (assigneeId: string | null): string => {
      if (assigneeId === null) return threadTitle;
      if (assigneeId === userId) return "Bạn";
      if (activeKind === "group") return senderNames.get(assigneeId) ?? "Thành viên";
      return threadTitle;
    },
    [userId, activeKind, senderNames, threadTitle],
  );

  /** Who said a given message, named the way the task archive should remember it. */
  const senderNameOf = useCallback(
    (message: ChatMessage | null): string => {
      if (message === null) return "";
      if (message.senderId === userId) return "Bạn";
      if (activeKind === "group") return senderNames.get(message.senderId) ?? "Thành viên";
      return threadTitle;
    },
    [userId, activeKind, senderNames, threadTitle],
  );

  /**
   * Reactions for the whole thread, and the one action that changes them.
   *
   * A journal has nobody to react to you, so it keeps none of this.
   */
  const { groupsFor: reactionGroupsFor, toggle: toggleReaction } = useThreadReactions(
    activeKind === "personal" ? undefined : conversationId,
    messageIds,
  );

  /**
   * Which messages in this thread already produced work.
   *
   * Read in one batch beside the reactions, and for the same reason. A journal is left out:
   * it has nobody to suggest anything to, so it can hold none of these.
   */
  const { markFor: taskMarkFor } = useMessageTasks(
    activeKind === "personal" ? undefined : conversationId,
    messageIds,
  );

  /**
   * Pressing the dot opens the thing itself, not a description of it.
   *
   * Work that exists goes through the same context parameter "Xem trong ngụ cảnh" uses, so the
   * task panel opens and points at the row. Work still waiting on an answer has no task to
   * open, so the suggestion panel is unfolded onto it instead.
   */
  const openTaskMark = useCallback(
    (mark: MessageTaskSummary): void => {
      if (mark.taskId !== null) {
        setFocusedSuggestionId(null);
        const next = new URLSearchParams(searchParams);
        next.set(CONTEXT_TASK_PARAM, mark.taskId);
        setSearchParams(next, { replace: true });
        return;
      }
      setFocusedSuggestionId(mark.suggestionId);
    },
    [searchParams, setSearchParams],
  );

  /**
   * Anything the room finished while this person was away plays now, once.
   *
   * A journal is excluded: it has no shared work in it, so it can hold no celebration that
   * somebody else earned.
   */
  useThreadCelebrations(activeKind === "personal" ? undefined : conversationId);

  /**
   * Typing and presence, both carried by the socket and stored nowhere.
   *
   * The person's own preference only gates what they SEND: switching it off stops their
   * signal going out and still lets them see everyone else's, because a privacy choice that
   * also blinds you is a punishment, and people would leave it on for the wrong reason.
   */
  const { data: profileSettings } = useProfileSettings();
  const sendsTypingSignal = profileSettings?.hideTypingSignal !== true;
  const { typingUserIds, onlineUserIds, notifyTyping, clearTyping } = useThreadPresence(
    activeKind === "personal" ? undefined : conversationId,
    sendsTypingSignal,
  );

  /** Who is typing, named. A 1-1 has only one candidate, so the thread title is the name. */
  const typingLine: string | null = useMemo(
    () =>
      typingText(typingUserIds, (id) =>
        activeKind === "group" ? (senderNames.get(id) ?? "Thành viên") : threadTitle,
      ),
    [typingUserIds, activeKind, senderNames, threadTitle],
  );

  /** In a 1-1, "anyone else here" is the peer — which is what the green dot means. */
  const isPeerOnline: boolean = activeKind === "direct" && onlineUserIds.length > 0;

  /**
   * Who can be named here.
   *
   * Groups only: a 1-1 has exactly one other person, so naming them adds nothing the message
   * did not already say, and a journal has nobody to name.
   */
  const mentionable = useMemo(
    () =>
      activeKind === "group" ? buildMentionCandidates(groupMembersQuery.data ?? [], userId) : [],
    [activeKind, groupMembersQuery.data, userId],
  );

  /** This viewer's seat in the room, which decides whether they may pin for everyone. */
  const myGroupRole = useMemo(
    () => (groupMembersQuery.data ?? []).find((member) => member.userId === userId)?.role,
    [groupMembersQuery.data, userId],
  );

  const {
    ordered: orderedPinList,
    pinOf,
    isFull: isPinQuotaFull,
    pin: addPin,
    unpin: removePin,
    isWorking: isPinning,
  } = useThreadPins(conversationId);

  /**
   * Open "please take that back" asks in this thread.
   *
   * RLS narrows this to the asks each person is party to, so the sender sees what was asked of
   * them and an asker sees their own — nobody can read the room for who objected to whom.
   */
  const {
    askedBy: recallAsksFor,
    hasAskedFor: hasAskedRecall,
    ask: askRecall,
    resolve: resolveRecallAsk,
  } = useRecallRequests(conversationId);

  /** The files already in this thread, and the short-lived links that render them. */
  const {
    attachments: threadAttachments,
    attachmentsOf,
    urlOf: attachmentUrlOf,
    isLoading: isAttachmentsLoading,
  } = useThreadAttachments(conversationId);

  /*
   * Diary reads three ways: the written timeline, its files, and the tasks made from pasted
   * content. All three are the same journal — nothing moves between them.
   */
  // Which reading is open lives in the address (`?xem=`), so a phone's back step returns to the
  // three-row Diary list and a reload stays on the same view. No slug reads as the journal.
  const isWide: boolean = useMediaQuery("(min-width: 768px)");
  const diaryParam: DiaryView | null = diaryViewFromSlug(searchParams.get(DIARY_VIEW_PARAM));
  // AVORA-44 · quyết định 1: no view in the address opens the one used last on this device.
  const [lastDiaryView] = useState<DiaryView>(() => readLastDiaryView());
  const diaryView: DiaryView = diaryParam ?? (highlightTaskId !== null ? "journal" : lastDiaryView);
  const diaryViewLabel: string = DIARY_VIEWS.find((view) => view.id === diaryView)?.label ?? "Nhật ký của tôi";
  useEffect(() => {
    if (activeKind === "personal" && diaryParam !== null) rememberDiaryView(diaryParam);
  }, [activeKind, diaryParam]);
  /**
   * Phone: the journal is open but no reading has been chosen, so the three-row Diary list is the
   * screen. "Xem trong ngữ cảnh" names a task instead and goes straight to the written timeline.
   */
  // The three-row list is gone on a phone (30/09): the count row switches views instead.
  const isDiaryListScreen = false as boolean;
  const location = useLocation();
  const leaveDiaryView = useCallback((): void => {
    if (conversationId === undefined) return;
    const state = location.state as { fromDiaryList?: boolean } | null;
    if (state?.fromDiaryList === true) navigate(-1);
    else navigate(`/tin-nhan/${conversationId}`, { replace: true });
  }, [conversationId, location.state, navigate]);
  const openDiaryView = useCallback(
    (view: DiaryView): void => {
      if (conversationId === undefined) return;
      navigate(`/tin-nhan/${conversationId}?${DIARY_VIEW_PARAM}=${diaryViewSlug(view)}`, { replace: true });
    },
    [conversationId, navigate],
  );
  /** AVORA-49 · 2.1: ghim · dự án · gợi ý · việc · hẹn giờ as one chip row above the thread. */
  const chipTasks = useChatThreadTasks(conversationId ?? "", highlightTaskId, activeKind === "group" ? "mine" : "all");
  const chipSuggestions = useChatSuggestions(conversationId ?? "");
  const waitingScheduledCount: number = canSchedule ? waitingScheduled(scheduledQuery.data ?? []).length : 0;
  const threadChips: ThreadChip[] = useMemo(() => {
    const chips: ThreadChip[] = [];
    if (orderedPinList.length > 0) chips.push({ id: "pins", label: `${orderedPinList.length} ghim`, count: orderedPinList.length });
    if (projectHere !== undefined) {
      chips.push({
        id: "project",
        label: `Dự án ${projectHere.title}${isProjectChatClosed ? " · đã đóng" : ""}`,
        to: withReturn(projectLink(projectHere.id), hereFrom(location, threadTitle)),
      });
    }
    if (activeKind !== "personal") {
      const suggestionCount = chipSuggestions.pending.length + chipSuggestions.accepted.length;
      if (suggestionCount > 0) {
        chips.push({
          id: "suggestions",
          label: chipSuggestions.pending.length > 0 ? `${chipSuggestions.pending.length} gợi ý` : `${chipSuggestions.accepted.length} gợi ý đã nhận`,
          count: suggestionCount,
          needsMe: chipSuggestions.awaitingMe,
        });
      }
      if (chipTasks.threadTasks.length > 0) {
        const count = chipTasks.openCount > 0 ? chipTasks.openCount : chipTasks.threadTasks.length;
        chips.push({
          id: "tasks",
          label: activeKind === "group" ? `Việc của bạn ở đây (${count})` : `${count} việc`,
          count,
          needsMe: chipTasks.wantsAttention,
        });
      }
    }
    if (waitingScheduledCount > 0) chips.push({ id: "scheduled", label: `${waitingScheduledCount} hẹn giờ`, count: waitingScheduledCount });
    return chips;
  }, [orderedPinList.length, projectHere, isProjectChatClosed, location, threadTitle, activeKind, chipSuggestions, chipTasks, waitingScheduledCount]);
  // Sent here to look at one task or one suggestion: that chip opens; otherwise every thread opens closed.
  useEffect(() => {
    if (highlightTaskId !== null) setOpenChip("tasks");
    else if (focusedSuggestionId !== null) setOpenChip("suggestions");
    else setOpenChip(null);
  }, [conversationId, highlightTaskId, focusedSuggestionId]);
  useEffect(() => setIsLiveNoticeHidden(false), [isLive]);
  const journalTrashCount: number | null = useJournalTrashCount(conversationId, activeKind === "personal" && isInfoOpen);
  const isDiaryAside: boolean = activeKind === "personal" && diaryView !== "journal";
  /** 44b · B: Ghi chép on a computer folds the Kết nối list away; `‹ Nhật ký` brings it back. */
  const isWritingSpace: boolean = isWide && isDiaryAside && diaryView === "notes";
  const [notesRequest, setNotesRequest] = useState<{ noteId?: string; book?: { recordId: string; title: string } } | null>(null);
  const clearNotesRequest = useCallback((): void => setNotesRequest(null), []);
  const [noteTaskExit, setNoteTaskExit] = useState<TaskExit | null>(null);
  const [noteBoardExit, setNoteBoardExit] = useState<BoardExit | null>(null);
  const openWriting = useCallback(
    (noteId: string): void => {
      setNotesRequest({ noteId });
      openDiaryView("notes");
    },
    [openDiaryView],
  );
  // Kệ sách › Ghi chép (C): ?ghi-chep=<id> opens a note, ?sach=<id>&ten=<title> starts one.
  useEffect(() => {
    if (activeKind !== "personal") return;
    const noteParam = searchParams.get("ghi-chep");
    const bookParam = searchParams.get("sach");
    if (noteParam !== null) setNotesRequest({ noteId: noteParam });
    else if (bookParam !== null) setNotesRequest({ book: { recordId: bookParam, title: searchParams.get("ten") ?? "Sách" } });
    else return;
    if (conversationId !== undefined) navigate(`/tin-nhan/${conversationId}?${DIARY_VIEW_PARAM}=${diaryViewSlug("notes")}`, { replace: true });
  }, [activeKind, searchParams, conversationId, navigate]);
  /**
   * Nguồn tạo việc: my tasks that came from Nhật ký — pasted in, or raised from an entry (its
   * `original_message_id` points at a journal row). Worked out on read; no column says so.
   */
  const journalConversationId: string | null = journalSummary?.conversationId ?? null;
  const pasteTasks = useMemo(() => {
    const pasted = pasteSourceTasks(allTasks ?? [], userId);
    if (journalConversationId === null || userId === undefined) return pasted;
    const seen = new Set<string>(pasted.map((task) => task.id));
    const fromEntries = (allTasks ?? []).filter(
      (task) =>
        !seen.has(task.id) &&
        task.creatorId === userId &&
        !isDeletedFor(task, userId) &&
        task.contextSnapshot?.conversationId === journalConversationId &&
        (task.contextSnapshot?.originalMessageId ?? null) !== null,
    );
    return [...pasted, ...fromEntries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [allTasks, userId, journalConversationId]);
  /** Entries a task of mine points back at: their place is Nguồn tạo việc (A.3 row 1). */
  const taskMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of pasteTasks) {
      const snapshot = task.contextSnapshot;
      if (snapshot?.conversationId !== journalConversationId) continue;
      for (const id of snapshot?.selectedMessageIds ?? [snapshot?.originalMessageId ?? null]) if (id !== null) ids.add(id);
    }
    return ids;
  }, [pasteTasks, journalConversationId]);
  const [showAllTimeline, setShowAllTimeline] = useState<boolean>(false);
  const notesData = useNotes({ enabled: activeTab === "journal" || activeKind === "personal" });
  // The Diary list shows its counts before the journal is opened, so the journal's files are read
  // on their own (same cache key as the open thread, no signed links needed just to count).
  const journalAttachmentsQuery = useQuery<MessageAttachment[], Error>({
    queryKey: attachmentKeys.thread(journalSummary?.conversationId ?? ""),
    queryFn: () => fetchThreadAttachments(journalSummary?.conversationId as string),
    enabled: activeTab === "journal" && journalSummary !== undefined,
    staleTime: 30_000,
  });
  /**
   * Meeting notes saved with "Lưu vào Nhật ký" are ordinary Diary notes; File của bạn lists them
   * with the source "Từ Sổ quyết định". Counted on their own so the Diary list shows the number
   * before the journal is opened.
   */
  const savedMeetingCountQuery = useQuery<number, Error>({
    queryKey: meetingNoteKeys.savedToJournalCount(journalSummary?.conversationId ?? ""),
    queryFn: () => countSavedMeetingNotes(journalSummary?.conversationId as string),
    enabled: activeTab === "journal" && journalSummary !== undefined,
    staleTime: 30_000,
  });
  const savedMeetingNotes: (SavedMeetingNote & { messageId: string; createdAt: string })[] = useMemo(() => {
    if (activeKind !== "personal") return [];
    const found: (SavedMeetingNote & { messageId: string; createdAt: string })[] = [];
    for (const message of messages) {
      if (message.deletedAt != null || message.systemKind != null || message.senderId !== userId) continue;
      const parsed = parseSavedMeetingNote(message.content);
      if (parsed !== null) found.push({ ...parsed, messageId: message.id, createdAt: message.createdAt });
    }
    return found.reverse();
  }, [activeKind, messages, userId]);
  const pastedNoteIds = useMemo(
    () =>
      new Set<string>(
        pasteSourceTasks(allTasks ?? [], userId)
          .map((task) => task.contextSnapshot?.originalMessageId ?? null)
          .filter((id): id is string => id !== null),
      ),
    [allTasks, userId],
  );
  const journalAttachments: MessageAttachment[] = useMemo(
    () => (activeKind === "personal" ? threadAttachments : (journalAttachmentsQuery.data ?? [])),
    [activeKind, threadAttachments, journalAttachmentsQuery.data],
  );
  const diaryFiles: DiaryFileNote[] = useMemo(
    () => (activeKind === "personal" ? diaryFileNotes(threadAttachments, messages, pastedNoteIds, taskMessageIds) : []),
    [activeKind, threadAttachments, messages, pastedNoteIds, taskMessageIds],
  );
  const journalFilesOf = useCallback(
    (messageId: string) => journalAttachments.filter((item) => item.messageId === messageId),
    [journalAttachments],
  );
  /** Every link in the journal page on screen and in every Ghi chép (A.4). */
  const diaryLinkRows: DiaryLink[] = useMemo(() => {
    const entries =
      activeKind === "personal"
        ? messages
            .filter((message) => message.deletedAt == null && message.systemKind == null && message.pending !== true)
            .map((message) => ({
              id: message.id,
              content: message.content,
              createdAt: message.createdAt,
              place: diaryPrimaryPlace({ content: message.content, attachments: journalFilesOf(message.id), hasTask: taskMessageIds.has(message.id) }),
            }))
        : [];
    const noteRows = notesData.liveNotes.map((note) => ({
      id: note.id,
      title: note.title.trim() === "" ? (note.blocks.find((block) => block.text.trim() !== "")?.text.trim() ?? "Ghi chép") : note.title,
      text: note.blocks.map((block) => block.text).join("\n"),
      updatedAt: note.updatedAt,
    }));
    return diaryLinks(entries, noteRows);
  }, [activeKind, messages, journalFilesOf, taskMessageIds, notesData.liveNotes]);
  const noteFileRows = useMemo(() => {
    const titleOf = new Map(notesData.liveNotes.map((note) => [note.id, note.title.trim() === "" ? "Ghi chép" : note.title] as const));
    return (notesData.attachments.data ?? [])
      .filter((item) => titleOf.has(item.noteId))
      .map((item) => ({ id: item.id, noteId: item.noteId, noteTitle: titleOf.get(item.noteId) as string, attachment: toAttachmentView(item), createdAt: item.createdAt }));
  }, [notesData.liveNotes, notesData.attachments.data]);
  /** The written timeline: only entries whose place is Nhật ký, unless "Hiện tất cả" is on. */
  const timelineMessages: ChatMessage[] = useMemo(() => {
    if (activeKind !== "personal") return messages;
    const keep = new Set<string>(quotedMessageId === null ? [] : [quotedMessageId]);
    return journalTimeline(messages, attachmentsOf, keep, taskMessageIds, showAllTimeline);
  }, [activeKind, messages, attachmentsOf, quotedMessageId, taskMessageIds, showAllTimeline]);
  const journalTimelineCount: number | null = activeKind === "personal"
    ? journalTimeline(messages, attachmentsOf, new Set<string>(), taskMessageIds, false).filter((message) => message.systemKind == null).length
    : null;
  const diaryCounts = useMemo(
    () => ({
      journal: journalTimelineCount,
      notes: notesData.notes.data === undefined ? null : notesData.liveNotes.length,
      files:
        new Set(journalAttachments.filter((item) => !(item.kind === "voice" && item.originMessageId === null)).map((item) => item.messageId)).size +
        (activeKind === "personal" ? savedMeetingNotes.length : (savedMeetingCountQuery.data ?? 0)) +
        noteFileRows.length,
      links: activeKind === "personal" ? diaryLinkRows.length : null,
      sources: pasteTasks.length,
    }),
    [journalTimelineCount, notesData.notes.data, notesData.liveNotes.length, journalAttachments, activeKind, savedMeetingNotes.length, savedMeetingCountQuery.data, noteFileRows.length, diaryLinkRows.length, pasteTasks.length],
  );
  /** The • : something new in a view since it was last opened on this device. */
  const diaryLatest = useMemo(
    () => ({
      journal: latestOf(timelineMessages.filter((message) => message.senderId !== "").map((message) => message.createdAt)),
      notes: latestOf(notesData.liveNotes.map((note) => note.createdAt)),
      files: latestOf([...diaryFiles.map((entry) => entry.createdAt), ...noteFileRows.map((row) => row.createdAt)]),
      links: latestOf(diaryLinkRows.map((row) => row.createdAt)),
      sources: latestOf(pasteTasks.map((task) => task.createdAt)),
    }),
    [timelineMessages, notesData.liveNotes, diaryFiles, noteFileRows, diaryLinkRows, pasteTasks],
  );
  const [seenTick, setSeenTick] = useState<number>(0);
  useEffect(() => {
    if (activeKind !== "personal") return;
    const latest = diaryLatest[diaryView];
    markDiarySeen(diaryView, latest ?? new Date().toISOString());
    setSeenTick((tick) => tick + 1);
  }, [activeKind, diaryView, diaryLatest]);
  const diaryDots = useMemo(() => {
    void seenTick;
    const out: Partial<Record<DiaryView, boolean>> = {};
    for (const view of DIARY_VIEWS) out[view.id] = hasNewSince(diaryLatest[view.id], readDiarySeen(view.id));
    return out;
  }, [diaryLatest, seenTick]);
  const dayGroups = useMemo(() => groupMessagesByDay(timelineMessages), [timelineMessages]);

  // One paste flow for Kết nối and the corner bubble (AVORA-35 / F).
  const { start: startPaste, isReading: isReadingClipboard, dialog: pasteDialog } = usePasteTask();
  const [openedSourceTaskId, setOpenedSourceTaskId] = useState<string | null>(null);
  const openedSourceTask = useMemo(
    () => (allTasks ?? []).find((task) => task.id === openedSourceTaskId) ?? null,
    [allTasks, openedSourceTaskId],
  );


  /*
   * The one recorder of the app (AVORA-44): a voice note keeps recording while the person looks
   * elsewhere. In a chat it is still cancelled on leaving the thread (it belongs to that room); in
   * Nhật ký it continues, and if the journal is no longer open when it stops, it is saved straight
   * into the journal as a spoken thought.
   */
  const globalRecorder = useRecorder();
  const recordingKey = `thread:${conversationId ?? ""}`;
  const recorder = {
    isRecording: globalRecorder.isRecording && globalRecorder.ownerKey === recordingKey,
    elapsedSeconds: globalRecorder.elapsedSeconds,
    isUnsupported: !isRecordingSupported() || (globalRecorder.isRecording && globalRecorder.ownerKey !== recordingKey),
    cancel: cancelRecording,
  };
  const openThreadRef = useRef<string | undefined>(conversationId);
  openThreadRef.current = conversationId;

  /**
   * Takes files from the picker into the composer.
   *
   * Each one is reported on its own: three photos where one is too large should attach two
   * and say why the third did not, rather than refusing all three.
   */
  const stageFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      if (files.length === 0) return;
      const room = MAX_ATTACHMENTS_PER_MESSAGE - staged.length;
      if (room <= 0) {
        toast.error(`Mỗi tin nhắn chỉ gửi được tối đa ${MAX_ATTACHMENTS_PER_MESSAGE} tệp.`);
        return;
      }
      if (files.length > room) {
        toast.error(`Chỉ thêm được ${room} tệp nữa cho tin nhắn này.`);
      }

      for (const file of files.slice(0, room)) {
        try {
          const item = await stageAttachment(file);
          setStaged((current) => [...current, item]);
        } catch (error: unknown) {
          toast.error(error instanceof Error ? error.message : "Không đính kèm được tệp này.");
        }
      }
    },
    [staged.length],
  );

  /*
   * Dropping files on the thread (Đợt gộp 2 · A10, computer): the very same path as the picker —
   * same limits, same permission choice. Never in a "Chờ kết bạn" frame (text only).
   */
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const canDropFiles: boolean = activeVerification === null && !isNoLongerConnected && !hasBlockedPeer;
  const dragDepthRef = useRef<number>(0);
  const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer.types).includes("Files");
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);
  const handleDragLeave = useCallback((): void => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);
  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      void stageFiles(Array.from(event.dataTransfer.files));
    },
    [stageFiles],
  );

  const removeStaged = useCallback((localId: string): void => {
    setStaged((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target?.previewUrl != null) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }, []);

  const setStagedPermission = useCallback(
    (localId: string, permission: AttachmentPermission): void => {
      setStaged((current) =>
        current.map((item) => (item.localId === localId ? { ...item, permission } : item)),
      );
    },
    [],
  );

  const startRecording = useCallback((): void => {
    const threadId = conversationId;
    if (threadId === undefined) return;
    const isJournal = activeKind === "personal";
    void startGlobalRecording({
      target: "message",
      ownerKey: `thread:${threadId}`,
      returnTo: `/tin-nhan/${threadId}`,
      done: (result) => {
        const extension = result.blob.type.includes("mp4") ? "m4a" : "webm";
        const file = new File([result.blob], `tin-nhan-thoai.${extension}`, { type: result.blob.type });
        void stageAttachment(file, { isRecording: true, durationSeconds: result.durationSeconds })
          .then(async (item) => {
            if (openThreadRef.current === threadId) {
              setStaged((current) => [...current, item]);
              return;
            }
            if (!isJournal) return;
            const uploaded = await uploadStagedAttachment(threadId, item);
            await sendMessageWithAttachments({ conversationId: threadId, content: "", attachments: [uploaded] });
            void queryClient.invalidateQueries({ queryKey: chatKeys.messages(threadId) });
            void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(threadId) });
            toast.success("Đã lưu bản ghi âm vào Nhật ký.");
          })
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không lưu được bản ghi."));
      },
    }).catch((error: unknown) => {
      toast.error(error instanceof Error && error.message.startsWith("Đang có") ? error.message : "Không dùng được micro. Kiểm tra quyền truy cập trong trình duyệt.");
    });
  }, [conversationId, activeKind, queryClient]);

  const stopRecording = useCallback((): void => {
    stopGlobalRecording();
  }, []);

  /**
   * Leaving a thread abandons whatever was staged in it.
   *
   * A file chosen for one conversation must never arrive in another, and a half-finished
   * recording has no business surviving the screen it was started on.
   */
  useEffect(() => {
    const leavingKind = activeKind;
    const leavingKey = recordingKey;
    return () => {
      // A chat's voice note belongs to that room; a journal's keeps going (it saves itself).
      const now = getRecorderStateSafe();
      if (leavingKind !== "personal" && now.isRecording && now.ownerKey === leavingKey) cancelRecording();
      setStaged((current) => {
        current.forEach((item) => {
          if (item.previewUrl !== null) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /*
   * Switching threads starts clean (A8): no reply quote, no picking, no half-made edit carried
   * across. The draft itself is per-thread and comes back on its own.
   */
  useEffect(() => {
    setReplyTarget(null);
    setIsSelecting(false);
    setSelectedIds([]);
    setEditingMessageId(null);
    setEditDraft("");
    setTaskSelection(null);
  }, [conversationId]);

  /** The message awaiting a "for the room, or for me?" answer. */
  const [pinChoiceMessageId, setPinChoiceMessageId] = useState<string | null>(null);

  /** The two doors into the same dialog: a chosen bubble, or the end of the thread. */
  const taskContextMessage: ChatMessage | null = taskSourceMessage ?? newestMessage;

  const openTaskDialogFor = useCallback((message: ChatMessage | null): void => {
    setTaskSourceMessage(message);
    setIsTaskDialogOpen(true);
  }, []);

  const scrollThreadToBottom = useCallback((behavior: ScrollBehavior): void => {
    const node = threadScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  // The thread remounts when the journal view comes back, so it opens at its newest note again.
  const previousDiaryViewRef = useRef<DiaryView>(diaryView);
  useEffect(() => {
    const previous = previousDiaryViewRef.current;
    previousDiaryViewRef.current = diaryView;
    if (previous !== "journal" && diaryView === "journal") {
      window.requestAnimationFrame(() => scrollThreadToBottom("auto"));
    }
  }, [diaryView, scrollThreadToBottom]);

  /**
   * One page further back (A7). Merged in front of what is already shown, and the reader stays on
   * the same line: the scroll offset is moved by exactly the height the new page added.
   */
  const loadOlder = useCallback(async (): Promise<void> => {
    if (!conversationId || isLoadingOlder || reachedStart[conversationId] === true) return;
    const loaded = queryClient.getQueryData<ChatMessage[]>(chatKeys.messages(conversationId)) ?? [];
    const oldest = loaded.find((message) => message.pending !== true);
    if (oldest === undefined) return;
    const node = threadScrollRef.current;
    if (node !== null) scrollAnchorRef.current = { height: node.scrollHeight, top: node.scrollTop };
    setIsLoadingOlder(true);
    try {
      const older = await fetchOlderMessages(conversationId, oldest.createdAt);
      if (older.length < MESSAGE_PAGE_SIZE) setReachedStart((current) => ({ ...current, [conversationId]: true }));
      if (older.length === 0) {
        scrollAnchorRef.current = null;
        return;
      }
      windowSinceRef.current.set(conversationId, older[0].createdAt);
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(conversationId), (current) => {
        const known = new Set((current ?? []).map((message) => message.id));
        return [...older.filter((message) => !known.has(message.id)), ...(current ?? [])];
      });
    } catch (error) {
      scrollAnchorRef.current = null;
      logError("chat", error);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversationId, isLoadingOlder, reachedStart, queryClient]);

  const placeTimerRef = useRef<number | null>(null);
  const handleThreadScroll = useCallback((): void => {
    const node = threadScrollRef.current;
    if (!node) return;
    // Close to the oldest message on screen: fetch the page before it.
    if (node.scrollTop < 240) void loadOlder();
    const nearBottom = isNearThreadBottom({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    });
    setIsThreadAtBottom(nearBottom);
    // Reaching the end reads whatever was waiting there, so the pill has nothing left to say.
    if (nearBottom) setMissedMessages(0);
    // AVORA-49 · 3.1: where the reader is, kept after the scroll settles.
    if (placeTimerRef.current !== null) window.clearTimeout(placeTimerRef.current);
    const threadId = conversationId;
    placeTimerRef.current = window.setTimeout(() => {
      if (threadId === undefined || threadScrollRef.current !== node) return;
      const seen = firstVisibleMessage(node);
      if (seen !== null) rememberThreadPlace(threadId, { ...seen, atBottom: nearBottom });
    }, 180);
  }, [loadOlder, conversationId]);

  const jumpToNewest = useCallback((): void => {
    scrollThreadToBottom("smooth");
    setMissedMessages(0);
    setIsThreadAtBottom(true);
  }, [scrollThreadToBottom]);

  /**
   * Takes a search result to its place in the thread.
   *
   * The highlight is temporary on purpose: it exists to answer "which one of these is it?"
   * for the second after the scroll lands, and a permanent mark would still be sitting there
   * an hour later claiming to be the answer to a question nobody is asking any more.
   */
  const flashAt = useCallback((messageId: string): boolean => {
    const node = document.getElementById(`message-${messageId}`);
    if (node === null) return false;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashedMessageId(messageId);
    window.setTimeout(
      () => setFlashedMessageId((current) => (current === messageId ? null : current)),
      2_000,
    );
    return true;
  }, []);

  /**
   * A message not loaded yet (a quote, a search result, `?tin=`): widen the window back to it,
   * which keeps everything from there to the newest message joined up, then light it (A7).
   */
  const revealMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!conversationId) return false;
      try {
        const at = await fetchMessageTime(messageId);
        if (at === null) {
          setMissingMessageIds((current) => new Set(current).add(messageId));
          return false;
        }
        const current = windowSinceRef.current.get(conversationId);
        if (current === undefined || at < current) windowSinceRef.current.set(conversationId, at);
        await queryClient.refetchQueries({ queryKey: chatKeys.messages(conversationId), exact: true });
        return true;
      } catch (error) {
        logError("chat", error);
        return false;
      }
    },
    [conversationId, queryClient],
  );

  const jumpToMessage = useCallback(
    (messageId: string): void => {
      if (flashAt(messageId)) return;
      void revealMessage(messageId).then((found) => {
        if (found) window.requestAnimationFrame(() => window.setTimeout(() => flashAt(messageId), 60));
      });
    },
    [flashAt, revealMessage],
  );

  /*
   * The "Tin chưa đọc" line (A9): worked out once when a thread opens, from the reader's own
   * unread count, and kept still while they read. Reopening the thread works it out again.
   * Nothing about it is sent anywhere (ADR-028).
   */
  const unreadMarker = useRef<{ conversationId: string | null; id: string | null }>({ conversationId: null, id: null });
  if (
    conversationId !== undefined &&
    unreadMarker.current.conversationId !== conversationId &&
    messagesQuery.data !== undefined &&
    activeSummary !== undefined
  ) {
    unreadMarker.current = {
      conversationId,
      id: firstUnreadByCount(messagesQuery.data, userId, activeSummary.unreadCount),
    };
  }
  const unreadMarkerId: string | null =
    unreadMarker.current.conversationId === conversationId ? unreadMarker.current.id : null;

  // After an older page lands above, keep the reader on the same line (no jump).
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    const node = threadScrollRef.current;
    if (anchor === null || node === null) return;
    scrollAnchorRef.current = null;
    node.scrollTop = anchor.top + (node.scrollHeight - anchor.height);
  }, [messages]);

  /** The thread position already accounted for, so one arrival is followed exactly once. */
  const scrollSeenRef = useRef<{ conversationId: string | null; messageId: string | null }>({
    conversationId: null,
    messageId: null,
  });

  useEffect(() => {
    const node = threadScrollRef.current;
    if (!node) return;

    const seen = scrollSeenRef.current;
    const nextConversationId = conversationId ?? null;
    const nextMessageId = newestMessage?.id ?? null;
    const conversationChanged = seen.conversationId !== nextConversationId;
    if (!conversationChanged && seen.messageId === nextMessageId) return;

    // A thread the viewer switched away from and back to starts fresh at its end.
    const firstPaint = conversationChanged ? true : seen.messageId === null;
    scrollSeenRef.current = { conversationId: nextConversationId, messageId: nextMessageId };

    const decision = threadScrollDecision({
      conversationChanged,
      firstPaint,
      sentByViewer: newestMessage !== null && newestMessage.senderId === userId,
      nearBottom: isNearThreadBottom({
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }),
    });

    if (decision === "stay") {
      setMissedMessages((count) => count + 1);
      setIsThreadAtBottom(false);
      return;
    }
    // AVORA-49 · 3.1: back from a Bảng / Dự án → the same line, unless I just sent something.
    if (firstPaint && nextConversationId !== null && !(newestMessage !== null && newestMessage.senderId === userId && newestMessage.pending === true)) {
      const place = readThreadPlace(nextConversationId);
      const anchorNode = place === null || place.atBottom ? null : document.getElementById(`message-${place.messageId}`);
      if (place !== null && anchorNode !== null) {
        const delta = anchorNode.getBoundingClientRect().top - node.getBoundingClientRect().top - place.offset;
        node.scrollTop += delta;
        setIsThreadAtBottom(false);
        return;
      }
      if (place !== null && !place.atBottom) forgetThreadPlace(nextConversationId);
    }
    // Opening a thread with unread messages lands on "Tin chưa đọc", not the end (A9).
    if (firstPaint && unreadMarker.current.id !== null && unreadMarker.current.conversationId === nextConversationId) {
      const markerNode = document.getElementById("unread-marker");
      if (markerNode !== null) {
        markerNode.scrollIntoView({ block: "start" });
        setIsThreadAtBottom(false);
        return;
      }
    }
    scrollThreadToBottom(decision === "jump" ? "auto" : "smooth");
    setMissedMessages(0);
    setIsThreadAtBottom(true);
  }, [conversationId, newestMessage, userId, scrollThreadToBottom]);

  // Tell the realtime layer which thread is genuinely on screen, so messages arriving
  // for it are never counted as unread. A hidden tab is not reading.
  useEffect(() => {
    setReadingConversation(isTabVisible ? (conversationId ?? null) : null);
    return () => setReadingConversation(null);
  }, [conversationId, isTabVisible, setReadingConversation]);

  const markedRef = useRef<Record<string, string>>({});

  const { mutate: markRead } = useMutation({
    mutationFn: (id: string) => markConversationRead(id),
    // Read here → its notification on this device goes away (same tag, AVORA-46 · D).
    onSuccess: (_data: string | null, id: string) => void closeNotificationsFor(id),
    onError: (error: Error, id: string) => {
      // Allow a later attempt; the badge comes back from the server.
      delete markedRef.current[id];
      logError("chat", error);
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });

  /**
   * Newest stored message from the peer — the only kind that can ever be unread.
   * Keying on this means replying does not fire a redundant mark-read round trip.
   */
  const newestPeerMessageAt: string | null = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.pending !== true && message.senderId !== userId) return message.createdAt;
    }
    return null;
  }, [messages, userId]);

  useEffect(() => {
    if (!conversationId || !userId || !isTabVisible || newestPeerMessageAt === null) return;
    // One call per newly seen message, not one per render.
    if (markedRef.current[conversationId] === newestPeerMessageAt) return;
    markedRef.current[conversationId] = newestPeerMessageAt;

    const inbox = queryClient.getQueryData<ConversationSummary[]>(chatKeys.conversations);
    if (inbox) {
      queryClient.setQueryData<ConversationSummary[]>(chatKeys.conversations, clearUnread(inbox, conversationId));
    }
    markRead(conversationId);
  }, [conversationId, userId, isTabVisible, newestPeerMessageAt, queryClient, markRead]);

  /**
   * One send, described completely up front — words, quote, files — so a failed one can be sent
   * again exactly as it was, whatever the composer holds by then. `retryOf` names the failed
   * bubble being retried; it keeps its place and simply reads "Đang gửi…" again.
   */
  type SendPayload = {
    conversationId: string;
    content: string;
    replyToMessageId: string | null;
    files: StagedAttachment[];
    retryOf: string | null;
  };

  const sendMutation = useMutation({
    mutationFn: async (payload: SendPayload): Promise<void> => {
      if (!userId) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      // AVORA-46: after a first message the push card may offer itself (it decides; never on app open).
      offerPushSoon();
      // Read off the finished text rather than tracked as chips: deleting part of a name
      // un-names that person, which is what someone editing the sentence expects.
      const mentioned = extractMentionedIds(payload.content, mentionable);

      if (payload.files.length === 0) {
        await sendMessage(
          payload.conversationId,
          userId,
          payload.content,
          payload.replyToMessageId,
          mentioned,
          originGroupId,
        );
        return;
      }

      // Files go up first, then the message and its pointers land together in one statement.
      // A message that mentions a file nobody uploaded would be worse than a failed send.
      setIsUploading(true);
      try {
        const uploaded = [];
        for (const item of payload.files) {
          uploaded.push(await uploadStagedAttachment(payload.conversationId, item));
        }
        await sendMessageWithAttachments({
          conversationId: payload.conversationId,
          content: payload.content,
          replyToMessageId: payload.replyToMessageId,
          mentionedUserIds: mentioned,
          originGroupId,
          attachments: uploaded,
        });
      } finally {
        setIsUploading(false);
      }
    },
    onMutate: async (payload: SendPayload) => {
      if (!userId) return { previous: undefined, createdAt: new Date().toISOString() };
      if (payload.retryOf !== null) {
        const retryId = payload.retryOf;
        setFailedSends((current) =>
          current.map((send) => (send.localId === retryId ? { ...send, isRetrying: true } : send)),
        );
        return { previous: undefined, createdAt: new Date().toISOString() };
      }
      const key = chatKeys.messages(payload.conversationId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatMessage[]>(key);
      const createdAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `pending-${Date.now()}`,
        conversationId: payload.conversationId,
        senderId: userId,
        content: payload.content.trim(),
        createdAt,
        replyToMessageId: payload.replyToMessageId,
        // Keeps a caption-less photo from rendering as an empty bubble while it uploads.
        attachmentCount: payload.files.length,
        pending: true,
      };
      queryClient.setQueryData<ChatMessage[]>(key, [...(previous ?? []), optimistic]);
      return { previous, createdAt };
    },
    onError: (error: Error, payload, context) => {
      // Take the in-flight bubble back out of the cache — but not the message: it stays on
      // screen, in the same place, marked "Gửi lỗi", until it is sent again.
      if (context?.previous) {
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(payload.conversationId), context.previous);
      }
      // Refused because of a block (AVORA-37): no failed bubble and no toast. The words and
      // files go back into the composer untouched, with one neutral line beneath it.
      if (error.message === BLOCKED_SEND_NOTICE) {
        if (payload.retryOf !== null) {
          const retryId = payload.retryOf;
          setFailedSends((current) =>
            current.map((send) => (send.localId === retryId ? { ...send, isRetrying: false } : send)),
          );
        } else {
          if (payload.conversationId === activeConversationRef.current) {
            setDraft((current) => (current.trim() === "" ? payload.content : current));
            setStaged((current) => (current.length === 0 ? payload.files : current));
          } else if (readDraft(userId, payload.conversationId).trim() === "") {
            // Refused after the person moved on: the words wait in their own thread's draft.
            writeDraft(userId, payload.conversationId, payload.content);
          }
        }
        setRefusedSendConversationId(payload.conversationId);
        return;
      }
      if (payload.retryOf !== null) {
        const retryId = payload.retryOf;
        setFailedSends((current) =>
          current.map((send) => (send.localId === retryId ? { ...send, isRetrying: false } : send)),
        );
      } else if (userId) {
        const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (payload.files.length > 0) failedFilesRef.current.set(localId, payload.files);
        setFailedSends((current) => [
          ...current,
          {
            localId,
            conversationId: payload.conversationId,
            senderId: userId,
            content: payload.content.trim(),
            createdAt: context?.createdAt ?? new Date().toISOString(),
            replyToMessageId: payload.replyToMessageId,
            attachmentCount: payload.files.length,
          },
        ]);
      }
      // Said once, quietly; the bubble itself carries the state from here on.
      toast.error(error.message || "Tin chưa gửi được. Chạm vào tin để gửi lại.");
    },
    onSuccess: (_result, payload) => {
      setRefusedSendConversationId(null);
      if (payload.retryOf !== null) {
        const retryId = payload.retryOf;
        failedFilesRef.current.delete(retryId);
        setFailedSends((current) => current.filter((send) => send.localId !== retryId));
      }
      payload.files.forEach((item) => {
        if (item.previewUrl !== null) URL.revokeObjectURL(item.previewUrl);
      });
    },
    onSettled: (_result, _error, payload) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(payload.conversationId) });
      void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(payload.conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });

  /** The composer hands over an already-trimmed message; the send path itself is unchanged. */
  const handleSend = useCallback(
    (content: string): void => {
      // A message with no words but a photo attached is a real message.
      if ((content.length === 0 && staged.length === 0) || sendMutation.isPending || !conversationId) return;
      // Last line of defence (A8): the composer's own thread must be the one on screen.
      if (activeConversationRef.current !== conversationId) {
        logError("chat", new Error("avora_composer_conversation_mismatch"));
        return;
      }
      const files = staged;
      setDraft("");
      // The files travel with this message now — into the thread, or into its failed bubble —
      // so the composer is free for the next one either way.
      setStaged([]);
      // The quote belongs to the message that was just sent, not to the next one.
      setReplyTarget(null);
      // The message has arrived, so "still typing" is now false — say so at once rather than
      // letting the indicator time out a few seconds later.
      clearTyping();
      sendMutation.mutate({
        conversationId,
        content,
        replyToMessageId: replyTarget?.id ?? null,
        files,
        retryOf: null,
      });
    },
    [sendMutation, clearTyping, staged, conversationId, replyTarget, setDraft],
  );

  /** Tapping a failed bubble sends the very same message again, from where it sits. */
  const retryFailedSend = useCallback(
    (localId: string): void => {
      const send = failedSends.find((entry) => entry.localId === localId);
      if (send === undefined || send.isRetrying === true || sendMutation.isPending) return;
      sendMutation.mutate({
        conversationId: send.conversationId,
        content: send.content,
        replyToMessageId: send.replyToMessageId,
        files: failedFilesRef.current.get(localId) ?? [],
        retryOf: localId,
      });
    },
    [failedSends, sendMutation],
  );

  /** Letting a failed message go. Only ever offered on the person's own unsent bubble. */
  const discardFailedSend = useCallback((localId: string): void => {
    failedFilesRef.current.get(localId)?.forEach((item) => {
      if (item.previewUrl !== null) URL.revokeObjectURL(item.previewUrl);
    });
    failedFilesRef.current.delete(localId);
    setFailedSends((current) => current.filter((send) => send.localId !== localId));
  }, []);

  /**
   * Sends one ordinary message that did not come from the composer.
   *
   * Used when someone declines a suggestion with a word. Deliberately NOT `handleSend`: that
   * one clears the draft and the reply quote, which belong to whatever the person was already
   * writing and must survive an unrelated action. Awaited by the caller so a failure can be
   * reported rather than disappearing. `replyToMessageId` quotes the message the suggestion
   * came out of, so the answer reads beside the ask.
   */
  const sendPlainMessage = useCallback(
    async (content: string, replyToMessageId?: string | null): Promise<void> => {
      const trimmed = content.trim();
      if (trimmed.length === 0 || !conversationId || !userId) return;
      await sendMessage(
        conversationId,
        userId,
        trimmed,
        replyToMessageId ?? null,
        extractMentionedIds(trimmed, mentionable),
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
    [conversationId, userId, mentionable, queryClient],
  );

  /**
   * Correcting your own wording. The server re-checks the 24-hour window, so a stale form
   * left open overnight is refused rather than silently rewriting old history.
   */
  const editMutation = useMutation({
    mutationFn: ({ messageId, content }: { messageId: string; content: string }) =>
      editMessage(messageId, content),
    onSuccess: () => {
      setEditingMessageId(null);
      setEditDraft("");
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Taking a message back. The words are destroyed server-side, so there is nothing to undo
   * afterwards — which is why the menu item asks before it fires.
   */
  const recallMutation = useMutation({
    mutationFn: (messageId: string) => recallMessage(messageId),
    onSuccess: (_result, messageId) => {
      toast.success("Đã thu hồi tin nhắn.");
      // Withdrawing IS the answer to any outstanding ask, so none should keep showing.
      void resolveRecallAsk(messageId).catch(() => undefined);
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** One entry point for every per-message action, so the menu stays a dumb list. */
  const handleMessageAction = useCallback(
    (message: ChatMessage, action: MessageAction): void => {
      if (action === "reply") {
        setReplyTarget(message);
        return;
      }
      /*
        Forwarding one message is the same act as forwarding several, so it opens the same
        picker with a selection of one rather than a second, simpler dialog.
      */
      if (action === "forward") {
        // While picking, the ticks already made are the selection: never replace them (A2).
        if (!isSelecting) setSelectedIds([message.id]);
        setIsForwardOpen(true);
        return;
      }
      if (action === "select") {
        // Joining the selection adds this message; it never throws away what was ticked.
        setIsSelecting(true);
        setSelectedIds((current) => (current.includes(message.id) ? current : [...current, message.id]));
        return;
      }
      if (action === "task") {
        openTaskDialogFor(message);
        return;
      }
      if (action === "edit") {
        setEditingMessageId(message.id);
        setEditDraft(message.content);
        return;
      }

      if (action === "pin") {
        // An officer in a group is asked which audience they mean. Everyone else has only one
        // possible answer, so asking would be a question with a single button.
        if (activeKind === "group" && canPinForGroup(myGroupRole)) {
          setPinChoiceMessageId(message.id);
          return;
        }
        void addPin(message.id, "personal")
          .then(() => toast.success("Đã ghim riêng cho bạn."))
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Không ghim được."),
          );
        return;
      }

      if (action === "unpin") {
        // Clear whichever pin this person is entitled to remove, preferring their own private
        // one: an officer unpinning from the bubble usually means their own bookmark, and the
        // room's shared pin can still be cleared from the strip where it is labelled.
        const mine = pinOf(message.id, "personal");
        const shared = canPinForGroup(myGroupRole) ? pinOf(message.id, "group") : null;
        const target = mine ?? shared;
        if (target === null) return;
        void removePin(target.id)
          .then(() => toast.success("Đã bỏ ghim."))
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Không bỏ ghim được."),
          );
        return;
      }

      /*
        Asking someone else to take a message back. It sends a note and stops there: the words
        belong to whoever wrote them, so nothing is withdrawn automatically and the sender is
        never overruled.
      */
      if (action === "report") {
        setReportTarget({
          userId: message.senderId,
          name: senderNameOf(message),
          conversationId: message.conversationId,
          message: { id: message.id, content: message.content },
        });
        return;
      }

      if (action === "request-recall") {
        void askRecall(message.id)
          .then(() => toast.success("Đã gửi đề nghị. Người gửi sẽ tự quyết định."))
          .catch((error: unknown) =>
            toast.error(error instanceof Error ? error.message : "Không gửi được đề nghị."),
          );
        return;
      }

      // Recall destroys the text for everyone, so it asks first — this is the one action on a
      // message that cannot be walked back.
      void askConfirm({
        title: "Thu hồi tin nhắn này?",
        body: activeKind === "group" ? "Nội dung sẽ bị xoá với mọi người trong nhóm." : "Nội dung sẽ bị xoá với cả hai bên.",
        confirmLabel: "Thu hồi",
        danger: true,
      }).then((ok) => {
        if (ok) recallMutation.mutate(message.id);
      });
    },
    [
      isSelecting,
      openTaskDialogFor,
      recallMutation,
      activeKind,
      myGroupRole,
      addPin,
      removePin,
      pinOf,
      askRecall,
      senderNameOf,
    ],
  );

  /** The first lines of the picked messages, for the bundle preview in the forward dialog (B1). */
  const forwardPreviewLines: string[] = useMemo(() => {
    if (selectedIds.length < 2) return [];
    return messages
      .filter((message) => selectedIds.includes(message.id) && !isRecalled(message) && message.systemKind == null)
      .slice(0, 4)
      .map((message) => `${senderNameOf(message)}: ${messageBodyText(message).split("\n")[0] ?? ""}`);
  }, [messages, selectedIds, senderNameOf]);

  /** Clearing the selection without acting on it. */
  const cancelSelection = useCallback((): void => {
    setIsSelecting(false);
    setSelectedIds([]);
  }, []);

  /**
   * "Tạo nhiệm vụ" from the selection bar (Đợt gộp 2 · A5): the picked messages, oldest first,
   * become the description as "Tên: nội dung" blocks; the first one is the quoted source.
   */
  const openTaskFromSelection = useCallback((): void => {
    const picked = messages.filter((message) => selectedIds.includes(message.id) && !isRecalled(message));
    if (picked.length === 0) return;
    const transcript = transcriptText(
      picked.map((message) => ({
        name: senderNameOf(message),
        text: message.content,
        files: message.attachmentCount ?? 0,
      })),
      TASK_DESCRIPTION_MAX_LEN,
    );
    setTaskSelection({ messageIds: picked.map((message) => message.id), transcript });
    openTaskDialogFor(picked[0] ?? null);
  }, [messages, selectedIds, senderNameOf, openTaskDialogFor]);

  const deleteJournalMutation = useMutation({
    mutationFn: (ids: readonly string[]) => deleteJournalMessages(ids).then((count) => ({ count, ids })),
    onSuccess: ({ count, ids }: { count: number; ids: readonly string[] }) => {
      toast.success(deleteSummaryText(count), {
        action: {
          label: "Hoàn tác",
          onClick: () => {
            void restoreJournalMessages(ids).then(() => {
              if (conversationId) {
                void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
                void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(conversationId) });
              }
            });
          },
        },
      });
      cancelSelection();
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
        void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(conversationId) });
      }
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** "Mở mục gốc": back to the timeline, showing everything so the entry is surely there. */
  const openJournalEntry = useCallback(
    (messageId: string): void => {
      setShowAllTimeline(true);
      openDiaryView("journal");
      window.setTimeout(() => jumpToMessage(messageId), 160);
    },
    [openDiaryView, jumpToMessage],
  );

  /**
   * A.5: deleting from File / Liên kết deletes the whole journal entry (into the bin, 30 days).
   * When the entry also holds words of its own, it asks first.
   */
  const askDeleteEntry = useCallback(
    (messageId: string, text: string, itemCount: number, hasOwnWords: boolean): void => {
      const go = hasOwnWords && text.trim() !== ""
        ? askConfirm({
            title: "Xoá cả mục Nhật ký này?",
            body: `Mục có chữ và ${itemCount} tệp/link. Mục vào Thùng rác, khôi phục được trong 30 ngày.`,
            confirmLabel: "Chuyển vào Thùng rác",
            danger: true,
          })
        : Promise.resolve(true);
      void go.then((ok) => {
      if (!ok) return;
      void deleteJournalMessages([messageId])
        .then(() => {
          if (conversationId !== undefined) {
            void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
            void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(conversationId) });
          }
          toast.success("Đã chuyển mục Nhật ký vào Thùng rác (giữ 30 ngày).", {
            action: {
              label: "Hoàn tác",
              onClick: () => {
                void restoreJournalMessages([messageId]).then(() => {
                  if (conversationId !== undefined) {
                    void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
                    void queryClient.invalidateQueries({ queryKey: attachmentKeys.thread(conversationId) });
                  }
                });
              },
            },
          });
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không xoá được."));
      });
    },
    [conversationId, queryClient],
  );

  /**
   * Deleting notes from a journal.
   *
   * Asks first and says how many, because this one genuinely cannot be undone — unlike
   * everywhere else in chat, there is no tombstone left behind to recover the sense of.
   */
  const confirmDeleteSelected = useCallback((): void => {
    if (selectedIds.length === 0) return;
    const question =
      selectedIds.length === 1
        ? "Chuyển mục này vào Thùng rác? Khôi phục được trong 30 ngày."
        : `Chuyển ${selectedIds.length} mục vào Thùng rác? Khôi phục được trong 30 ngày.`;
    void askConfirm({ title: question, confirmLabel: "Chuyển vào Thùng rác", danger: true }).then((ok) => {
      if (ok) deleteJournalMutation.mutate(selectedIds);
    });
  }, [selectedIds, deleteJournalMutation]);

  const openConversation = useCallback(
    (nextId: string, originGroupId?: string | null): void => {
      // Opening a pair's thread from inside a group carries the room along, so the next
      // message written here is recorded as having been said in that room.
      navigate(
        originGroupId == null
          ? `/tin-nhan/${nextId}`
          : `/tin-nhan/${nextId}?${ORIGIN_GROUP_PARAM}=${encodeURIComponent(originGroupId)}`,
      );
    },
    [navigate],
  );

  /**
   * Bring the message a task was raised from into view, once per arrival. A quoted message
   * that has since been deleted simply has nothing to scroll to — the banner says so instead.
   */
  const contextJumpRef = useRef<string | null>(null);
  useEffect(() => {
    if (highlightTaskId === null || !conversationId || messagesQuery.isPending) return;
    const key = `${conversationId}:${highlightTaskId}`;
    if (contextJumpRef.current === key) return;

    const targetId = highlightSnapshot?.originalMessageId ?? null;
    if (targetId === null || isQuotedMessageGone) {
      contextJumpRef.current = key;
      return;
    }
    const node = document.getElementById(`message-${targetId}`);
    if (!node) return;
    contextJumpRef.current = key;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [conversationId, highlightTaskId, highlightSnapshot, isQuotedMessageGone, messagesQuery.isPending, messages]);

  const journalMutation = useMutation({
    mutationFn: () => ensureJournalConversation(),
    onSuccess: (journalId: string) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
      navigate(`/tin-nhan/${journalId}`, { replace: true });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * A tab is a choice of direction. Nhật ký has exactly one possible thread, so it opens
   * straight away — onto its three views, with no one-row list to tap through first; the
   * other directions put the chooser back in front of the user.
   */
  const handleSelectTab = useCallback(
    (tab: MessageTab): void => {
      setActiveTab(tab);
      setQuery("");

      // Nothing lives behind Email yet — the strip is a roadmap, so the tab
      // only turns its own page and touches neither the inbox nor the router.
      if (isPlaceholderTab(tab)) return;

      // Dự án reads its own list and opens onto /du-an/:id, so it leaves any thread in the
      // URL alone rather than navigating away from what the reader was looking at.
      if (isProjectTab(tab)) return;

      // A phone rests on the three-row Diary list, which lives at the bare inbox address so the
      // tool-belt stays; a computer opens the journal beside that list at once.
      if (tab !== "journal") {
        navigate("/tin-nhan");
        return;
      }

      const existing = conversations.find((item) => item.kind === "personal");
      if (existing) {
        // From the bare list the journal takes that step's place, so "back" never lands on a
        // one-row list that would only send the reader straight back in.
        navigate(`/tin-nhan/${existing.conversationId}`, { replace: conversationId === undefined });
        return;
      }
      // First visit on this account: the journal is created on demand.
      journalMutation.mutate();
    },
    [conversations, navigate, journalMutation, conversationId, isWide],
  );

  /**
   * Nhật ký never rests on its list: arriving at the bare inbox with that tab chosen (a step
   * back, a reload) opens the journal itself, in place of the list entry.
   */
  useEffect(() => {
    if (!isWide && activeTab === "journal" && journalSummary === undefined && conversationsQuery.isSuccess && !journalMutation.isPending) {
      // First visit: the journal is created quietly, then opened.
      journalMutation.mutate();
      return;
    }
    if (conversationId !== undefined || activeTab !== "journal" || journalSummary === undefined) return;
    navigate(`/tin-nhan/${journalSummary.conversationId}`, { replace: true });
    // journalMutation is a fresh object each render; its pending flag is the part that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, activeTab, journalSummary, navigate, isWide, conversationsQuery.isSuccess, journalMutation.isPending]);

  // Opening a thread by link (or the "Nhắn riêng" jump out of a group) must land on the tab
  // that thread actually belongs to, or the list beside it would contradict the header. Keyed on
  // the thread, not the tab: a tab the reader just tapped is never overwritten by the thread the
  // router still reports for one more render.
  const syncedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId === undefined) {
      syncedThreadRef.current = null;
      return;
    }
    if (!activeSummary) return;
    const tab = tabForOpenedThread(
      { conversationId: activeSummary.conversationId, kind: activeSummary.kind },
      syncedThreadRef.current,
      activeTab,
    );
    syncedThreadRef.current = activeSummary.conversationId;
    if (tab !== null) setActiveTab(tab);
  }, [conversationId, activeSummary, activeTab]);

  /** A search result (ADR-032) opens the thread and lights the message: `?toi=<messageId>`. */
  const jumpParam: string | null = searchParams.get("toi");
  const jumpedRef = useRef<string | null>(null);
  useEffect(() => {
    if (jumpParam === null || conversationId === undefined || messagesQuery.isPending) return;
    const key = `${conversationId}:${jumpParam}`;
    if (jumpedRef.current === key) return;
    jumpedRef.current = key;
    if (activeKind === "personal") setShowAllTimeline(true);
    window.setTimeout(() => jumpToMessage(jumpParam), 120);
  }, [jumpParam, conversationId, messagesQuery.isPending, activeKind, jumpToMessage]);

  /** Arriving back from a project detail screen lands on the tab that listed it. */
  useEffect(() => {
    if (searchParams.get("tab") === "du-an") setActiveTab("projects");
  }, [searchParams]);

  /** AVORA-53 · 6.1: `?ket-ban=1` (Avora Space › Bắt đầu) opens "find a friend by PIN" once. */
  useEffect(() => {
    if (searchParams.get("ket-ban") !== "1") return;
    setIsNewChatOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("ket-ban");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /** "Mở biên bản" from a note saved in Diary: the group opens with its Sổ quyết định on top. */
  const decisionParam: string | null = searchParams.get(DECISION_PARAM);
  useEffect(() => {
    if (decisionParam !== null && activeKind === "group") setIsDecisionsOpen(true);
  }, [decisionParam, activeKind]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col md:flex-row">
      <section
        ref={listSectionRef}
        style={listColumn.isDesktop ? { width: listColumn.width } : undefined}
        className={cn(
          "relative flex min-h-0 w-full flex-col border-border bg-card md:w-[360px] md:shrink-0 md:border-r",
          conversationId && !isPlaceholder && !isDiaryListScreen ? "hidden md:flex" : "flex",
          isWritingSpace && "md:hidden",
        )}
        aria-label="Danh sách cuộc trò chuyện"
      >
        <ResizeHandle
          columnRef={listSectionRef}
          control={listColumn}
          label="Độ rộng danh sách"
        />
        <div className="px-6 pb-4 pt-7">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[28px] font-semibold tracking-tight text-foreground md:text-[30px]">Kết nối</h1>
            {!isLive ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Đang kết nối lại
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              {/* 1.5: 1-1 and Nhóm search from their own box (with "trong toàn AVORA"); 🔍 stays where there is none. */}
              {activeTab === "direct" || activeTab === "group" ? null : (
                <AvoraSearchButton
                  here={{ tab: activeTab === "journal" ? "nhat-ky" : "ket-noi", conversationId: conversationId ?? null, label: activeTab === "journal" ? "Nhật ký" : "Kết nối" }}
                />
              )}
              {/* Liên hệ left the main rail: the people you talk to belong beside the talking. */}
              <Link
                to={withReturn("/lien-he", hereFrom(location, "Kết nối"))}
                aria-label="Liên hệ"
                title="Liên hệ"
                className="press rounded-md border border-border p-2.5 text-foreground transition-colors hover:bg-accent/50"
              >
                <UserRound className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
              </Link>
              {/* 1.6: one ＋ for everything that starts something new here. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Tạo mới"
                    title="Tạo mới"
                    className="press rounded-md border border-border bg-primary p-2.5 text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Plus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onSelect={() => setIsNewChatOpen(true)} className="min-h-11 gap-2.5 text-[14px]">
                    <SquarePen className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Trò chuyện mới
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setIsNewGroupOpen(true)} className="min-h-11 gap-2.5 text-[14px]">
                    <Users className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Nhóm mới
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setIsNewChatOpen(true)} className="min-h-11 gap-2.5 text-[14px]">
                    <QrCode className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Kết bạn qua PIN / QR
                  </DropdownMenuItem>
                  {isProjects ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        setActiveTab("group");
                        navigate("/tin-nhan");
                        toast.info("Dự án mở trong một nhóm: chọn nhóm, rồi ⋯ › Dự án › Tạo dự án.");
                      }}
                      className="min-h-11 gap-2.5 text-[14px]"
                    >
                      <FolderKanban className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Dự án mới
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div role="tablist" aria-label="Hướng trò chuyện" className="no-scrollbar mt-5 flex items-center overflow-x-auto border-b border-border">
            {MESSAGE_TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              const tabUnread = unreadForTab(conversations, tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleSelectTab(tab.id)}
                  className={cn(
                    "press relative flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 pb-2.5 pt-1 text-[13.5px] transition-colors",
                    isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                    isPlaceholderTab(tab.id) && !isActive && "text-muted-foreground/60",
                  )}
                >
                  {tab.label}
                  {isPlaceholderTab(tab.id) ? (
                    <span className="rounded-full border border-border px-1.5 py-px text-[9.5px] font-medium leading-tight text-muted-foreground">Sắp có</span>
                  ) : null}
                  {tabUnread > 0 ? (
                    <span
                      aria-label={`${tabUnread} tin nhắn chưa đọc`}
                      className="tabular inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                    >
                      {formatUnreadBadge(tabUnread)}
                    </span>
                  ) : null}
                  {isActive ? (
                    <span aria-hidden="true" className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {activeTab === "journal" || isPlaceholder ? null : (
            <label className="relative mt-4 block">
              <span className="sr-only">Tìm cuộc trò chuyện</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.6}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={activeTab === "group" ? "Tìm nhóm theo tên" : isProjects ? "Tìm dự án theo tên" : "Tìm theo tên"}
                className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
            </label>
          )}
          {activeTab === "journal" || isPlaceholder ? null : (
            <SearchEverywhereLine query={query} here={{ tab: "ket-noi", conversationId: null, label: "Kết nối" }} />
          )}
        </div>

        {isPlaceholder ? (
          /* Mobile: the placeholder page lives under the strip, where the list would be.
             Desktop gets the full-width one in the detail pane instead. */
          <div className="flex min-h-0 flex-1 flex-col md:hidden">
            <PlaceholderComingSoon id={activeTab} />
          </div>
        ) : isProjects ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {projectsQuery.isError ? (
              <div className="px-6 py-10 text-center">
                <p className="text-[14px] text-muted-foreground">{projectsQuery.error.message}</p>
                <button
                  type="button"
                  onClick={() => void projectsQuery.refetch()}
                  className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                >
                  Thử lại
                </button>
              </div>
            ) : (
              <ProjectList
                projects={projects}
                conversations={conversations}
                activeProjectId={undefined}
                isPending={projectsQuery.isPending || conversationsQuery.isPending}
                query={query}
              />
            )}
          </div>
        ) : activeTab === "journal" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DiaryList
              journalId={journalSummary?.conversationId ?? null}
              active={activeKind === "personal" ? diaryView : null}
              counts={diaryCounts}
              dots={diaryDots}
              isWide={isWide}
              onPaste={() => void startPaste()}
              isPasting={isReadingClipboard}
            />
          </div>
        ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {conversationsQuery.isPending ? (
            <ul className="space-y-1 px-3 pt-1" aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <li key={row} className="flex items-center gap-3 py-3">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-secondary" />
                  <span className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3.5 w-2/5 animate-pulse rounded bg-secondary" />
                    <span className="block h-3 w-3/5 animate-pulse rounded bg-secondary/70" />
                  </span>
                </li>
              ))}
            </ul>
          ) : conversationsQuery.isError ? (
            <div className="px-3 py-10 text-center">
              <p className="text-[14px] text-muted-foreground">{(conversationsQuery.error as Error).message}</p>
              <button
                type="button"
                onClick={() => void conversationsQuery.refetch()}
                className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
              >
                Thử lại
              </button>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="text-[14px] text-muted-foreground">
                {tabConversations.length > 0
                  ? "Không có kết quả phù hợp."
                  : activeTab === "group"
                    ? "Chưa có nhóm nào. Tạo nhóm để trò chuyện cùng nhiều người."
                    : "Chưa có cuộc trò chuyện nào."}
              </p>
              {tabConversations.length === 0 && activeTab === "group" ? (
                <button
                  type="button"
                  onClick={() => setIsNewGroupOpen(true)}
                  className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                >
                  Tạo nhóm
                </button>
              ) : null}
              {tabConversations.length === 0 && activeTab === "direct" ? (
                <button
                  type="button"
                  onClick={() => setIsNewChatOpen(true)}
                  className="press mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                >
                  <QrCode className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> Kết bạn qua PIN / QR
                </button>
              ) : null}
            </div>
          ) : activeTab === "group" && query.trim().length === 0 ? (
            // No search: the tree. A search reads flat, so a match deep in a branch is never folded away.
            <GroupTree tree={groupTree} activeConversationId={conversationId} userId={userId} projectById={projectByIdMap} />
          ) : (
            <ul>
              {visibleConversations.map((item) => {
                const isActive = item.conversationId === conversationId;
                const isUnread = item.unreadCount > 0;
                // A half-typed message shows instead of the last one; the row does not move (A8).
                const savedDraft = draftsVersion >= 0 && !isActive ? readDraft(userId, item.conversationId) : "";
                const hasDraft = savedDraft.trim() !== "";
                const preview = hasDraft
                  ? draftPreview(savedDraft)
                  : item.lastMessageContent === null
                    ? "Chưa có tin nhắn nào"
                    : `${item.lastMessageSenderId === userId ? "Bạn: " : ""}${item.lastMessageContent}`;
                return (
                  <li key={item.conversationId}>
                    <Link
                      to={`/tin-nhan/${item.conversationId}`}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-3 transition-colors",
                        isActive ? "bg-accent/70" : "hover:bg-accent/35",
                      )}
                    >
                      {item.kind === "personal" ? (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                          <NotebookPen className="h-[19px] w-[19px]" strokeWidth={1.7} aria-hidden="true" />
                        </span>
                      ) : (
                        <InitialsAvatar name={conversationTitle(item)} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {item.kind === "group" ? (
                              <Users
                                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            ) : null}
                            <span className="truncate text-[15px] font-semibold text-foreground">
                              {conversationTitle(item)}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "tabular shrink-0 text-[12px]",
                              isUnread ? "font-medium text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {formatInboxTime(item.lastMessageAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[13px]",
                              hasDraft
                                ? "text-primary/90"
                                : item.lastMessageContent === null
                                ? "italic text-muted-foreground/70"
                                : isUnread
                                  ? "font-medium text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {preview}
                          </span>
                          {isUnread ? (
                            <span
                              aria-label={`${item.unreadCount} tin nhắn chưa đọc`}
                              className="tabular inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground"
                            >
                              {formatUnreadBadge(item.unreadCount)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
              </ul>
          )}
        </div>
        )}
      </section>

      <section
        className={cn(
          "paper min-h-0 min-w-0 flex-1 flex-col",
          conversationId && !isPlaceholder && !isDiaryListScreen ? "flex" : "hidden md:flex",
        )}
      >
        {isPlaceholder ? (
          <PlaceholderComingSoon id={activeTab} />
        ) : isProjects && !conversationId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
              <FolderKanban className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h2 className="mt-6 text-[22px] font-semibold tracking-tight text-foreground">
              Chọn một dự án
            </h2>
            <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              Mỗi dự án mở ra ba tầng: mục tiêu, kết quả cần giao, và nhiệm vụ dẫn tới từng kết quả.
            </p>
          </div>
        ) : conversationId ? (
          isUnknownConversation ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <h2 className="text-[24px] font-semibold tracking-tight text-foreground">
                Không mở được cuộc trò chuyện
              </h2>
              <p className="mt-2 max-w-sm text-[15px] text-muted-foreground">
                Cuộc trò chuyện này không tồn tại hoặc bạn không có quyền truy cập.
              </p>
              <button
                type="button"
                onClick={() => navigate("/tin-nhan")}
                className="press mt-7 rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
              >
                Về Kết nối
              </button>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-border bg-card px-3 pb-2.5 pt-[max(env(safe-area-inset-top),0.625rem)] md:gap-3 md:px-5 md:py-3.5 md:pr-[4.25rem]">
                {isWritingSpace ? (
                  /* 44b · B: the writing space hides the Kết nối list; this is the way back to it. */
                  <button
                    type="button"
                    onClick={() => openDiaryView("journal")}
                    className="press inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-md pl-1 pr-2 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" /> Nhật ký
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Quay lại Kết nối"
                    onClick={() => {
                      // 49 · 1.1: out of Nhật ký lands on the conversation list, and stays there.
                      if (activeKind === "personal") setActiveTab("direct");
                      // AVORA-53 · 2.10: opened from elsewhere (`tu`) → back there; otherwise the list, replacing.
                      const cameFrom = readReturn(searchParams);
                      if (cameFrom !== null) navigate(cameFrom.path, { replace: true });
                      else navigate("/tin-nhan", { replace: true });
                    }}
                    className="press flex h-10 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground md:hidden"
                  >
                    <ChevronLeft className="h-5 w-5" strokeWidth={1.6} />
                  </button>
                )}
                {activeKind === "personal" ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <DiaryHeaderIcon view={diaryView} />
                  </span>
                ) : (
                  <span className="relative shrink-0">
                    <InitialsAvatar name={threadTitle} size="sm" />
                    {/*
                      Online or not, and nothing more. A "last seen at" would outlive the
                      moment it described and quietly become a log of when someone was at
                      their desk — which nobody asked to publish.
                    */}
                    {isPeerOnline ? (
                      <span
                        aria-label="Đang trực tuyến"
                        title="Đang trực tuyến"
                        className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-emerald-500"
                      />
                    ) : null}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5 truncate text-[16px] font-semibold text-foreground">
                    {activeKind === "group" ? (
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    ) : null}
                    {activeKind === "personal" ? diaryViewLabel : threadTitle}
                  </p>
                  {/* Typing takes the subtitle's place while it lasts: two lines of status
                      under one name is more than the header can carry. */}
                  {typingLine !== null ? (
                    <p className="truncate text-[13px] font-medium text-primary" aria-live="polite">
                      {typingLine}
                    </p>
                  ) : (
                    <p className="truncate text-[13px] text-muted-foreground">
                      {isPeerOnline ? "Đang trực tuyến" : activeKind === "personal" ? "Chỉ mình bạn xem" : threadSubtitle}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  {/* 49 · 2.6: at most 🔍 and ⋯ in a room's header; tasks and scheduling live in ⋯. */}
                  {activeKind === "personal" && diaryView !== "journal" ? null : (
                  <button
                    type="button"
                    aria-label="Tìm trong cuộc trò chuyện này"
                    title="Tìm trong cuộc trò chuyện này"
                    aria-pressed={isSearchOpen}
                    onClick={() => setIsSearchOpen((current) => !current)}
                    className={cn(
                      "press flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent/50 hover:text-foreground",
                      isSearchOpen ? "bg-accent/60 text-foreground" : "",
                    )}
                  >
                    <Search className="h-[19px] w-[19px]" strokeWidth={1.6} />
                  </button>
                  )}
                  {activeKind === "direct" ? (
                    <CallMenu peerId={activeSummary?.peerId ?? peerQuery.data?.peerId ?? null} peerName={threadTitle} />
                  ) : null}
                  <button
                    type="button"
                    aria-label="Thêm"
                    title="Thêm"
                    onClick={() => setIsInfoOpen(true)}
                    className="press flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <MoreHorizontal className="h-[19px] w-[19px]" strokeWidth={1.6} />
                  </button>
                </div>
              </header>

              {isSearchOpen ? (
                <ThreadSearch
                  conversationId={conversationId}
                  senderNameOf={senderNameOf}
                  onJumpTo={jumpToMessage}
                  onClose={() => setIsSearchOpen(false)}
                />
              ) : null}

              {/* 49 · 3.2: the way back to wherever this thread was opened from. */}
              <ReturnChip className="border-b border-border bg-card px-4 md:px-10" />

              {isDiaryAside ? null : (
                <ThreadChipRow chips={threadChips} open={openChip} onToggle={(id) => setOpenChip((current) => (current === id ? null : id))}>
                  {openChip === "pins" ? (
                    <PinnedStrip
                      embedded
                      pins={orderedPinList}
                      messages={messages}
                      viewerId={userId}
                      myRole={myGroupRole}
                      senderNameOf={senderNameOf}
                      onJumpTo={(messageId) => {
                        setOpenChip(null);
                        jumpToMessage(messageId);
                      }}
                      onUnpin={removePin}
                      isWorking={isPinning}
                    />
                  ) : openChip === "suggestions" && activeKind !== "personal" ? (
                    <ChatSuggestionPanel
                      embedded
                      conversationId={conversationId}
                      conversationKind={activeKind}
                      peerName={threadTitle}
                      members={groupMembersQuery.data ?? []}
                      onSendMessage={sendPlainMessage}
                      focusedSuggestionId={focusedSuggestionId}
                    />
                  ) : openChip === "tasks" && activeKind !== "personal" ? (
                    <ChatTaskPanel
                      embedded
                      conversationId={conversationId}
                      peerName={threadTitle}
                      members={groupMembersQuery.data ?? []}
                      highlightTaskId={highlightTaskId}
                      scope={activeKind === "group" ? "mine" : "all"}
                      onSendMessage={sendPlainMessage}
                    />
                  ) : openChip === "scheduled" && canSchedule ? (
                    <ScheduledStrip embedded conversationId={conversationId} items={scheduledQuery.data ?? []} />
                  ) : null}
                </ThreadChipRow>
              )}

              {!isLive && !isLiveNoticeHidden ? (
                <p
                  role="status"
                  className="flex items-center gap-2 border-b border-border bg-accent/40 px-4 py-1.5 text-[12px] text-muted-foreground md:px-10"
                >
                  <span className="min-w-0 flex-1 truncate">Chưa kết nối trực tiếp — tạm tải lại mỗi 5 giây.</span>
                  <button type="button" onClick={() => setIsLiveNoticeHidden(true)} aria-label="Ẩn dòng này" className="press -my-1 rounded p-1.5 hover:bg-accent">
                    <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  </button>
                </p>
              ) : null}

              {/* Arrived from a task link: say which task, and where it belongs (AVORA-39 / B1–B2). */}
              {highlightTask !== null && conversationId ? (
                <TaskContextStrip
                  task={highlightTask}
                  conversationId={conversationId}
                  conversations={conversations}
                  threadTitle={threadTitle}
                  onOpenDetail={() => setOpenedSourceTaskId(highlightTask.id)}
                  onDismiss={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete(CONTEXT_TASK_PARAM);
                    setSearchParams(next, { replace: true });
                  }}
                />
              ) : null}

              {/* The task outlived the message it came from, so the task shows what was said. */}
              {isQuotedMessageGone && highlightSnapshot !== null ? (
                <div
                  role="status"
                  className="border-b border-border bg-accent/40 px-5 py-3 md:px-10"
                >
                  <div className="mx-auto max-w-2xl">
                    <p className="text-[12px] font-medium text-muted-foreground">{DELETED_MESSAGE_NOTE}</p>
                    {highlightSnapshot.originalMessageText.trim() !== "" ? (
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-foreground">
                        {highlightSnapshot.originalMessageSenderName !== ""
                          ? `${highlightSnapshot.originalMessageSenderName}: `
                          : ""}
                        {highlightSnapshot.originalMessageText}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {activeKind === "personal" && conversationId !== undefined && !isWide ? (
                <DiaryCountRow journalId={conversationId} active={diaryView} counts={diaryCounts} dots={diaryDots} />
              ) : null}
              {isDiaryAside && diaryView === "notes" ? (
                <div className="min-h-0 flex-1">
                  <NotesPanel
                    data={notesData}
                    isWide={isWide}
                    request={notesRequest}
                    onRequestHandled={clearNotesRequest}
                    onCreateTask={setNoteTaskExit}
                    onToBoard={setNoteBoardExit}
                    onOpenBook={(recordId) => navigate(withReturn(`/ke-hoach/ke-sach?sach=${encodeURIComponent(recordId)}`, hereFrom(location, "Ghi chép")))}
                  />
                </div>
              ) : isDiaryAside ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-10">
                  {diaryView === "files" ? (
                    <DiaryFilesView
                      notes={diaryFiles}
                      meetingNotes={savedMeetingNotes}
                      noteFiles={noteFileRows}
                      urlOf={attachmentUrlOf}
                      noteUrlOf={notesData.urlOf}
                      isLoading={isAttachmentsLoading}
                      onOpenNote={openJournalEntry}
                      onOpenWriting={openWriting}
                      onDelete={(entry) => askDeleteEntry(entry.messageId, entry.note, entry.attachments.length, entry.place !== "files")}
                    />
                  ) : diaryView === "links" ? (
                    <DiaryLinksView
                      links={diaryLinkRows}
                      onOpenNote={openJournalEntry}
                      onOpenWriting={openWriting}
                      onDelete={(link) => {
                        if (link.from.kind !== "journal") return;
                        const entry = messages.find((message) => message.id === (link.from as { messageId: string }).messageId);
                        if (entry === undefined) return;
                        const chips = entryChips({ content: entry.content, attachments: journalFilesOf(entry.id), hasTask: false });
                        askDeleteEntry(entry.id, entry.content, chips.files + chips.links, link.from.place !== "links");
                      }}
                    />
                  ) : (
                    <DiarySourcesView
                      tasks={pasteTasks}
                      contextOf={(task) => {
                        const snapshot = task.contextSnapshot;
                        const messageId = snapshot?.originalMessageId ?? null;
                        const live = messageId === null ? undefined : messages.find((message) => message.id === messageId);
                        const text = (snapshot?.origin?.content ?? "").trim() || (live?.content ?? snapshot?.originalMessageText ?? "").trim();
                        return { text, messageId: messageId !== null && snapshot?.conversationId === journalConversationId ? messageId : null };
                      }}
                      onOpenTask={(task) => setOpenedSourceTaskId(task.id)}
                      onOpenEntry={openJournalEntry}
                      onPaste={() => void startPaste()}
                      isPasting={isReadingClipboard}
                    />
                  )}
                </div>
              ) : (
              <div
                className="relative min-h-0 flex-1"
                onDragEnter={canDropFiles ? handleDragEnter : undefined}
                onDragOver={canDropFiles ? handleDragOver : undefined}
                onDragLeave={canDropFiles ? handleDragLeave : undefined}
                onDrop={canDropFiles ? handleDrop : undefined}
              >
              {isDraggingFiles ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-[16px] border-2 border-dashed border-primary/60 bg-background/80 text-[15px] font-medium text-foreground backdrop-blur-[2px]"
                >
                  Thả để đính kèm
                </div>
              ) : null}
              <div
                ref={threadScrollRef}
                onScroll={handleThreadScroll}
                className="h-full overflow-y-auto px-5 py-6 md:px-10"
              >
                {messagesQuery.isPending ? (
                  <p className="text-center text-[13px] text-muted-foreground">Đang tải tin nhắn…</p>
                ) : messagesQuery.isError ? (
                  <div className="text-center">
                    <p className="text-[14px] text-muted-foreground">{(messagesQuery.error as Error).message}</p>
                    <button
                      type="button"
                      onClick={() => void messagesQuery.refetch()}
                      className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                    >
                      Thử lại
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <p className="mx-auto max-w-sm text-center text-[14px] text-muted-foreground">
                    {activeKind === "personal"
                      ? "Chưa có ghi chú nào. Viết dòng đầu tiên cho riêng bạn."
                      : activeKind === "group"
                        ? `Chưa có tin nhắn nào trong ${threadTitle}. Mở lời đầu tiên nhé.`
                        : `Chưa có tin nhắn nào. Gửi lời chào đầu tiên tới ${threadTitle}.`}
                  </p>
                ) : (
                  <div className="mx-auto flex max-w-2xl flex-col gap-6">
                    {activeKind === "personal" ? (
                      <label className="flex items-center justify-end gap-2 text-[12.5px] text-muted-foreground">
                        <span>Hiện tất cả (cả tệp, link, việc)</span>
                        <Switch checked={showAllTimeline} onCheckedChange={setShowAllTimeline} aria-label="Hiện tất cả" />
                      </label>
                    ) : null}
                    {/* Paged thread (A7): the top says whether more is coming or this is the start. */}
                    {conversationId !== undefined && reachedStart[conversationId] === true ? (
                      <p className="text-center text-[12px] text-task-idle">Đầu cuộc trò chuyện</p>
                    ) : isLoadingOlder ? (
                      <p className="text-center text-[12px] text-muted-foreground" role="status">Đang tải tin cũ hơn…</p>
                    ) : null}
                    {dayGroups.map((group) => (
                      <div key={group.key}>
                        <p className="mb-6 text-center text-[12px] font-medium text-muted-foreground/80">{group.label}</p>
                        <ul className="flex flex-col gap-3">
                          {group.messages.map((message, index) => {
                            // A line the server wrote itself: no bubble, no sender, no actions.
                            if (message.systemKind === "proposal_opened") {
                              return (
                                <li key={message.id} id={`message-${message.id}`} className="px-2">
                                  <ProposalCard
                                    content={message.content}
                                    proposal={proposalsByMessage.get(message.id)}
                                    userId={userId}
                                    nameOf={(id) => senderNames.get(id) ?? (id === userId ? "Bạn" : threadTitle)}
                                  />
                                </li>
                              );
                            }
                            if (message.systemKind != null) {
                              return (
                                <li
                                  key={message.id}
                                  id={`message-${message.id}`}
                                  className="mx-auto max-w-md px-4 text-center text-[12.5px] leading-relaxed text-muted-foreground"
                                >
                                  {message.content}
                                </li>
                              );
                            }
                            const outgoing = message.senderId === userId;
                            // A journal has no reader but the writer, so a delivery receipt
                            // would be answering a question nobody asked.
                            const showsReceipt =
                              outgoing &&
                              message.id === lastOwnMessageId &&
                              message.pending !== true &&
                              activeKind !== "personal";
                            const showsSender = !outgoing && activeKind === "group";
                            const senderLabel = showsSender
                              ? (senderNames.get(message.senderId) ?? "Thành viên")
                              : null;
                            // Work is agreed as often by the reply as by the request, so a task
                            // can be raised from either side's bubble. A journal note counts too:
                            // there is nobody to ask, so it becomes the writer's own task outright
                            // rather than a suggestion. Only a message still in flight is refused.
                            // Chờ kết bạn frame (AVORA-38): text only — no task entry at all.
                            const canRaiseTask = message.pending !== true && activeVerification === null && !isNoLongerConnected;
                            const recalled = isRecalled(message);
                            const isBeingEdited = editingMessageId === message.id;
                            // A journal has nobody to react to you, and a withdrawn message has
                            // nothing left to react to.
                            const canReact =
                              activeKind !== "personal" && message.pending !== true && !recalled;
                            // Pinning works everywhere, including a journal — that is where
                            // people keep the things they most often come back looking for.
                            const canPinThis = message.pending !== true && !recalled;
                            // "Already pinned" means pinned for an audience this person can
                            // clear: their own bookmark, or the room's pin if they hold a seat.
                            const isPinnedForMe =
                              pinOf(message.id, "personal") !== null ||
                              (canPinForGroup(myGroupRole) && pinOf(message.id, "group") !== null);
                            // Asking someone to take a message back only makes sense on somebody
                            // else's words, in a thread that has somebody else in it. Your own
                            // message already has "Thu hồi", and a journal has nobody to ask.
                            const canRequestRecall =
                              activeKind !== "personal" &&
                              !outgoing &&
                              message.pending !== true &&
                              !recalled;
                            // What the sender is being asked, in names rather than a count —
                            // "somebody objected" invites suspicion of everyone in the room.
                            const recallAsks = outgoing && !recalled ? recallAsksFor(message.id) : [];
                            const recallAskNote =
                              recallAsks.length === 0
                                ? null
                                : recallRequestNote(
                                    recallAsks.map(
                                      (entry) =>
                                        senderNames.get(entry.requestedBy) ?? "Một thành viên",
                                    ),
                                  );
                            // Looked up live rather than snapshotted, so a quote follows what
                            // happens to the original afterwards.
                            const quotedParent =
                              message.replyToMessageId == null
                                ? null
                                : (messages.find((entry) => entry.id === message.replyToMessageId) ?? null);
                            // Declines made without a word, sitting after the message they
                            // followed. Not bubbles: nobody said this, so it gets no sender,
                            // no side and no reactions.
                            const skipNotices = silentSkipsByMessage.get(message.id) ?? [];
                            // Only a message that still exists can be carried anywhere.
                            const canForwardThis = message.pending !== true && !recalled;
                            const isSelected = selectedIds.includes(message.id);
                            // Where a forwarded message came from. The name is stored beside
                            // the id, so the label survives the original being withdrawn.
                            const forwardedNote =
                              message.originContentId == null || recalled
                                ? null
                                : forwardedFromLabel(
                                    message.originSenderId == null
                                      ? null
                                      : (senderNames.get(message.originSenderId) ?? null),
                                  );
                            return (
                              <Fragment key={message.id}>
                              {message.id === unreadMarkerId ? (
                                <li id="unread-marker" className="flex scroll-mt-4 items-center gap-3 py-1" aria-label="Tin chưa đọc">
                                  <span className="h-px flex-1 bg-primary/40" aria-hidden="true" />
                                  <span className="text-[12px] font-medium text-primary">Tin chưa đọc</span>
                                  <span className="h-px flex-1 bg-primary/40" aria-hidden="true" />
                                </li>
                              ) : null}
                              <li
                                id={`message-${message.id}`}
                                style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                                className={cn(
                                  "group flex animate-bubble-in scroll-mt-8 rounded-bubble transition-colors",
                                  outgoing ? "flex-col items-end" : "items-end gap-2.5",
                                  // The message a task was raised from, pointed out on arrival,
                                  // or a search result just jumped to.
                                  quotedMessageId === message.id || flashedMessageId === message.id
                                    ? "bg-primary/10 ring-1 ring-primary/40"
                                    : "",
                                  isSelecting ? "cursor-pointer" : "",
                                  isSelected ? "bg-primary/10" : "",
                                )}
                                onClick={
                                  isSelecting && canForwardThis
                                    ? () =>
                                        setSelectedIds((current) =>
                                          toggleSelected(current, message.id),
                                        )
                                    : undefined
                                }
                              >
                                {/*
                                  While picking, every eligible bubble carries its own tick.
                                  A withdrawn message has none: there is nothing left to carry.
                                */}
                                {isSelecting ? (
                                  <span className="shrink-0 self-center pr-1">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      disabled={!canForwardThis}
                                      onChange={() =>
                                        setSelectedIds((current) =>
                                          toggleSelected(current, message.id),
                                        )
                                      }
                                      onClick={(event) => event.stopPropagation()}
                                      aria-label={`Chọn tin nhắn: ${messageBodyText(message).slice(0, 40)}`}
                                      className="h-4 w-4 accent-primary disabled:opacity-40"
                                    />
                                  </span>
                                ) : null}
                                {senderLabel ? (
                                  <div className="shrink-0 pb-5" aria-hidden="true">
                                    <InitialsAvatar name={senderLabel} size="sm" />
                                  </div>
                                ) : null}
                                <div
                                  className={cn(
                                    "flex min-w-0 flex-col",
                                    outgoing ? "items-end" : "items-start",
                                    // Picking does one thing: a tap anywhere on the row ticks it.
                                    // Images, links and quotes stop answering until picking ends (A2).
                                    isSelecting ? "pointer-events-none select-none" : "",
                                  )}
                                >
                                  {senderLabel ? (
                                    <span className="mb-1 px-1 text-[12px] font-medium text-muted-foreground">
                                      {senderLabel}
                                    </span>
                                  ) : null}
                                  {/*
                                    A reply carries the message it answers above it. The quote
                                    reads the live original, so one that is withdrawn later
                                    shows the tombstone note rather than words nobody can see.
                                  */}
                                  {quotedParent !== null ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        document
                                          .getElementById(`message-${quotedParent.id}`)
                                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                                      }}
                                      className="press mb-1 flex max-w-[80%] flex-col items-start gap-0.5 rounded-[8px] border-l-2 border-primary/50 bg-secondary/50 px-2.5 py-1.5 text-left"
                                    >
                                      <span className="text-[11.5px] font-medium text-muted-foreground">
                                        {senderNameOf(quotedParent)}
                                      </span>
                                      <span
                                        className={cn(
                                          "line-clamp-2 text-[12.5px]",
                                          isRecalled(quotedParent)
                                            ? "italic text-muted-foreground"
                                            : "text-foreground/80",
                                        )}
                                      >
                                        {quotePreview(quotedParent)}
                                      </span>
                                    </button>
                                  ) : null}

                                  {isBeingEdited ? (
                                    <div className="w-full max-w-[80%] space-y-1.5">
                                      <textarea
                                        value={editDraft}
                                        onChange={(event) => setEditDraft(event.target.value)}
                                        rows={2}
                                        maxLength={4000}
                                        aria-label="Sửa tin nhắn"
                                        className="w-full resize-y rounded-bubble border border-input bg-card px-3 py-2 text-[15px] leading-relaxed text-foreground outline-none focus:border-primary/60"
                                      />
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          disabled={editMutation.isPending || editDraft.trim() === ""}
                                          onClick={() =>
                                            editMutation.mutate({
                                              messageId: message.id,
                                              content: editDraft,
                                            })
                                          }
                                          className="press h-10 rounded-[8px] bg-primary px-3 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
                                        >
                                          {editMutation.isPending ? "Đang lưu…" : "Lưu"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingMessageId(null);
                                            setEditDraft("");
                                          }}
                                          className="press h-10 rounded-[8px] border border-border px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                                        >
                                          Huỷ
                                        </button>
                                      </div>
                                    </div>
                                  ) : recalled ? (
                                    /* A withdrawn message keeps its place in the thread but not
                                       its words — the gap is part of the honest record. */
                                    <div
                                      className={cn(
                                        "max-w-[80%] rounded-bubble border border-dashed border-border px-4 py-2.5 text-[14px] italic leading-relaxed text-muted-foreground",
                                        outgoing ? "rounded-br-[4px]" : "rounded-bl-[4px]",
                                      )}
                                    >
                                      {messageBodyText(message)}
                                    </div>
                                  ) : (
                                    <MessageActionsAffordance
                                      disabled={isSelecting}
                                      onSwipeReply={canReplyToMessage(message) ? () => setReplyTarget(message) : undefined}
                                      message={message}
                                      viewerId={userId}
                                      canRaiseTask={canRaiseTask}
                                      outgoing={outgoing}
                                      canPin={canPinThis}
                                      isPinned={isPinnedForMe}
                                      canRequestRecall={canRequestRecall}
                                      hasRequestedRecall={hasAskedRecall(message.id)}
                                      canForward={canForwardThis}
                                      canReport={activeKind !== "personal" && !outgoing && message.systemKind == null}
                                      onAction={(action) => handleMessageAction(message, action)}
                                      onQuickReact={canReact ? (emoji) => toggleReaction(message.id, emoji) : undefined}
                                      reactionPicker={
                                        canReact ? (
                                          <ReactionPicker
                                            label={message.content.slice(0, 40)}
                                            onPick={(emoji) => toggleReaction(message.id, emoji)}
                                          />
                                        ) : null
                                      }
                                    >
                                      {/*
                                        Files sit above the words, as their own blocks rather
                                        than inside the bubble: a photo boxed in a coloured
                                        speech bubble reads as decoration instead of content.
                                      */}
                                      {/*
                                        A forwarded message says so before it says anything
                                        else. Without this, someone else's words read as the
                                        forwarder's own — which is how a quote becomes a claim.
                                      */}
                                      {forwardedNote !== null ? (
                                        <span className="mb-1 block px-1 text-[11.5px] italic text-muted-foreground">
                                          {forwardedNote}
                                        </span>
                                      ) : null}
                                      <MessageAttachments
                                        attachments={attachmentsOf(message.id)}
                                        urlOf={attachmentUrlOf}
                                        outgoing={outgoing}
                                      />
                                      {/*
                                        A caption-less photo draws no bubble at all — an empty
                                        coloured rectangle under the image would be a bubble
                                        pretending there were words.
                                      */}
                                      {message.forwardBundle != null ? (
                                        <ForwardBundleCard bundle={message.forwardBundle} outgoing={outgoing} />
                                      ) : message.content.trim() === "" ? null : (
                                      <div
                                        className={cn(
                                          "whitespace-pre-wrap break-words rounded-bubble px-4 py-2.5 text-[15px] leading-relaxed",
                                          outgoing
                                            ? "rounded-br-[4px] bg-primary text-primary-foreground"
                                            : "rounded-bl-[4px] border border-border bg-card text-foreground",
                                          message.pending ? "opacity-70" : "",
                                          message.failed === true ? "cursor-pointer" : "",
                                          attachmentsOf(message.id).length > 0 ? "mt-1.5" : "",
                                        )}
                                        // A failed bubble is itself the retry: tapping it sends the same words again.
                                        onClick={
                                          message.failed === true
                                            ? () => {
                                                const localId = failedSendIdOf(message);
                                                if (localId !== null) retryFailedSend(localId);
                                              }
                                            : undefined
                                        }
                                      >
                                        {/*
                                          Only names that were genuinely recorded as mentions
                                          light up — driven by the stored ids, not by scanning
                                          the text for "@", so typing "@nobody" cannot fake the
                                          appearance of having named someone.
                                        */}
                                        {splitMentions(
                                          message.content,
                                          message.mentionedUserIds ?? [],
                                          (id) => senderNames.get(id) ?? "",
                                          userId,
                                        ).map((segment, segmentIndex) =>
                                          segment.mentionedUserId === null ? (
                                            // A posted call link (or any http link) can be tapped.
                                            <span key={segmentIndex}>
                                              {splitLinks(segment.text).map((part, partIndex) =>
                                                part.href === null ? (
                                                  <Fragment key={partIndex}>{part.text}</Fragment>
                                                ) : (
                                                  <a
                                                    key={partIndex}
                                                    href={part.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(event) => event.stopPropagation()}
                                                    className="break-all underline underline-offset-2"
                                                  >
                                                    {part.text}
                                                  </a>
                                                ),
                                              )}
                                            </span>
                                          ) : (
                                            <span
                                              key={segmentIndex}
                                              className={cn(
                                                "rounded-[3px] px-0.5 font-semibold",
                                                // Being named yourself is the one case worth
                                                // making unmissable.
                                                segment.isViewer
                                                  ? outgoing
                                                    ? "bg-primary-foreground/25"
                                                    : "bg-primary/20 text-primary"
                                                  : outgoing
                                                    ? "text-primary-foreground/85"
                                                    : "text-primary",
                                              )}
                                            >
                                              {segment.text}
                                            </span>
                                          ),
                                        )}
                                      </div>
                                      )}
                                    </MessageActionsAffordance>
                                  )}

                                  {activeKind === "personal" && !recalled
                                    ? (() => {
                                        const chips = entryChips({ content: message.content, attachments: attachmentsOf(message.id), hasTask: false });
                                        if (chips.files + chips.links === 0 || message.content.trim() === "") return null;
                                        return (
                                          <div className="mt-1 flex justify-end gap-1.5 text-[11.5px] text-muted-foreground">
                                            {chips.files > 0 ? (
                                              <button type="button" onClick={() => openDiaryView("files")} className="press rounded-full border border-border bg-card px-2 py-0.5 hover:text-foreground">
                                                {`📎${chips.files}`}
                                              </button>
                                            ) : null}
                                            {chips.links > 0 ? (
                                              <button type="button" onClick={() => openDiaryView("links")} className="press rounded-full border border-border bg-card px-2 py-0.5 hover:text-foreground">
                                                {`🔗${chips.links}`}
                                              </button>
                                            ) : null}
                                          </div>
                                        );
                                      })()
                                    : null}
                                  {/*
                                    Someone has asked the sender to take this back. Only the
                                    sender sees it, and it decides nothing: the two answers are
                                    "Thu hồi" in the menu above, or keeping the message as it is.
                                    Either way the ask stops — an unanswerable notice that never
                                    goes away would be a way of nagging rather than asking.
                                  */}
                                  {recallAskNote !== null ? (
                                    <div
                                      className={cn(
                                        "mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground",
                                        outgoing ? "justify-end" : "justify-start",
                                      )}
                                    >
                                      <Hand
                                        className="h-3.5 w-3.5 shrink-0"
                                        strokeWidth={1.8}
                                        aria-hidden="true"
                                      />
                                      <span>{recallAskNote}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void resolveRecallAsk(message.id).catch((error: unknown) =>
                                            toast.error(
                                              error instanceof Error
                                                ? error.message
                                                : "Không bỏ qua được đề nghị.",
                                            ),
                                          );
                                        }}
                                        className="press rounded-[6px] px-1.5 py-0.5 font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
                                      >
                                        Giữ nguyên
                                      </button>
                                    </div>
                                  ) : null}

                                  {/*
                                    What people said back without saying anything. Shown under
                                    the bubble rather than over it, so a busy message does not
                                    hide its own words.
                                  */}
                                  {canReact ? (
                                    <MessageReactions
                                      groups={reactionGroupsFor(message.id)}
                                      nameOf={(id) =>
                                        activeKind === "group"
                                          ? (senderNames.get(id) ?? "Thành viên")
                                          : threadTitle
                                      }
                                      viewerId={userId}
                                      outgoing={outgoing}
                                      onToggle={(emoji) => toggleReaction(message.id, emoji)}
                                    />
                                  ) : null}
                                  <span className="tabular mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                    {message.failed === true ? (
                                      <>
                                        {/* Amber and small, not red: nothing is lost, it just has not gone yet. */}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const localId = failedSendIdOf(message);
                                            if (localId !== null) retryFailedSend(localId);
                                          }}
                                          aria-label="Gửi lỗi. Chạm để gửi lại tin này"
                                          className="press inline-flex min-h-8 items-center gap-1 rounded-[6px] px-1 text-muted-foreground hover:text-foreground"
                                        >
                                          <CircleAlert className="h-3.5 w-3.5 text-task-due-soon" strokeWidth={1.9} aria-hidden="true" />
                                          Gửi lỗi · Chạm để gửi lại
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const localId = failedSendIdOf(message);
                                            if (localId !== null) discardFailedSend(localId);
                                          }}
                                          aria-label="Bỏ tin chưa gửi được này"
                                          className="press inline-flex min-h-8 items-center rounded-[6px] px-1 text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                                        >
                                          Bỏ
                                        </button>
                                      </>
                                    ) : message.pending ? (
                                      "Đang gửi…"
                                    ) : (
                                      formatClock(message.createdAt)
                                    )}
                                    {/* An edit is admitted out loud: a silent one would let
                                        someone change what they are on record as saying. */}
                                    {isEdited(message) ? <span>(đã chỉnh sửa)</span> : null}
                                    {/* Work that came out of this message. Nothing is shown
                                        when nothing came of it. */}
                                    {(() => {
                                      const mark = taskMarkFor(message.id);
                                      if (mark === null) return null;
                                      return (
                                        <MessageTaskDot
                                          summary={mark}
                                          onOpen={() => openTaskMark(mark)}
                                        />
                                      );
                                    })()}
                                    {outgoing && scheduledSentIds.has(message.id) ? (
                                      <span title="Đã gửi theo hẹn giờ" aria-label="Đã gửi theo hẹn giờ" className="flex items-center">
                                        <Clock3 className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                                      </span>
                                    ) : null}
                                    {showsReceipt ? (
                                      <span className="flex items-center gap-1">
                                        <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                        {sendReceiptLabel(message)}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </li>
                              {skipNotices.map((notice) => (
                                <li
                                  key={`skip-${notice.taskId}`}
                                  className="px-4 py-1 text-center text-[12.5px] italic leading-5 text-muted-foreground"
                                >
                                  {silentSkipNote(skipActorName(notice.assigneeId))}
                                </li>
                              ))}
                              </Fragment>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/*
                While picking, the selection bar takes the spot the jump-to-newest pill uses.
                Both floating at once would overlap, and the one the person is actively using
                wins.
              */}
              {isSelecting ? (
                <SelectionBar
                  count={selectedIds.length}
                  canDelete={activeKind === "personal"}
                  onForward={() => setIsForwardOpen(true)}
                  onCreateTask={
                    activeVerification === null && !isNoLongerConnected ? openTaskFromSelection : undefined
                  }
                  onDelete={confirmDeleteSelected}
                  onCancel={cancelSelection}
                  isWorking={deleteJournalMutation.isPending}
                />
              ) : null}

              {/* A quiet way back to the live end: only offered while the reader has left it. */}
              {!isSelecting && !isThreadAtBottom && messages.length > 0 ? (
                <button
                  type="button"
                  onClick={jumpToNewest}
                  className={cn(
                    "press absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors animate-bubble-in",
                    missedMessages > 0
                      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/92"
                      : "border-border bg-card text-foreground hover:bg-accent/50",
                  )}
                >
                  <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  {formatMissedMessages(missedMessages)}
                </button>
              ) : null}
              </div>
              )}

              {isDiaryAside ? null : (
              <div className="border-t border-border bg-card px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 md:px-10 md:py-4">
                {/*
                  What the next message will answer, shown before it is sent so nobody replies
                  to the wrong thing. Dismissable, because changing your mind about replying is
                  more common than changing your mind about the words.
                */}
                {replyTarget !== null ? (
                  <div className="mx-auto mb-2 flex max-w-2xl items-start gap-2 rounded-[10px] border-l-2 border-primary/60 bg-secondary/50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] font-medium text-muted-foreground">
                        Đang trả lời {senderNameOf(replyTarget)}
                      </p>
                      <p
                        className={cn(
                          "line-clamp-2 text-[12.5px]",
                          isRecalled(replyTarget) ? "italic text-muted-foreground" : "text-foreground/80",
                        )}
                      >
                        {quotePreview(replyTarget)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyTarget(null)}
                      aria-label="Bỏ trả lời"
                      className="press shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {isProjectChatClosed ? (
                  <p className="mx-auto max-w-2xl rounded-md border border-border bg-secondary/40 px-4 py-3 text-center text-[13.5px] text-muted-foreground">
                    Dự án đã đóng nên cuộc trò chuyện chỉ còn để đọc. Người mở dự án có thể mở lại bất cứ lúc nào.
                  </p>
                ) : isNoLongerConnected && !hasBlockedPeer ? (
                  /* AVORA-38: history stays readable; sending needs the pair to be bạn again. */
                  <p className="mx-auto max-w-2xl rounded-md border border-border bg-secondary/40 px-4 py-3 text-center text-[13.5px] text-muted-foreground">
                    {NOT_CONNECTED_NOTICE} Kết bạn lại qua PIN để nhắn tiếp.
                  </p>
                ) : hasBlockedPeer ? (
                  /*
                    The blocker's side (AVORA-37 / A): history stays readable above, and the box
                    gives way to the one thing that can be done here — undo the block.
                  */
                  <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-4 py-2.5">
                    <p className="min-w-0 text-[13.5px] text-muted-foreground">Bạn đã chặn {threadTitle}.</p>
                    <button
                      type="button"
                      onClick={handleUnblock}
                      disabled={isBlockWorking}
                      className="press h-11 shrink-0 rounded-[10px] border border-border bg-card px-4 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:opacity-50"
                    >
                      Bỏ chặn
                    </button>
                  </div>
                ) : (
                <>
                {activeVerification !== null && conversationId && userId ? (
                  <VerificationPanel conversationId={conversationId} verification={activeVerification} viewerId={userId} />
                ) : null}
                <MessageComposer
                  value={draft}
                  onValueChange={(next) => {
                    setDraft(next);
                    // Typing is announced from the keystroke, and stopped the moment the box
                    // empties — a cleared draft is someone who changed their mind, and leaving
                    // the indicator up would misreport that for the next few seconds.
                    if (next.trim() === "") clearTyping();
                    else notifyTyping();
                  }}
                  onSend={handleSend}
                  onStartRecording={!recorder.isUnsupported && !recorder.isRecording && activeVerification === null ? startRecording : undefined}
                  isSending={sendMutation.isPending || isUploading}
                  placeholder={activeKind === "personal" ? "Ghi vào nhật ký…" : `Nhắn tin cho ${threadTitle}…`}
                  ariaLabel={activeKind === "personal" ? "Ghi vào nhật ký" : `Nhắn tin cho ${threadTitle}`}
                  mentionCandidates={mentionable}
                  attachmentCount={staged.length}
                  attachmentSlot={
                    <StagedAttachmentBar
                      items={staged}
                      onRemove={removeStaged}
                      onPermissionChange={setStagedPermission}
                      isSending={sendMutation.isPending || isUploading}
                    />
                  }
                  trailingAction={
                    <>
                      {/*
                        Hidden rather than styled: a file input cannot be made to look like
                        the rest of the composer, so the "+" menu drives it instead.
                      */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                          const chosen = Array.from(event.target.files ?? []);
                          // Reset first, so choosing the same file twice still fires.
                          event.target.value = "";
                          void stageFiles(chosen);
                        }}
                      />
                      {/* Only while recording: the timer and stop/cancel need to stay in reach. */}
                      {recorder.isRecording ? (
                        <AttachActions
                          onPickFiles={() => fileInputRef.current?.click()}
                          isRecording={recorder.isRecording}
                          elapsedSeconds={recorder.elapsedSeconds}
                          canRecord={!recorder.isUnsupported}
                          onStartRecording={startRecording}
                          onStopRecording={stopRecording}
                          onCancelRecording={recorder.cancel}
                          disabled={sendMutation.isPending || isUploading}
                        />
                      ) : null}
                    </>
                  }
                  leadingAction={
                    activeVerification !== null ? null : (
                    <>
                      <ComposerPlusMenu
                        onPickFiles={() => fileInputRef.current?.click()}
                        onStartRecording={startRecording}
                        canRecord={!recorder.isUnsupported}
                        onCreateTask={() => openTaskDialogFor(null)}
                        createTaskLabel="Tạo nhiệm vụ"
                        disabled={sendMutation.isPending || isUploading || recorder.isRecording}
                        schedule={
                          canSchedule
                            ? {
                                onSelect: () => setIsScheduleOpen(true),
                                note: staged.length > 0 ? "Hẹn giờ chỉ gửi được chữ" : draft.trim() === "" ? "Gõ tin trước" : null,
                              }
                            : undefined
                        }
                      />
                    </>
                    )
                  }
                />
                {refusedSendConversationId === conversationId ? (
                  <p role="status" className="mx-auto mt-2 max-w-2xl text-[12.5px] text-muted-foreground">
                    {BLOCKED_SEND_NOTICE}
                  </p>
                ) : null}
                </>
                )}
              </div>
              )}
            </>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            {activeTab === "group" ? (
              <Users className="h-16 w-16 text-foreground/80" strokeWidth={1.2} />
            ) : (
              <MessageSquarePlus className="h-16 w-16 text-foreground/80" strokeWidth={1.2} />
            )}
            <h2 className="mt-8 text-[26px] font-semibold tracking-tight text-foreground">
              {activeTab === "group" ? "Chọn một nhóm" : "Chọn một người để trò chuyện"}
            </h2>
            <p className="mt-2 text-[15px] text-muted-foreground">
              {activeTab === "group"
                ? "Hoặc tạo nhóm mới với bạn bè của bạn"
                : "Hoặc kết bạn qua PIN / QR để bắt đầu"}
            </p>
            <button
              type="button"
              onClick={() => (activeTab === "group" ? setIsNewGroupOpen(true) : setIsNewChatOpen(true))}
              className="press mt-7 rounded-md bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/92"
            >
              {activeTab === "group" ? "Tạo nhóm" : "Trò chuyện mới"}
            </button>
          </div>
        )}
      </section>

      <NewChatDialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen} onCreated={openConversation} />
      <NewGroupDialog
        open={isNewGroupOpen}
        onOpenChange={setIsNewGroupOpen}
        onCreated={openConversation}
        onConnectByPin={() => {
          setIsNewGroupOpen(false);
          setIsNewChatOpen(true);
        }}
      />

      {/*
        Forwarding leaves the selection behind once it succeeds: the messages have gone where
        they were going, and keeping the ticks would invite sending them twice.
      */}
      <ForwardDialog
        open={isForwardOpen}
        onOpenChange={(next) => {
          setIsForwardOpen(next);
          // Closing the picker without choosing keeps the ticks, so a mis-tap costs nothing.
          if (!next && !isSelecting) setSelectedIds([]);
        }}
        messageIds={selectedIds}
        previewLines={forwardPreviewLines}
        conversations={conversations}
        currentConversationId={conversationId}
        onForwarded={() => {
          cancelSelection();
          void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
        }}
      />

      <ScheduleMessageDialog
        open={isScheduleOpen}
        onOpenChange={setIsScheduleOpen}
        content={draft}
        isWorking={scheduleActions.schedule.isPending}
        onSubmit={(at) => {
          const content = draft.trim();
          if (content === "") return;
          void scheduleActions.schedule
            .mutateAsync({
              content,
              sendAt: at,
              mentionedIds: extractMentionedIds(content, mentionable),
              replyToId: replyTarget?.id ?? null,
            })
            .then(() => {
              setDraft("");
              setReplyTarget(null);
              setIsScheduleOpen(false);
              toast.success(`Đã hẹn gửi lúc ${sendAtLine(at)}.`);
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Không hẹn giờ được."));
        }}
      />

      <BlockConfirmDialog
        name={threadTitle}
        open={isBlockConfirmOpen}
        onOpenChange={setIsBlockConfirmOpen}
        onConfirm={confirmBlock}
        isWorking={isBlockWorking}
      />
      <ReportDialog
        target={reportTarget}
        open={reportTarget !== null}
        onOpenChange={(next) => {
          if (!next) setReportTarget(null);
        }}
        isBlockedAlready={reportTarget !== null && isUserBlocked(reportTarget.userId)}
        onSubmit={(input) => {
          if (reportTarget === null) return;
          reportMutation.mutate({ target: reportTarget, ...input });
        }}
        isWorking={reportMutation.isPending}
      />

      {/* Projects open only in a group (ADR-002); the strip that opens this dialog is group-only. */}
      <NewProjectDialog
        open={projectTarget !== null}
        onOpenChange={(next) => {
          if (!next) setProjectTarget(null);
        }}
        conversationId={projectTarget?.conversationId}
        conversationLabel={projectTarget === null ? "" : conversationTitle(projectTarget)}
        onCreated={(projectId) => {
          setProjectTarget(null);
          navigate(projectLink(projectId));
        }}
      />

      {pasteDialog}
      <NoteExits task={noteTaskExit} board={noteBoardExit} onTaskClose={() => setNoteTaskExit(null)} onBoardClose={() => setNoteBoardExit(null)} />
      <TaskDetailSheet
        task={openedSourceTask}
        today={todayIso()}
        open={openedSourceTask !== null}
        onOpenChange={(next) => {
          if (!next) setOpenedSourceTaskId(null);
        }}
      />

      {conversationId && activeVerification === null ? (
        <TaskFromChatDialog
          open={isTaskDialogOpen}
          onOpenChange={(next) => {
            setIsTaskDialogOpen(next);
            // Closing forgets the chosen bubble, so the next task starts from the thread's end.
            if (!next) {
              setTaskSourceMessage(null);
              setTaskSelection(null);
            }
          }}
          selection={taskSelection}
          onCreated={taskSelection !== null ? cancelSelection : undefined}
          conversationId={conversationId}
          conversationKind={activeKind}
          conversationName={threadTitle}
          peerId={activeSummary?.peerId ?? peerQuery.data?.peerId ?? null}
          peerName={threadTitle}
          members={groupMembersQuery.data ?? []}
          contextMessage={taskContextMessage}
          contextSenderName={senderNameOf(taskContextMessage)}
          projectId={projectHere?.id ?? null}
        />
      ) : null}

      {/*
        Only an officer in a group ever sees this: everyone else has one possible answer, so
        asking would be a question with a single button.
      */}
      <PinChoiceDialog
        open={pinChoiceMessageId !== null}
        onOpenChange={(next) => {
          if (!next) setPinChoiceMessageId(null);
        }}
        groupFull={isPinQuotaFull("group")}
        personalFull={isPinQuotaFull("personal")}
        onChoose={(scope) => {
          const messageId = pinChoiceMessageId;
          setPinChoiceMessageId(null);
          if (messageId === null) return;
          void addPin(messageId, scope)
            .then(() =>
              toast.success(scope === "group" ? "Đã ghim cho cả nhóm." : "Đã ghim riêng cho bạn."),
            )
            .catch((error: unknown) =>
              toast.error(error instanceof Error ? error.message : "Không ghim được."),
            );
        }}
      />

      {conversationId && activeKind === "group" ? (
        <GroupTaskListSheet
          open={isGroupTasksOpen}
          onOpenChange={setIsGroupTasksOpen}
          conversationId={conversationId}
          groupName={threadTitle}
          members={groupMembersQuery.data ?? []}
          projectId={projectHere?.id ?? null}
          onFocusTask={(taskId) => {
            setFocusedSuggestionId(null);
            const next = new URLSearchParams(searchParams);
            next.set(CONTEXT_TASK_PARAM, taskId);
            setSearchParams(next, { replace: true });
          }}
          onFocusSuggestion={(suggestionId) => setFocusedSuggestionId(suggestionId)}
        />
      ) : null}

      {conversationId && activeKind === "group" ? (
        <ScheduleCallDialog
          open={isScheduleCallOpen}
          onOpenChange={setIsScheduleCallOpen}
          placeName={projectHere !== undefined ? `dự án ${projectHere.title}` : threadTitle}
          onPost={(content) => sendPlainMessage(content)}
        />
      ) : null}

      {conversationId && activeKind === "group" ? (
        <GroupDecisionSheet
          open={isDecisionsOpen}
          onOpenChange={setIsDecisionsOpen}
          conversationId={conversationId}
          groupName={threadTitle}
          members={groupMembersQuery.data ?? []}
        />
      ) : null}

      {conversationId && activeKind === "personal" ? (
        <JournalTrashSheet conversationId={conversationId} open={isJournalTrashOpen} onOpenChange={setIsJournalTrashOpen} />
      ) : null}

      {conversationId ? (
        <GroupInfoSheet
          conversationId={conversationId}
          open={isInfoOpen}
          onOpenChange={setIsInfoOpen}
          peerName={threadTitle}
          peerId={
            activeKind === "direct"
              ? (activeSummary?.peerId ?? peerQuery.data?.peerId ?? null)
              : null
          }
          onOpenConversation={openConversation}
          onLeft={() => navigate("/tin-nhan")}
          kind={activeKind === "personal" ? "personal" : activeKind === "group" ? "group" : "direct"}
          moreSections={
            activeKind === "personal" ? (
              <ConversationMoreSections
                conversationId={null}
                placeLabel="Nhật ký"
                kind="personal"
                trash={{
                  count: journalTrashCount,
                  onOpen: () => {
                    setIsInfoOpen(false);
                    setIsJournalTrashOpen(true);
                  },
                }}
                onNavigate={() => setIsInfoOpen(false)}
              />
            ) : activeSummary !== undefined && (activeKind === "direct" || activeKind === "group") ? (
              <ConversationMoreSections
                conversationId={conversationId}
                placeLabel={threadTitle}
                kind={activeKind}
                projects={threadProjects}
                showProjects={projectHere === undefined}
                canCreateProjectReason={
                  myGroupRole === "owner" || myGroupRole === "admin" ? null : "Chỉ chủ nhóm hoặc quản trị viên được mở dự án."
                }
                onNewProject={() => {
                  setIsInfoOpen(false);
                  setProjectTarget(activeSummary);
                }}
                onOpenDecisions={() => {
                  setIsInfoOpen(false);
                  setIsDecisionsOpen(true);
                }}
                onOpenTasks={
                  activeKind === "group"
                    ? () => {
                        setIsInfoOpen(false);
                        setIsGroupTasksOpen(true);
                      }
                    : undefined
                }
                onSearch={() => {
                  setIsInfoOpen(false);
                  setIsSearchOpen(true);
                }}
                onScheduleCall={
                  activeKind === "group" && !isProjectChatClosed
                    ? () => {
                        setIsInfoOpen(false);
                        setIsScheduleCallOpen(true);
                      }
                    : undefined
                }
                onNavigate={() => setIsInfoOpen(false)}
                safety={
                  directPeerId !== null
                    ? {
                        peerName: threadTitle,
                        isBlocked: hasBlockedPeer,
                        onBlock: () => {
                          setIsInfoOpen(false);
                          setIsBlockConfirmOpen(true);
                        },
                        onUnblock: handleUnblock,
                        onReport: () => {
                          setIsInfoOpen(false);
                          setReportTarget({
                            userId: directPeerId,
                            name: threadTitle,
                            conversationId: conversationId ?? null,
                            message: null,
                          });
                        },
                        isWorking: isBlockWorking,
                      }
                    : undefined
                }
              />
            ) : null
          }
        />
      ) : null}
    </div>
  );
};

export default Messages;
