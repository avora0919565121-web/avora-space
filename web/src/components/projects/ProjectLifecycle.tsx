import { Heart, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ProposeDialog } from "@/components/think-hub/TableActions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import {
  canClose,
  closeBlockerSentence,
  isCriterionRecorded,
  type CloseBlockers,
  type Project,
  type SuccessCriterion,
} from "@/lib/projects";
import type { TaskItem } from "@/lib/tasks";
import { useCheckAdjust, useProjectActions } from "@/lib/use-projects";

const areaClass =
  "mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3.5 py-2.5 text-[14.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-personal";
/**
 * The one question after a successful close. The box starts empty on purpose (ADR-021): the
 * words are the leader's own, never a draft written for them. Sending posts once into the
 * project's chat and pins it at the top.
 */
function ThanksDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { postThanks } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const [body, setBody] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBody("");
      setNotice(null);
    }
  }, [open]);

  const send = useCallback(async (): Promise<void> => {
    if (body.trim().length === 0) {
      setNotice("Hãy viết vài dòng trước khi gửi.");
      return;
    }
    await guard(async () => {
      try {
        await postThanks(project.id, body);
        toast.success("Đã gửi và ghim lời cảm ơn trong nhóm dự án.");
        onOpenChange(false);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không gửi được.");
      }
    });
  }, [body, guard, postThanks, project.id, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Bạn muốn nói gì với cả nhóm?</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Lời này đăng vào nhóm của dự án và được ghim trên cùng. Bỏ qua cũng được.
        </DialogDescription>
        <textarea
          value={body}
          autoFocus
          rows={5}
          maxLength={4000}
          aria-label="Lời cảm ơn"
          onChange={(event) => setBody(event.target.value)}
          className={areaClass}
        />
        {notice !== null ? (
          <p role="alert" className="text-[13.5px] text-destructive">
            {notice}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Để sau
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={() => void send()}>
            {isSubmitting ? "Đang gửi…" : "Gửi vào nhóm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EarlyCloseDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { closeEarly } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const [reason, setReason] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setNotice(null);
    }
  }, [open]);

  const submit = useCallback(async (): Promise<void> => {
    if (reason.trim().length === 0) {
      setNotice("Hãy ghi lý do đóng sớm.");
      return;
    }
    await guard(async () => {
      try {
        await closeEarly(project.id, reason);
        onOpenChange(false);
        toast.success("Đã dừng dự án. Không có gì được đăng vào nhóm.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Chưa dừng được dự án.");
      }
    });
  }, [reason, guard, closeEarly, project.id, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Đóng sớm dự án</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Lý do chỉ mình bạn xem. Nhóm không nhận thông báo nào; mọi dữ liệu giữ nguyên, chuyển sang chỉ đọc. Mở lại
          lúc nào cũng được.
        </DialogDescription>
        <label className="mt-2 block">
          <span className="text-[13px] font-medium text-muted-foreground">Vì sao dừng ở đây?</span>
          <textarea
            value={reason}
            autoFocus
            rows={4}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            className={areaClass}
          />
        </label>
        {notice !== null ? (
          <p role="alert" className="text-[13.5px] text-destructive">
            {notice}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Để sau
          </Button>
          <Button type="button" disabled={isSubmitting || reason.trim().length === 0} onClick={() => void submit()}>
            {isSubmitting ? "Đang đóng…" : "Đóng sớm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Check-Adjust (ADR-021): the private look back after closing early. Only the opener sees it —
 * the reason, which criteria were met, what was left unfinished, and one note of their own.
 */
function CheckAdjustPanel({
  project,
  criteria,
  unfinished,
}: {
  project: Project;
  criteria: readonly SuccessCriterion[];
  unfinished: readonly TaskItem[];
}) {
  const query = useCheckAdjust(project.id, true);
  const { saveNote } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    setNote(query.data?.note ?? "");
  }, [query.data?.note]);

  if (query.data === null || query.data === undefined) return null;

  return (
    <section aria-label="Nhìn lại riêng tư" className="mt-8 rounded-card border border-dashed border-border bg-card px-5 py-4">
      <h2 className="text-[15px] font-semibold text-foreground">Nhìn lại — chỉ mình bạn thấy</h2>
      <dl className="mt-3 space-y-3 text-[14px]">
        <div>
          <dt className="text-[12.5px] font-medium text-muted-foreground">Lý do đóng sớm</dt>
          <dd className="mt-0.5 whitespace-pre-line text-foreground">{query.data.closeReason}</dd>
        </div>
        <div>
          <dt className="text-[12.5px] font-medium text-muted-foreground">Tiêu chí</dt>
          <dd className="mt-0.5">
            {criteria.length === 0 ? (
              <span className="text-muted-foreground">Chưa đặt tiêu chí nào.</span>
            ) : (
              <ul className="space-y-1">
                {criteria.map((criterion) => (
                  <li key={criterion.id} className="text-foreground">
                    {isCriterionRecorded(criterion) ? "Đã đạt · " : "Chưa đạt · "}
                    {criterion.description}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[12.5px] font-medium text-muted-foreground">Việc còn dở</dt>
          <dd className="mt-0.5">
            {unfinished.length === 0 ? (
              <span className="text-muted-foreground">Không còn việc dở.</span>
            ) : (
              <ul className="space-y-1">
                {unfinished.map((task) => (
                  <li key={task.id} className="text-foreground">
                    {task.title}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <label className="mt-4 block">
        <span className="text-[13px] font-medium text-muted-foreground">Lần sau điều chỉnh gì?</span>
        <textarea value={note} rows={3} maxLength={5000} onChange={(event) => setNote(event.target.value)} className={areaClass} />
      </label>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() =>
            void guard(async () => {
              try {
                await saveNote(project.id, note);
                toast.success("Đã lưu ghi chú.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Không lưu được.");
              }
            })
          }
        >
          {isSubmitting ? "Đang lưu…" : "Lưu ghi chú"}
        </Button>
      </div>
    </section>
  );
}

/**
 * The bottom of a project's page: the two ways to close, the thank-you, and proposing to reopen
 * or delete (ADR-031: every member answers).
 */
export function ProjectLifecycle({
  project,
  isOwner,
  blockers,
  criteria,
  unfinished,
  onDeleted,
}: {
  project: Project;
  isOwner: boolean;
  blockers: CloseBlockers;
  criteria: readonly SuccessCriterion[];
  unfinished: readonly TaskItem[];
  onDeleted: () => void;
}) {
  const { close } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const [isThanksOpen, setIsThanksOpen] = useState<boolean>(false);
  const [isEarlyOpen, setIsEarlyOpen] = useState<boolean>(false);
  // AVORA-53 · 5.2: closing is one tap away from a group-wide reopen, so it asks once.
  const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState<boolean>(false);
  // ADR-031 (Đợt gộp 2 · C9/C10): deleting and reopening a project go through a proposal every member answers.
  const [proposing, setProposing] = useState<"delete" | "reopen" | null>(null);
  const sentence = closeBlockerSentence(blockers);
  void onDeleted;

  const handleClose = useCallback(async (): Promise<void> => {
    await guard(async () => {
      try {
        await close(project.id);
        toast.success("Đã đóng dự án.");
        setIsThanksOpen(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Chưa đóng được dự án.");
      }
    });
  }, [guard, close, project.id]);


  return (
    <>
      {isOwner && project.status === "closed_early" ? (
        <CheckAdjustPanel project={project} criteria={criteria} unfinished={unfinished} />
      ) : null}

      <section className="mt-10 border-t border-border pt-6">
        {isOwner && project.status === "active" ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="press h-11 px-5"
                disabled={!canClose(blockers) || isSubmitting}
                onClick={() => setIsConfirmCloseOpen(true)}
              >
                Đóng dự án
              </Button>
              <Dialog open={isConfirmCloseOpen} onOpenChange={setIsConfirmCloseOpen}>
                <DialogContent className="max-w-[420px]">
                  <DialogTitle className="text-[18px] font-semibold tracking-tight">Đóng dự án {project.title}?</DialogTitle>
                  <DialogDescription className="text-[14px] text-muted-foreground">Mở lại cần mọi người đồng ý.</DialogDescription>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" className="press h-11 px-5" onClick={() => setIsConfirmCloseOpen(false)}>
                      Huỷ
                    </Button>
                    <Button
                      className="press h-11 px-5"
                      disabled={isSubmitting}
                      onClick={() => {
                        setIsConfirmCloseOpen(false);
                        void handleClose();
                      }}
                    >
                      Đóng
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              {!canClose(blockers) ? (
                <Button variant="ghost" className="press h-11 px-5" onClick={() => setIsEarlyOpen(true)}>
                  Đóng sớm
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {sentence ?? "Mọi tiêu chí đã có kết quả và không còn việc nào trễ hạn kết thúc."}
            </p>
          </>
        ) : null}

        {project.status !== "active" ? (
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && project.status === "done" && project.thanksMessageId === null ? (
              <Button variant="outline" className="press h-11 px-5" onClick={() => setIsThanksOpen(true)}>
                <Heart className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Gửi lời cảm ơn
              </Button>
            ) : null}
            <Button variant="outline" className="press h-11 px-5" onClick={() => setProposing("reopen")}>
              <RotateCcw className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Đề nghị mở lại dự án
            </Button>
            <p className="basis-full text-[12.5px] text-muted-foreground">
              Dự án đã lưu trữ: nhóm, bảng và việc giữ nguyên, chỉ còn để đọc. Mở lại khi mọi thành viên đồng ý.
            </p>
          </div>
        ) : null}

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setProposing("delete")}
            className="press inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            Đề nghị xoá dự án
          </button>
          <p className="text-[12px] text-muted-foreground">Dự án là tài sản chung — chỉ xoá khi mọi thành viên đồng ý.</p>
        </div>
      </section>

      <ThanksDialog project={project} open={isThanksOpen} onOpenChange={setIsThanksOpen} />
      <EarlyCloseDialog project={project} open={isEarlyOpen} onOpenChange={setIsEarlyOpen} />
      <ProposeDialog
        target={proposing === null ? null : { action: proposing, targetType: "project", targetId: project.id, name: project.title }}
        onOpenChange={(next) => !next && setProposing(null)}
      />
    </>
  );
}
