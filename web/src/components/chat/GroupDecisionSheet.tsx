import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookLock, Check, KeyRound, Lock, Plus, ScrollText, Vote, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import {
  canDelegate,
  canEditDraft,
  canOpenDecision,
  canSettle,
  canSubmitDecision,
  canVote,
  castVote,
  closePoll,
  createDecision,
  decisionKeys,
  decisionStatusLabel,
  DECISION_MAX_OPTIONS,
  DECISION_MIN_OPTIONS,
  DECISION_OPTION_MAX_LENGTH,
  DECISION_TITLE_MAX_LENGTH,
  fetchDecisionGrants,
  fetchGroupDecisions,
  finalizeNote,
  grantPermission,
  isSettled,
  openPollNote,
  revokePermission,
  updateDraft,
  wouldChangeVote,
  type DecisionEntry,
  type DecisionKind,
} from "@/lib/decisions";
import type { GroupMember, GroupRole } from "@/lib/groups";
import { peerLabel } from "@/lib/initials";
import { MeetingNoteFields, MeetingNoteSummary } from "@/components/chat/MeetingNoteFields";
import {
  canFinalizeWithDetails,
  emptyDetails,
  fetchMeetingNoteDetails,
  hasAnyDetail,
  meetingNoteKeys,
  pendingTaskCount,
  saveMeetingNoteDetails,
  type MeetingNoteDetails,
} from "@/lib/meeting-notes";
import { cn } from "@/lib/utils";

type GroupDecisionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  groupName: string;
  members: readonly GroupMember[];
};

const KIND_LABEL: Record<DecisionKind, string> = {
  meeting_note: "Biên bản họp",
  poll: "Bình chọn",
};

/**
 * The group's decision log: what was agreed, and what is still being decided.
 *
 * The two rules that matter are enforced in the database, not here, and this screen is written to
 * show them rather than to impose them. A finalized note has no edit affordance because editing it
 * is refused by a trigger; an open poll shows no tally because the reader is genuinely not given
 * other people's ballots until it closes. Anything this screen hid on its own would be theatre.
 */
export function GroupDecisionSheet({
  open,
  onOpenChange,
  conversationId,
  groupName,
  members,
}: GroupDecisionSheetProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId: string | undefined = user?.id;

  const [composing, setComposing] = useState<DecisionKind | null>(null);
  const [title, setTitle] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editBody, setEditBody] = useState<string>("");
  /**
   * The structured half being composed or edited, held apart from the note itself.
   *
   * A new note has no id until it is created, so its details are collected here first and
   * written immediately afterwards — which is also why `createMutation` saves them in the
   * same success path rather than leaving a note whose template quietly went nowhere.
   */
  const [composeDetails, setComposeDetails] = useState<MeetingNoteDetails>(emptyDetails(""));
  const [editDetails, setEditDetails] = useState<MeetingNoteDetails>(emptyDetails(""));

  const myRole: GroupRole | undefined = members.find((member) => member.userId === userId)?.role;

  const listQuery = useQuery({
    queryKey: decisionKeys.list(conversationId),
    queryFn: () => fetchGroupDecisions(conversationId, userId),
    enabled: open && Boolean(userId),
  });

  const grantsQuery = useQuery({
    queryKey: decisionKeys.grants(conversationId),
    queryFn: () => fetchDecisionGrants(conversationId),
    enabled: open && Boolean(userId),
  });

  const entries: DecisionEntry[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const grants = useMemo(() => grantsQuery.data ?? [], [grantsQuery.data]);

  const noteIds = useMemo(
    () => entries.filter((entry) => entry.kind === "meeting_note").map((entry) => entry.id),
    [entries],
  );

  /** Details for every note in the log, fetched in one pass rather than one per row. */
  const detailsQuery = useQuery({
    queryKey: [...meetingNoteKeys.details(conversationId), noteIds],
    queryFn: () => fetchMeetingNoteDetails(noteIds),
    enabled: open && noteIds.length > 0,
  });

  const detailsByNote = useMemo(
    () => detailsQuery.data ?? new Map<string, MeetingNoteDetails>(),
    [detailsQuery.data],
  );

  /** Everyone in the room, offered as a starting point for the attendance list. */
  const suggestedAttendees = useMemo(() => members.map((member) => member.userId), [members]);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: decisionKeys.list(conversationId) });
    void queryClient.invalidateQueries({ queryKey: decisionKeys.grants(conversationId) });
    void queryClient.invalidateQueries({ queryKey: meetingNoteKeys.details(conversationId) });
  };

  const resetCompose = (): void => {
    setComposing(null);
    setTitle("");
    setBody("");
    setOptions(["", ""]);
    setComposeDetails(emptyDetails(""));
  };

  /**
   * Creating a note writes its template in the same breath.
   *
   * The details need the note's id, which only exists once the note does — so they are saved
   * immediately after. A failure here is reported rather than swallowed: the note exists and
   * is still a draft, so the person can re-enter what did not land instead of discovering
   * later that the structure silently went nowhere.
   */
  const createMutation = useMutation({
    mutationFn: async (kind: DecisionKind) => {
      const id = await createDecision({ conversationId, kind, title, body, options });
      if (kind === "meeting_note" && hasAnyDetail(composeDetails)) {
        await saveMeetingNoteDetails({ ...composeDetails, decisionId: id });
      }
      return id;
    },
    onSuccess: (_id, kind) => {
      toast.success(kind === "poll" ? "Đã mở cuộc bình chọn." : "Đã tạo bản nháp biên bản.");
      resetCompose();
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveDraftMutation = useMutation({
    mutationFn: async (entryId: string) => {
      await updateDraft(entryId, editTitle, editBody);
      await saveMeetingNoteDetails({ ...editDetails, decisionId: entryId });
    },
    onSuccess: () => {
      toast.success("Đã lưu bản nháp.");
      setEditingId(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Locking a note is also what hands out the work it recorded, so the message says how many
   * tasks it produced. Silently creating three tasks would be a surprise; saying so is not.
   */
  const finalizeMutation = useMutation({
    mutationFn: async (entryId: string) => {
      // Save any unsaved edits first, or the tasks would be built from stale action items.
      if (editingId === entryId) {
        await updateDraft(entryId, editTitle, editBody);
        await saveMeetingNoteDetails({ ...editDetails, decisionId: entryId });
      }
      const created = pendingTaskCount(
        editingId === entryId ? editDetails : detailsByNote.get(entryId),
      );
      await finalizeNote(entryId);
      return created;
    },
    onSuccess: (created) => {
      toast.success(
        created > 0
          ? `Đã khoá biên bản và tạo ${created} nhiệm vụ.`
          : "Đã khoá biên bản. Từ giờ không sửa được nữa.",
      );
      setEditingId(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Choosing, and changing the choice, are the same act — so there is one mutation and no
   * separate confirm step. `changed` only decides the wording afterwards: telling someone
   * their vote was "recorded" when they just moved it reads as though the move failed.
   */
  const voteMutation = useMutation({
    mutationFn: (input: { decisionId: string; optionId: string; changed: boolean }) =>
      castVote(input.decisionId, input.optionId),
    onSuccess: (_data, input) => {
      toast.success(input.changed ? "Đã đổi lựa chọn của bạn." : "Đã ghi nhận lựa chọn của bạn.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeMutation = useMutation({
    mutationFn: (entryId: string) => closePoll(entryId),
    onSuccess: () => {
      toast.success("Đã đóng bình chọn. Kết quả hiện cho cả nhóm.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const grantMutation = useMutation({
    mutationFn: (input: { granteeId: string; kind: DecisionKind }) =>
      grantPermission(conversationId, input.granteeId, input.kind),
    onSuccess: () => {
      toast.success("Đã uỷ quyền. Quyền này dùng được một lần.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => revokePermission(grantId),
    onSuccess: () => {
      toast.success("Đã thu hồi quyền.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const memberName = (id: string): string => {
    const found = members.find((member) => member.userId === id);
    if (!found) return "Người đã rời nhóm";
    const label = peerLabel(found.displayName, found.email);
    return found.userId === userId ? `${label} (bạn)` : label;
  };

  const startEditing = (entry: DecisionEntry): void => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditBody(entry.body);
    setEditDetails(detailsByNote.get(entry.id) ?? emptyDetails(entry.id));
  };

  const submitCompose = (event: FormEvent): void => {
    event.preventDefault();
    if (composing === null) return;
    createMutation.mutate(composing);
  };

  const pendingGrants = grants.filter((grant) => grant.usedAt === null);
  const canOpenNote = canOpenDecision(myRole, "meeting_note", grants, userId);
  const canOpenPoll = canOpenDecision(myRole, "poll", grants, userId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-border bg-card p-0 sm:max-w-md">
        <div className="border-b border-border px-5 py-5">
          <SheetTitle className="text-[20px] font-semibold tracking-tight text-foreground">
            Sổ quyết định
          </SheetTitle>
          <SheetDescription className="mt-1 text-[13px] text-muted-foreground">
            {entries.length === 0
              ? `Chưa có ghi chép nào trong ${groupName}`
              : `${entries.length} mục trong ${groupName}`}
          </SheetDescription>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Opening something new */}
          {composing === null ? (
            <div className="mb-5 flex gap-2">
              <button
                type="button"
                disabled={!canOpenNote}
                onClick={() => setComposing("meeting_note")}
                className="press inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ScrollText className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                Biên bản
              </button>
              <button
                type="button"
                disabled={!canOpenPoll}
                onClick={() => setComposing("poll")}
                className="press inline-flex flex-1 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Vote className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                Bình chọn
              </button>
            </div>
          ) : (
            <form
              onSubmit={submitCompose}
              className="mb-5 rounded-[12px] border border-border bg-background/60 p-3.5"
            >
              <p className="mb-2.5 text-[13px] font-semibold text-foreground">
                {KIND_LABEL[composing]} mới
              </p>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value.slice(0, DECISION_TITLE_MAX_LENGTH))}
                placeholder={composing === "poll" ? "Câu hỏi cần quyết" : "Tiêu đề biên bản"}
                className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
              />

              {composing === "meeting_note" ? (
                <>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={4}
                    placeholder="Nội dung đã thống nhất…"
                    className="mt-2 w-full resize-none rounded-[8px] border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
                  />
                  <MeetingNoteFields
                    details={composeDetails}
                    members={members}
                    suggestedAttendees={suggestedAttendees}
                    onChange={setComposeDetails}
                  />
                </>
              ) : (
                <div className="mt-2 space-y-2">
                  {options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        value={option}
                        onChange={(event) => {
                          const next = [...options];
                          next[index] = event.target.value.slice(0, DECISION_OPTION_MAX_LENGTH);
                          setOptions(next);
                        }}
                        placeholder={`Lựa chọn ${index + 1}`}
                        className="min-w-0 flex-1 rounded-[8px] border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60"
                      />
                      {options.length > DECISION_MIN_OPTIONS ? (
                        <button
                          type="button"
                          aria-label={`Bỏ lựa chọn ${index + 1}`}
                          onClick={() => setOptions(options.filter((_, i) => i !== index))}
                          className="press rounded-[8px] border border-border p-2 text-muted-foreground transition-colors hover:bg-accent/40"
                        >
                          <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {options.length < DECISION_MAX_OPTIONS ? (
                    <button
                      type="button"
                      onClick={() => setOptions([...options, ""])}
                      className="press inline-flex items-center gap-1.5 text-[13px] font-medium text-primary"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Thêm lựa chọn
                    </button>
                  ) : null}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="submit"
                  disabled={!canSubmitDecision(composing, title, options) || createMutation.isPending}
                  className="press flex-1 rounded-[8px] bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {composing === "poll" ? "Mở bình chọn" : "Tạo bản nháp"}
                </button>
                <button
                  type="button"
                  onClick={resetCompose}
                  className="press rounded-[8px] border border-border px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/40"
                >
                  Huỷ
                </button>
              </div>
            </form>
          )}

          {/* Delegation, for the seats that answer for the group */}
          {canDelegate(myRole) ? (
            <section className="mb-5" aria-label="Uỷ quyền tạo mục">
              <div className="mb-2 flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
                <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Uỷ quyền một lần
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="press w-full rounded-[10px] border border-dashed border-border px-3 py-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/30"
                  >
                    Cho một thành viên quyền tạo một mục…
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {members
                    .filter((member) => member.userId !== userId && member.role === "member")
                    .map((member) => (
                      <DropdownMenuItem
                        key={`${member.userId}-note`}
                        onSelect={() =>
                          grantMutation.mutate({ granteeId: member.userId, kind: "meeting_note" })
                        }
                      >
                        {peerLabel(member.displayName, member.email)} — biên bản
                      </DropdownMenuItem>
                    ))}
                  {members
                    .filter((member) => member.userId !== userId && member.role === "member")
                    .map((member) => (
                      <DropdownMenuItem
                        key={`${member.userId}-poll`}
                        onSelect={() => grantMutation.mutate({ granteeId: member.userId, kind: "poll" })}
                      >
                        {peerLabel(member.displayName, member.email)} — bình chọn
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {pendingGrants.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {pendingGrants.map((grant) => (
                    <li
                      key={grant.id}
                      className="flex items-center gap-2 rounded-[8px] border border-border bg-background/50 px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                        {memberName(grant.granteeId)} · {KIND_LABEL[grant.kind]}
                      </span>
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(grant.id)}
                        className="press shrink-0 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        Thu hồi
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* The log itself */}
          {listQuery.isPending ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">Đang tải…</p>
          ) : listQuery.isError ? (
            <p className="py-10 text-center text-[13px] text-destructive">
              {(listQuery.error as Error).message}
            </p>
          ) : entries.length === 0 ? (
            <div className="py-12 text-center">
              <BookLock
                className="mx-auto h-10 w-10 text-muted-foreground/60"
                strokeWidth={1.3}
                aria-hidden="true"
              />
              <p className="mt-4 text-[14px] text-muted-foreground">
                Sổ quyết định giữ lại điều nhóm đã thống nhất — biên bản được khoá lại sau khi kết
                thúc, và kết quả bình chọn chỉ hiện khi đã đóng.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => {
                const settled = isSettled(entry);
                const editing = editingId === entry.id;
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      "rounded-[12px] border px-3.5 py-3",
                      settled ? "border-border bg-background/40" : "border-primary/30 bg-card",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {entry.kind === "poll" ? (
                        <Vote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                      ) : (
                        <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <input
                            value={editTitle}
                            onChange={(event) =>
                              setEditTitle(event.target.value.slice(0, DECISION_TITLE_MAX_LENGTH))
                            }
                            className="w-full rounded-[8px] border border-border bg-card px-2.5 py-1.5 text-[14px] font-medium text-foreground outline-none focus:border-primary/60"
                          />
                        ) : (
                          <p className="text-[14px] font-medium leading-5 text-foreground">{entry.title}</p>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
                          <span>{decisionStatusLabel(entry)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{memberName(entry.createdBy)}</span>
                        </p>
                      </div>
                      {settled ? (
                        <Lock
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          strokeWidth={1.8}
                          aria-label="Đã khoá"
                        />
                      ) : null}
                    </div>

                    {/* Meeting note body, plus the structured half */}
                    {entry.kind === "meeting_note" ? (
                      editing ? (
                        <div className="mt-2.5">
                          <textarea
                            value={editBody}
                            onChange={(event) => setEditBody(event.target.value)}
                            rows={4}
                            className="w-full resize-none rounded-[8px] border border-border bg-card px-2.5 py-2 text-[13.5px] text-foreground outline-none focus:border-primary/60"
                          />
                          <MeetingNoteFields
                            details={editDetails}
                            members={members}
                            suggestedAttendees={suggestedAttendees}
                            onChange={setEditDetails}
                            startExpanded={hasAnyDetail(editDetails)}
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => saveDraftMutation.mutate(entry.id)}
                              className="press rounded-[8px] border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-accent/40"
                            >
                              Lưu nháp
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="press rounded-[8px] px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
                            >
                              Đóng
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {entry.body.length > 0 ? (
                            <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-[1.55] text-foreground/90">
                              {entry.body}
                            </p>
                          ) : null}
                          <MeetingNoteSummary
                            details={detailsByNote.get(entry.id)}
                            memberName={memberName}
                          />
                        </>
                      )
                    ) : null}

                    {/* Poll options */}
                    {entry.kind === "poll" ? (
                      <div className="mt-2.5 space-y-1.5">
                        {entry.options.map((option) => {
                          const count = entry.tally?.[option.id] ?? null;
                          const total = entry.totalVotes ?? 0;
                          const share = count !== null && total > 0 ? Math.round((count / total) * 100) : 0;
                          const mine = entry.myVote === option.id;
                          // Open means choosable, whether or not this person has answered
                          // already. Only the option they are already on stops responding,
                          // since pressing it would change nothing.
                          const open = canVote(entry);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={!open || mine}
                              aria-pressed={open ? mine : undefined}
                              onClick={() =>
                                voteMutation.mutate({
                                  decisionId: entry.id,
                                  optionId: option.id,
                                  changed: entry.myVote !== null && wouldChangeVote(entry, option.id),
                                })
                              }
                              className={cn(
                                "press relative w-full overflow-hidden rounded-[8px] border px-2.5 py-2 text-left text-[13px] transition-colors",
                                mine
                                  ? "border-primary/50 bg-primary/10 disabled:opacity-100"
                                  : "border-border bg-background/50",
                                open && !mine ? "hover:bg-accent/40" : "cursor-default",
                              )}
                            >
                              {count !== null && total > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className="absolute inset-y-0 left-0 bg-primary/15"
                                  style={{ width: `${share}%` }}
                                />
                              ) : null}
                              <span className="relative flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-foreground">{option.label}</span>
                                {mine ? (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} aria-label="Lựa chọn của bạn" />
                                ) : null}
                                {open && entry.myVote !== null && !mine ? (
                                  <span className="shrink-0 text-[11.5px] text-muted-foreground">Đổi sang</span>
                                ) : null}
                                {count !== null ? (
                                  <span className="tabular shrink-0 text-[12px] text-muted-foreground">
                                    {count}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}

                        {/* What a person is told while the ballot is still secret */}
                        {entry.status === "open" ? (
                          <p className="pt-0.5 text-[12px] text-muted-foreground">{openPollNote(entry)}</p>
                        ) : (
                          <p className="tabular pt-0.5 text-[12px] text-muted-foreground">
                            {entry.totalVotes ?? 0} phiếu
                          </p>
                        )}
                      </div>
                    ) : null}

                    {/* Actions that are still available */}
                    {!settled ? (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {canEditDraft(entry, userId) && !editing ? (
                          <button
                            type="button"
                            onClick={() => startEditing(entry)}
                            className="press rounded-[8px] border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-accent/40"
                          >
                            Sửa nháp
                          </button>
                        ) : null}
                        {entry.kind === "meeting_note" && canSettle(entry, myRole, userId)
                          ? (() => {
                              // Locking is what hands out the work, so a half-filled ticked
                              // line blocks it here rather than being refused mid-finalize.
                              const draftDetails =
                                editing ? editDetails : detailsByNote.get(entry.id);
                              const ready = canFinalizeWithDetails(draftDetails);
                              const willCreate = pendingTaskCount(draftDetails);
                              return (
                                <button
                                  type="button"
                                  disabled={!ready}
                                  title={
                                    ready
                                      ? undefined
                                      : "Có việc cần làm đã tick “Tạo Task” nhưng chưa đủ người phụ trách hoặc hạn"
                                  }
                                  onClick={() => finalizeMutation.mutate(entry.id)}
                                  className="press rounded-[8px] bg-primary px-2.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
                                >
                                  {willCreate > 0
                                    ? `Kết thúc & khoá · tạo ${willCreate} nhiệm vụ`
                                    : "Kết thúc & khoá"}
                                </button>
                              );
                            })()
                          : null}
                        {entry.kind === "poll" && canSettle(entry, myRole, userId) ? (
                          <button
                            type="button"
                            onClick={() => closeMutation.mutate(entry.id)}
                            className="press rounded-[8px] bg-primary px-2.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground"
                          >
                            Đóng bình chọn
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
