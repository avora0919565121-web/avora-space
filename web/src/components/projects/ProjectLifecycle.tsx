import { Heart, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import {
  canClose,
  closeBlockerSentence,
  deleteConfirmMatches,
  isCriterionRecorded,
  type CloseBlockers,
  type Project,
  type SuccessCriterion,
} from "@/lib/projects";
import type { TaskItem } from "@/lib/tasks";
import { useCheckAdjust, useIsProjectRootOwner, useProjectActions } from "@/lib/use-projects";

const areaClass =
  "mt-1.5 w-full resize-y rounded-md border border-border bg-background px-3.5 py-2.5 text-[14.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary";
const inputClass =
  "mt-1.5 w-full rounded-md border border-border bg-background px-3.5 py-2.5 text-[15px] text-foreground outline-none transition-colors focus:border-primary";

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
          Lý do chỉ mình bạn đọc được. Nhóm không nhận thông báo nào; mọi dữ liệu giữ nguyên, chuyển sang chỉ đọc. Mở lại
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

function DeleteDialog({ project, open, onOpenChange, onDeleted }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void }) {
  const { remove } = useProjectActions();
  const { isSubmitting, guard } = useSubmitGuard();
  const [typed, setTyped] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setReason("");
      setNotice(null);
    }
  }, [open]);

  const matches = deleteConfirmMatches(project, typed);

  const submit = useCallback(async (): Promise<void> => {
    await guard(async () => {
      try {
        await remove(project.id, typed, reason);
        onOpenChange(false);
        toast.success("Đã chuyển dự án vào thùng rác. Bạn khôi phục được ở tab Dự án.");
        onDeleted();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Không xoá được dự án.");
      }
    });
  }, [guard, remove, project.id, typed, reason, onOpenChange, onDeleted]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-[19px] font-semibold tracking-tight">Xoá dự án</DialogTitle>
        <DialogDescription className="text-[14.5px] text-muted-foreground">
          Dự án, nhóm của nó và các bảng sẽ biến khỏi mọi nơi. Một dòng ghi lý do được đăng vào nhóm dự án. Bạn vẫn khôi
          phục được từ thùng rác.
        </DialogDescription>
        <label className="mt-2 block">
          <span className="text-[13px] font-medium text-muted-foreground">
            Gõ lại đúng tên dự án: <span className="font-semibold text-foreground">{project.title}</span>
          </span>
          <input value={typed} autoFocus onChange={(event) => setTyped(event.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-[13px] font-medium text-muted-foreground">Lý do</span>
          <textarea value={reason} rows={3} maxLength={2000} onChange={(event) => setReason(event.target.value)} className={areaClass} />
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
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting || !matches || reason.trim().length === 0}
            onClick={() => void submit()}
          >
            {isSubmitting ? "Đang xoá…" : "Xoá dự án"}
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
    <section aria-label="Nhìn lại riêng tư" className="mt-8 rounded-xl border border-dashed border-border bg-card px-5 py-4">
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
 * The bottom of a project's page: the two ways to close, the thank-you, reopening, and — for the
 * root group's owner only — deleting.
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
  const { close, reopen } = useProjectActions();
  const isRootOwner = useIsProjectRootOwner(project.id);
  const { isSubmitting, guard } = useSubmitGuard();
  const [isThanksOpen, setIsThanksOpen] = useState<boolean>(false);
  const [isEarlyOpen, setIsEarlyOpen] = useState<boolean>(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState<boolean>(false);
  const sentence = closeBlockerSentence(blockers);

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

  const handleReopen = useCallback(async (): Promise<void> => {
    await guard(async () => {
      try {
        await reopen(project.id);
        toast.success("Đã mở lại dự án.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Không mở lại được.");
      }
    });
  }, [guard, reopen, project.id]);

  if (!isOwner && !isRootOwner) return null;

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
                onClick={() => void handleClose()}
              >
                Đóng dự án
              </Button>
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

        {isOwner && project.status !== "active" ? (
          <div className="flex flex-wrap items-center gap-2">
            {project.status === "done" && project.thanksMessageId === null ? (
              <Button variant="outline" className="press h-11 px-5" onClick={() => setIsThanksOpen(true)}>
                <Heart className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Gửi lời cảm ơn
              </Button>
            ) : null}
            <Button variant="outline" className="press h-11 px-5" disabled={isSubmitting} onClick={() => void handleReopen()}>
              <RotateCcw className="mr-1.5 h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Mở lại
            </Button>
            <p className="basis-full text-[12.5px] text-muted-foreground">
              Dự án đã đóng: nhóm, bảng và việc giữ nguyên, chỉ còn để đọc.
            </p>
          </div>
        ) : null}

        {isRootOwner ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setIsDeleteOpen(true)}
              className="press inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 py-2 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              Xoá dự án
            </button>
            <p className="text-[12px] text-muted-foreground">Chỉ Owner của nhóm gốc thấy nút này.</p>
          </div>
        ) : null}
      </section>

      <ThanksDialog project={project} open={isThanksOpen} onOpenChange={setIsThanksOpen} />
      <EarlyCloseDialog project={project} open={isEarlyOpen} onOpenChange={setIsEarlyOpen} />
      <DeleteDialog project={project} open={isDeleteOpen} onOpenChange={setIsDeleteOpen} onDeleted={onDeleted} />
    </>
  );
}
