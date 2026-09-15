import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  BookLock,
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
  X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { NewChatDialog } from "@/components/NewChatDialog";
import { NewGroupDialog } from "@/components/NewGroupDialog";
import { ChatSuggestionPanel } from "@/components/chat/ChatSuggestionPanel";
import { ChatTaskPanel } from "@/components/chat/ChatTaskPanel";
import { GroupDecisionSheet } from "@/components/chat/GroupDecisionSheet";
import { GroupInfoSheet } from "@/components/chat/GroupInfoSheet";
import { GroupTaskListSheet } from "@/components/chat/GroupTaskListSheet";
import { MessageComposer } from "@/components/chat/MessageComposer";
import {
  MessageActionsAffordance,
  type MessageAction,
} from "@/components/chat/MessageActionsMenu";
import { MessageReactions, ReactionPicker } from "@/components/chat/MessageReactions";
import { PinChoiceDialog, PinnedStrip } from "@/components/chat/PinnedStrip";
import { ThreadSearch } from "@/components/chat/ThreadSearch";
import {
  extractMentionedIds,
  mentionCandidates as buildMentionCandidates,
  splitMentions,
} from "@/lib/mentions";
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
  editMessage,
  ensureJournalConversation,
  fetchConversationPeer,
  fetchMessages,
  filterConversationsByTab,
  formatClock,
  formatInboxTime,
  formatMissedMessages,
  formatUnreadBadge,
  groupMessagesByDay,
  isEdited,
  isNearThreadBottom,
  isRecalled,
  isSeenByPeer,
  lastOutgoingId,
  markConversationRead,
  matchesConversationQuery,
  messageBodyText,
  MESSAGE_TABS,
  quotePreview,
  recallMessage,
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
import { placeSilentSkipNotices, silentSkipNotices, silentSkipNote } from "@/lib/tasks";
import { silentlySkippedInConversation } from "@/lib/task-suggestions";
import { canPinForGroup } from "@/lib/pins";
import { useThreadPins } from "@/lib/use-pins";
import { useThreadReactions } from "@/lib/use-reactions";
import { useThreadCelebrations } from "@/lib/use-task-celebrations";
import { useProfileSettings } from "@/lib/use-settings";
import { useTasks } from "@/lib/use-tasks";
import { useTaskSuggestions } from "@/lib/use-task-suggestions";
import { typingText, useThreadPresence } from "@/lib/use-thread-presence";
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
  const [isDecisionsOpen, setIsDecisionsOpen] = useState<boolean>(false);
  /**
   * The message a new task will quote. Null means "whatever was said last", which is what the
   * button beside the composer means; a bubble's own action names that bubble instead.
   */
  const [taskSourceMessage, setTaskSourceMessage] = useState<ChatMessage | null>(null);
  const [draft, setDraft] = useState<string>("");
  /** The message the next send will answer, shown as a quote above the composer. */
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  /** Which bubble is currently open for correction, and the text being corrected. */
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  /** A result just jumped to, lit briefly so the eye can find it among its neighbours. */
  const [flashedMessageId, setFlashedMessageId] = useState<string | null>(null);
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
  const { data: suggestions } = useTaskSuggestions();
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

  /**
   * Takes a search result to its place in the thread.
   *
   * The highlight is temporary on purpose: it exists to answer "which one of these is it?"
   * for the second after the scroll lands, and a permanent mark would still be sitting there
   * an hour later claiming to be the answer to a question nobody is asking any more.
   */
  const jumpToMessage = useCallback((messageId: string): void => {
    const node = document.getElementById(`message-${messageId}`);
    if (node === null) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashedMessageId(messageId);
    window.setTimeout(
      () => setFlashedMessageId((current) => (current === messageId ? null : current)),
      2_000,
    );
  }, []);

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
      // Read off the finished text rather than tracked as chips: deleting part of a name
      // un-names that person, which is what someone editing the sentence expects.
      return sendMessage(
        conversationId,
        userId,
        content,
        replyTarget?.id ?? null,
        extractMentionedIds(content, mentionable),
      );
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
        replyToMessageId: replyTarget?.id ?? null,
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
      // The quote belongs to the message that was just sent, not to the next one.
      setReplyTarget(null);
      // The message has arrived, so "still typing" is now false — say so at once rather than
      // letting the indicator time out a few seconds later.
      clearTyping();
      sendMutation.mutate(content);
    },
    [sendMutation, clearTyping],
  );

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
    onSuccess: () => {
      toast.success("Đã thu hồi tin nhắn.");
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

      // Recall destroys the text for everyone, so it asks first — this is the one action on a
      // message that cannot be walked back.
      if (window.confirm("Thu hồi tin nhắn này? Nội dung sẽ bị xoá với cả hai bên.")) {
        recallMutation.mutate(message.id);
      }
    },
    [openTaskDialogFor, recallMutation, activeKind, myGroupRole, addPin, removePin, pinOf],
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
                    {threadTitle}
                  </p>
                  {/* Typing takes the subtitle's place while it lasts: two lines of status
                      under one name is more than the header can carry. */}
                  {typingLine !== null ? (
                    <p className="truncate text-[13px] font-medium text-primary" aria-live="polite">
                      {typingLine}
                    </p>
                  ) : (
                    <p className="truncate text-[13px] text-muted-foreground">
                      {isPeerOnline ? "Đang trực tuyến" : threadSubtitle}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                  {activeKind === "group" ? (
                    <>
                      <button
                        type="button"
                        aria-label="Danh sách nhiệm vụ nhóm"
                        title="Danh sách nhiệm vụ nhóm"
                        onClick={() => setIsGroupTasksOpen(true)}
                        className="press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground"
                      >
                        <ListTodo className="h-[19px] w-[19px]" strokeWidth={1.6} />
                      </button>
                      <button
                        type="button"
                        aria-label="Sổ quyết định"
                        title="Sổ quyết định"
                        onClick={() => setIsDecisionsOpen(true)}
                        className="press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground"
                      >
                        <BookLock className="h-[19px] w-[19px]" strokeWidth={1.6} />
                      </button>
                    </>
                  ) : null}
                  {/* Searching a thread is useful in a journal too — that is where people
                      keep the things they most often come back looking for. */}
                  <button
                    type="button"
                    aria-label="Tìm trong cuộc trò chuyện này"
                    title="Tìm trong cuộc trò chuyện này"
                    aria-pressed={isSearchOpen}
                    onClick={() => setIsSearchOpen((current) => !current)}
                    className={cn(
                      "press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground",
                      isSearchOpen ? "bg-accent/60 text-foreground" : "",
                    )}
                  >
                    <Search className="h-[19px] w-[19px]" strokeWidth={1.6} />
                  </button>
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

              {isSearchOpen ? (
                <ThreadSearch
                  conversationId={conversationId}
                  senderNameOf={senderNameOf}
                  onJumpTo={jumpToMessage}
                  onClose={() => setIsSearchOpen(false)}
                />
              ) : null}

              <PinnedStrip
                pins={orderedPinList}
                messages={messages}
                viewerId={userId}
                myRole={myGroupRole}
                senderNameOf={senderNameOf}
                onJumpTo={jumpToMessage}
                onUnpin={removePin}
                isWorking={isPinning}
              />

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
                            return (
                              <Fragment key={message.id}>
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
                                      message={message}
                                      viewerId={userId}
                                      canRaiseTask={canRaiseTask}
                                      outgoing={outgoing}
                                      canPin={canPinThis}
                                      isPinned={isPinnedForMe}
                                      onAction={(action) => handleMessageAction(message, action)}
                                      reactionPicker={
                                        canReact ? (
                                          <ReactionPicker
                                            label={message.content.slice(0, 40)}
                                            onPick={(emoji) => toggleReaction(message.id, emoji)}
                                          />
                                        ) : null
                                      }
                                    >
                                      <div
                                        className={cn(
                                          "whitespace-pre-wrap break-words rounded-bubble px-4 py-2.5 text-[15px] leading-relaxed",
                                          outgoing
                                            ? "rounded-br-[4px] bg-primary text-primary-foreground"
                                            : "rounded-bl-[4px] border border-border bg-card text-foreground",
                                          message.pending ? "opacity-70" : "",
                                        )}
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
                                            <span key={segmentIndex}>{segment.text}</span>
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
                                    </MessageActionsAffordance>
                                  )}

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
                                    {message.pending ? "Đang gửi…" : formatClock(message.createdAt)}
                                    {/* An edit is admitted out loud: a silent one would let
                                        someone change what they are on record as saying. */}
                                    {isEdited(message) ? <span>(đã chỉnh sửa)</span> : null}
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
                <ChatSuggestionPanel
                  conversationId={conversationId}
                  conversationKind={activeKind}
                  peerName={threadTitle}
                  members={groupMembersQuery.data ?? []}
                  onSendMessage={sendPlainMessage}
                />
              )}

              {activeKind === "personal" ? null : (
                <ChatTaskPanel
                  conversationId={conversationId}
                  peerName={threadTitle}
                  members={groupMembersQuery.data ?? []}
                  highlightTaskId={highlightTaskId}
                  // A group keeps this panel to the viewer's own work; the room's full list
                  // opens from the header. A 1-1 has only two people, so it stays whole.
                  scope={activeKind === "group" ? "mine" : "all"}
                  onSendMessage={sendPlainMessage}
                />
              )}

              <div className="border-t border-border bg-card px-5 py-4 md:px-10">
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
                  isSending={sendMutation.isPending}
                  placeholder={activeKind === "personal" ? "Ghi vào nhật ký…" : `Nhắn tin cho ${threadTitle}…`}
                  ariaLabel={activeKind === "personal" ? "Ghi vào nhật ký" : `Nhắn tin cho ${threadTitle}`}
                  mentionCandidates={mentionable}
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

      {conversationId ? (
        <GroupInfoSheet
          conversationId={conversationId}
          open={isInfoOpen}
          onOpenChange={setIsInfoOpen}
          peerName={threadTitle}
          peerEmail={peerEmail}
          peerId={
            activeKind === "direct"
              ? (activeSummary?.peerId ?? peerQuery.data?.peerId ?? null)
              : null
          }
          onOpenConversation={openConversation}
          onLeft={() => navigate("/tin-nhan")}
        />
      ) : null}
    </div>
  );
};

export default Messages;
