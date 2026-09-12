import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  Check,
  CheckCheck,
  ChevronLeft,
  Info,
  ListPlus,
  ListTodo,
  MessageSquarePlus,
  NotebookPen,
  Phone,
  Search,
  SquarePen,
  UserRound,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { NewChatDialog } from "@/components/NewChatDialog";
import { NewGroupDialog } from "@/components/NewGroupDialog";
import { ChatTaskPanel } from "@/components/chat/ChatTaskPanel";
import { GroupInfoSheet } from "@/components/chat/GroupInfoSheet";
import { GroupTaskListSheet } from "@/components/chat/GroupTaskListSheet";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { MessageTaskAffordance } from "@/components/chat/MessageTaskButton";
import { TaskFromChatDialog } from "@/components/chat/TaskFromChatDialog";
import { useAuth } from "@/lib/auth";
import { useChatRealtime } from "@/lib/realtime";
import { useConversations } from "@/lib/use-conversations";
import { useDocumentVisible } from "@/lib/use-document-visible";
import {
  chatKeys,
  clearUnread,
  conversationSubtitle,
  conversationTitle,
  ensureJournalConversation,
  fetchConversationPeer,
  fetchMessages,
  filterConversationsByTab,
  formatClock,
  formatInboxTime,
  formatMissedMessages,
  formatUnreadBadge,
  groupMessagesByDay,
  isNearThreadBottom,
  isSeenByPeer,
  lastOutgoingId,
  markConversationRead,
  matchesConversationQuery,
  MESSAGE_TABS,
  sendMessage,
  tabOfKind,
  threadScrollDecision,
  unreadForTab,
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
  type MessageTab,
} from "@/lib/chat";
import { fetchGroupMembers, groupKeys } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import {
  CONTEXT_TASK_PARAM,
  DELETED_MESSAGE_NOTE,
  isOriginalMessageMissing,
} from "@/lib/task-context";
import { useTasks } from "@/lib/use-tasks";
import { cn } from "@/lib/utils";

/**
 * Realtime is the delivery path. This interval only engages while the socket is down
 * (blocked websockets, flaky network) so the app degrades instead of going silent.
 */
const OFFLINE_THREAD_POLL_MS = 5_000;

const Messages = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId: string | undefined = user?.id;
  const { isLive, setReadingConversation } = useChatRealtime();
  const isTabVisible = useDocumentVisible();

  const [query, setQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<MessageTab>("direct");
  const [isNewChatOpen, setIsNewChatOpen] = useState<boolean>(false);
  const [isNewGroupOpen, setIsNewGroupOpen] = useState<boolean>(false);
  const [isInfoOpen, setIsInfoOpen] = useState<boolean>(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState<boolean>(false);
  const [isGroupTasksOpen, setIsGroupTasksOpen] = useState<boolean>(false);
  /**
   * The message a new task will quote. Null means "whatever was said last", which is what the
   * button beside the composer means; a bubble's own action names that bubble instead.
   */
  const [taskSourceMessage, setTaskSourceMessage] = useState<ChatMessage | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [searchParams] = useSearchParams();
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is watching the live end of the thread, and how many messages have
  // landed since they last were — together they decide the jump-to-newest pill.
  const [isThreadAtBottom, setIsThreadAtBottom] = useState<boolean>(true);
  const [missedMessages, setMissedMessages] = useState<number>(0);

  const conversationsQuery = useConversations();

  const conversations: ConversationSummary[] = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data]);

  /** The chosen direction first, then the search box within it. */
  const tabConversations: ConversationSummary[] = useMemo(
    () => filterConversationsByTab(conversations, activeTab),
    [conversations, activeTab],
  );

  const visibleConversations: ConversationSummary[] = useMemo(
    () => tabConversations.filter((item) => matchesConversationQuery(item, query)),
    [tabConversations, query],
  );

  const activeSummary: ConversationSummary | undefined = useMemo(
    () => conversations.find((item) => item.conversationId === conversationId),
    [conversations, conversationId],
  );

  // A thread can be opened straight from its URL before the inbox has loaded.
  const peerQuery = useQuery({
    queryKey: chatKeys.peer(conversationId ?? ""),
    queryFn: () => fetchConversationPeer(conversationId as string),
    enabled: Boolean(conversationId) && Boolean(userId) && activeSummary === undefined,
  });

  const messagesQuery = useQuery<ChatMessage[]>({
    queryKey: chatKeys.messages(conversationId ?? ""),
    queryFn: () => fetchMessages(conversationId as string),
    enabled: Boolean(conversationId) && Boolean(userId),
    refetchInterval: isLive ? false : OFFLINE_THREAD_POLL_MS,
  });

  const peerName: string = activeSummary?.peerName ?? peerQuery.data?.peerName ?? "Cuộc trò chuyện";
  const peerEmail: string | null = activeSummary?.peerEmail ?? peerQuery.data?.peerEmail ?? null;

  const activeKind: ConversationKind = activeSummary?.kind ?? "direct";
  const threadTitle: string = activeSummary ? conversationTitle(activeSummary) : peerName;
  const threadSubtitle: string = activeSummary
    ? conversationSubtitle(activeSummary)
    : (peerEmail ?? "Người dùng AVORA");

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
      names.set(member.userId, peerLabel(member.displayName, member.email));
    }
    return names;
  }, [groupMembersQuery.data]);

  const messages: ChatMessage[] = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const dayGroups = useMemo(() => groupMessagesByDay(messages), [messages]);
  const peerLastReadAt: string | null = activeSummary?.peerLastReadAt ?? null;
  const lastOwnMessageId: string | null = useMemo(
    () => (userId ? lastOutgoingId(messages, userId) : null),
    [messages, userId],
  );

  const newestMessage: ChatMessage | null = messages.length > 0 ? messages[messages.length - 1] : null;

  // Arriving from "Xem trong ngữ cảnh": which task sent us here, and what it remembers.
  const highlightTaskId: string | null = searchParams.get(CONTEXT_TASK_PARAM);
  const { data: allTasks } = useTasks();
  const highlightTask = useMemo(
    () => (allTasks ?? []).find((task) => task.id === highlightTaskId) ?? null,
    [allTasks, highlightTaskId],
  );
  const highlightSnapshot = highlightTask?.contextSnapshot ?? null;
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const isQuotedMessageGone: boolean =
    highlightSnapshot !== null &&
    !messagesQuery.isPending &&
    isOriginalMessageMissing(highlightSnapshot, messageIds);
  const quotedMessageId: string | null = isQuotedMessageGone
    ? null
    : (highlightSnapshot?.originalMessageId ?? null);

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

  const handleThreadScroll = useCallback((): void => {
    const node = threadScrollRef.current;
    if (!node) return;
    const nearBottom = isNearThreadBottom({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    });
    setIsThreadAtBottom(nearBottom);
    // Reaching the end reads whatever was waiting there, so the pill has nothing left to say.
    if (nearBottom) setMissedMessages(0);
  }, []);

  const jumpToNewest = useCallback((): void => {
    scrollThreadToBottom("smooth");
    setMissedMessages(0);
    setIsThreadAtBottom(true);
  }, [scrollThreadToBottom]);

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
    onError: (error: Error, id: string) => {
      // Allow a later attempt; the badge comes back from the server.
      delete markedRef.current[id];
      console.error(`[chat] mark read failed: ${error.message}`);
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

  const sendMutation = useMutation({
    mutationFn: async (content: string): Promise<ChatMessage> => {
      if (!conversationId || !userId) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
      return sendMessage(conversationId, userId, content);
    },
    onMutate: async (content: string) => {
      if (!conversationId || !userId) return { previous: undefined };
      const key = chatKeys.messages(conversationId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatMessage[]>(key);
      const optimistic: ChatMessage = {
        id: `pending-${Date.now()}`,
        conversationId,
        senderId: userId,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        pending: true,
      };
      queryClient.setQueryData<ChatMessage[]>(key, [...(previous ?? []), optimistic]);
      return { previous };
    },
    onError: (error: Error, _content, context) => {
      if (conversationId && context?.previous) {
        queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(conversationId), context.previous);
      }
      toast.error(error.message);
    },
    onSettled: () => {
      if (conversationId) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
    },
  });

  /** The composer hands over an already-trimmed message; the send path itself is unchanged. */
  const handleSend = useCallback(
    (content: string): void => {
      if (content.length === 0 || sendMutation.isPending) return;
      setDraft("");
      sendMutation.mutate(content);
    },
    [sendMutation],
  );

  const openConversation = useCallback(
    (nextId: string): void => {
      navigate(`/tin-nhan/${nextId}`);
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
      navigate(`/tin-nhan/${journalId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * A tab is a choice of direction. Nhật ký has exactly one possible thread, so it opens
   * straight away; the other two put the chooser back in front of the user.
   */
  const handleSelectTab = useCallback(
    (tab: MessageTab): void => {
      setActiveTab(tab);
      setQuery("");

      if (tab !== "journal") {
        navigate("/tin-nhan");
        return;
      }

      const existing = conversations.find((item) => item.kind === "personal");
      if (existing) {
        navigate(`/tin-nhan/${existing.conversationId}`);
        return;
      }
      // First visit on this account: the journal is created on demand.
      journalMutation.mutate();
    },
    [conversations, navigate, journalMutation],
  );

  // Opening a thread by link (or the "Nhắn riêng" jump out of a group) must land on the tab
  // that thread actually belongs to, or the list beside it would contradict the header.
  useEffect(() => {
    if (!activeSummary) return;
    setActiveTab(tabOfKind(activeSummary.kind));
  }, [activeSummary]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col md:flex-row">
      <section
        className={cn(
          "flex min-h-0 w-full flex-col border-border bg-card md:w-[320px] md:shrink-0 md:border-r lg:w-[360px]",
          conversationId ? "hidden md:flex" : "flex",
        )}
        aria-label="Danh sách cuộc trò chuyện"
      >
        <div className="px-6 pb-4 pt-7">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Tin nhắn</h1>
            {!isLive ? (
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Đang kết nối lại
              </span>
            ) : null}
            <div className="flex items-center gap-2">
              {/* Liên hệ left the main rail: the people you talk to belong beside the talking. */}
              <Link
                to="/lien-he"
                aria-label="Liên hệ"
                title="Liên hệ"
                className="press rounded-md border border-border p-2.5 text-foreground transition-colors hover:bg-accent/50"
              >
                <UserRound className="h-[18px] w-[18px]" strokeWidth={1.6} aria-hidden="true" />
              </Link>
              {activeTab === "group" ? (
                <button
                  type="button"
                  aria-label="Tạo nhóm mới"
                  onClick={() => setIsNewGroupOpen(true)}
                  className="press rounded-md border border-border p-2.5 text-foreground transition-colors hover:bg-accent/50"
                >
                  <Users className="h-[18px] w-[18px]" strokeWidth={1.6} />
                </button>
              ) : activeTab === "direct" ? (
                <button
                  type="button"
                  aria-label="Trò chuyện mới"
                  onClick={() => setIsNewChatOpen(true)}
                  className="press rounded-md border border-border p-2.5 text-foreground transition-colors hover:bg-accent/50"
                >
                  <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.6} />
                </button>
              ) : null}
            </div>
          </div>

          <div role="tablist" aria-label="Hướng trò chuyện" className="mt-5 flex items-center border-b border-border">
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
                    "press relative flex flex-1 items-center justify-center gap-1.5 px-2 pb-2.5 pt-1 text-[13.5px] transition-colors",
                    isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
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

          {activeTab === "journal" ? null : (
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
                placeholder={activeTab === "group" ? "Tìm nhóm" : "Tìm người hoặc email"}
                className="h-11 w-full rounded-md border border-border bg-card pl-11 pr-4 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
            </label>
          )}
        </div>

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
                    : activeTab === "journal"
                      ? "Đang mở nhật ký của bạn…"
                      : "Chưa có cuộc trò chuyện nào. Bắt đầu bằng email của một người dùng AVORA."}
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
                  className="press mt-3 rounded-md border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40"
                >
                  Trò chuyện mới
                </button>
              ) : null}
            </div>
          ) : (
            <ul>
              {visibleConversations.map((item) => {
                const isActive = item.conversationId === conversationId;
                const isUnread = item.unreadCount > 0;
                const preview =
                  item.lastMessageContent === null
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
                              item.lastMessageContent === null
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
      </section>

      <section className={cn("paper min-h-0 flex-1 flex-col", conversationId ? "flex" : "hidden md:flex")}>
        {conversationId ? (
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
                Về Tin nhắn
              </button>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
                <button
                  type="button"
                  aria-label="Quay lại Tin nhắn"
                  onClick={() => navigate("/tin-nhan")}
                  className="press rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground md:hidden"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={1.6} />
                </button>
                {activeKind === "personal" ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    <NotebookPen className="h-[17px] w-[17px]" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                ) : (
                  <InitialsAvatar name={threadTitle} size="sm" />
                )}
                <div className="min-w-0">
                  <p className="flex min-w-0 items-center gap-1.5 truncate text-[16px] font-semibold text-foreground">
                    {activeKind === "group" ? (
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                    ) : null}
                    {threadTitle}
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">{threadSubtitle}</p>
                </div>
                <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                  {activeKind === "group" ? (
                    <button
                      type="button"
                      aria-label="Danh sách nhiệm vụ nhóm"
                      title="Danh sách nhiệm vụ nhóm"
                      onClick={() => setIsGroupTasksOpen(true)}
                      className="press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground"
                    >
                      <ListTodo className="h-[19px] w-[19px]" strokeWidth={1.6} />
                    </button>
                  ) : null}
                  {activeKind === "personal" ? null : (
                  <>
                  <button
                    type="button"
                    aria-label="Gọi thoại"
                    className="press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <Phone className="h-[19px] w-[19px]" strokeWidth={1.6} />
                  </button>
                  <button
                    type="button"
                    aria-label="Thông tin cuộc trò chuyện"
                    onClick={() => setIsInfoOpen(true)}
                    className="press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <Info className="h-[19px] w-[19px]" strokeWidth={1.6} />
                  </button>
                  </>
                  )}
                </div>
              </header>

              {!isLive ? (
                <p
                  role="status"
                  className="border-b border-border bg-accent/40 px-5 py-2 text-center text-[12px] text-muted-foreground md:px-10"
                >
                  Chưa kết nối trực tiếp — tạm thời tải lại tin nhắn mỗi 5 giây.
                </p>
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

              <div className="relative min-h-0 flex-1">
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
                    {dayGroups.map((group) => (
                      <div key={group.key}>
                        <p className="mb-6 text-center text-[13px] text-muted-foreground">{group.label}</p>
                        <ul className="flex flex-col gap-3">
                          {group.messages.map((message, index) => {
                            const outgoing = message.senderId === userId;
                            // A journal has no reader but the writer, so a delivery receipt
                            // would be answering a question nobody asked.
                            const showsReceipt =
                              outgoing &&
                              message.id === lastOwnMessageId &&
                              message.pending !== true &&
                              activeKind !== "personal";
                            const seen = showsReceipt && isSeenByPeer(message, peerLastReadAt);
                            const showsSender = !outgoing && activeKind === "group";
                            const senderLabel = showsSender
                              ? (senderNames.get(message.senderId) ?? "Thành viên")
                              : null;
                            // Work is agreed as often by the reply as by the request, so a task
                            // can be raised from either side's bubble — but not from a journal
                            // note (no one to give it to) or a message still in flight.
                            const canRaiseTask = activeKind !== "personal" && message.pending !== true;
                            return (
                              <li
                                key={message.id}
                                id={`message-${message.id}`}
                                style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
                                className={cn(
                                  "group flex animate-bubble-in scroll-mt-8 rounded-bubble transition-colors",
                                  outgoing ? "flex-col items-end" : "items-end gap-2.5",
                                  // The message a task was raised from, pointed out on arrival.
                                  quotedMessageId === message.id ? "bg-primary/10 ring-1 ring-primary/40" : "",
                                )}
                              >
                                {senderLabel ? (
                                  <div className="shrink-0 pb-5" aria-hidden="true">
                                    <InitialsAvatar name={senderLabel} size="sm" />
                                  </div>
                                ) : null}
                                <div
                                  className={cn(
                                    "flex min-w-0 flex-col",
                                    outgoing ? "items-end" : "items-start",
                                  )}
                                >
                                  {senderLabel ? (
                                    <span className="mb-1 px-1 text-[12px] font-medium text-muted-foreground">
                                      {senderLabel}
                                    </span>
                                  ) : null}
                                  {canRaiseTask ? (
                                    <MessageTaskAffordance
                                      outgoing={outgoing}
                                      messageLabel={message.content.slice(0, 60)}
                                      onCreateTask={() => openTaskDialogFor(message)}
                                    >
                                      <div
                                        className={cn(
                                          "whitespace-pre-wrap break-words rounded-bubble px-4 py-2.5 text-[15px] leading-relaxed",
                                          outgoing
                                            ? "rounded-br-[4px] bg-primary text-primary-foreground"
                                            : "rounded-bl-[4px] border border-border bg-card text-foreground",
                                        )}
                                      >
                                        {message.content}
                                      </div>
                                    </MessageTaskAffordance>
                                  ) : (
                                    <div
                                      className={cn(
                                        "max-w-[80%] whitespace-pre-wrap break-words rounded-bubble px-4 py-2.5 text-[15px] leading-relaxed",
                                        outgoing
                                          ? "rounded-br-[4px] bg-primary text-primary-foreground"
                                          : "rounded-bl-[4px] border border-border bg-card text-foreground",
                                        message.pending ? "opacity-70" : "",
                                      )}
                                    >
                                      {message.content}
                                    </div>
                                  )}
                                  <span className="tabular mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                    {message.pending ? "Đang gửi…" : formatClock(message.createdAt)}
                                    {showsReceipt ? (
                                      <span className="flex items-center gap-1">
                                        {seen ? (
                                          <CheckCheck className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                        ) : (
                                          <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                                        )}
                                        {seen ? "Đã xem" : "Đã gửi"}
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* A quiet way back to the live end: only offered while the reader has left it. */}
              {!isThreadAtBottom && messages.length > 0 ? (
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

              {activeKind === "personal" ? null : (
                <ChatTaskPanel
                  conversationId={conversationId}
                  peerName={threadTitle}
                  members={groupMembersQuery.data ?? []}
                  highlightTaskId={highlightTaskId}
                  // A group keeps this panel to the viewer's own work; the room's full list
                  // opens from the header. A 1-1 has only two people, so it stays whole.
                  scope={activeKind === "group" ? "mine" : "all"}
                />
              )}

              <div className="border-t border-border bg-card px-5 py-4 md:px-10">
                <MessageComposer
                  value={draft}
                  onValueChange={setDraft}
                  onSend={handleSend}
                  isSending={sendMutation.isPending}
                  placeholder={activeKind === "personal" ? "Ghi vào nhật ký…" : `Nhắn tin cho ${threadTitle}…`}
                  ariaLabel={activeKind === "personal" ? "Ghi vào nhật ký" : `Nhắn tin cho ${threadTitle}`}
                  leadingAction={
                    activeKind === "personal" ? undefined : (
                      <button
                        type="button"
                        onClick={() => openTaskDialogFor(null)}
                        aria-label="Tạo tác vụ từ cuộc trò chuyện này"
                        title="Tạo tác vụ từ cuộc trò chuyện này"
                        className="press flex h-12 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[14px] font-medium text-foreground transition-colors hover:bg-accent/50 sm:px-4"
                      >
                        <ListPlus className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                        <span className="hidden sm:inline">Tác vụ</span>
                      </button>
                    )
                  }
                />
              </div>
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
                ? "Hoặc tạo nhóm mới và thêm thành viên bằng email"
                : "Hoặc bắt đầu cuộc trò chuyện mới bằng email"}
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
      <NewGroupDialog open={isNewGroupOpen} onOpenChange={setIsNewGroupOpen} onCreated={openConversation} />

      {conversationId && activeKind !== "personal" ? (
        <TaskFromChatDialog
          open={isTaskDialogOpen}
          onOpenChange={(next) => {
            setIsTaskDialogOpen(next);
            // Closing forgets the chosen bubble, so the next task starts from the thread's end.
            if (!next) setTaskSourceMessage(null);
          }}
          conversationId={conversationId}
          conversationKind={activeKind}
          conversationName={threadTitle}
          peerId={activeSummary?.peerId ?? peerQuery.data?.peerId ?? null}
          peerName={threadTitle}
          members={groupMembersQuery.data ?? []}
          contextMessage={taskContextMessage}
          contextSenderName={senderNameOf(taskContextMessage)}
        />
      ) : null}

      {conversationId && activeKind === "group" ? (
        <GroupTaskListSheet
          open={isGroupTasksOpen}
          onOpenChange={setIsGroupTasksOpen}
          conversationId={conversationId}
          groupName={threadTitle}
          members={groupMembersQuery.data ?? []}
        />
      ) : null}

      {conversationId ? (
        <GroupInfoSheet
          conversationId={conversationId}
          open={isInfoOpen}
          onOpenChange={setIsInfoOpen}
          peerName={threadTitle}
          peerEmail={peerEmail}
          onOpenConversation={openConversation}
          onLeft={() => navigate("/tin-nhan")}
        />
      ) : null}
    </div>
  );
};

export default Messages;
