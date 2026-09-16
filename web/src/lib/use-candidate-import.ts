import { useCallback, useState } from "react";

import {
  candidateToBusinessDraft,
  candidateToIndividualDraft,
  canImportCandidate,
  canMergeCandidate,
  EMPTY_TYPE_DECISION,
  extraChannelsOf,
  candidateNeedsReview,
  mergeCandidateIntoBusiness,
  mergeCandidateIntoIndividual,
  mergeChannelsOf,
  resolvedType,
  type CandidateChoice,
  type CandidateRow,
  type PendingChannel,
  type TypeDecision,
} from "@/lib/contact-candidates";
import { addContactChannel } from "@/lib/contact-channels";
import { contactById, type Contact, type InviteMethod } from "@/lib/contacts";
import { useContactActions } from "@/lib/use-contacts";

/** How far a run has got, so the button can say something truthful while it works. */
export type ImportProgress = { done: number; total: number } | null;

/** One candidate that could not be written, named the way the person can find it again. */
export type CandidateFailure = { origin: string; name: string; reason: string };

export type CandidateOutcome = {
  created: Contact[];
  merged: Contact[];
  failed: CandidateFailure[];
  /** Contacts whose channels a person now has to choose between. Drives the closing banner. */
  needsReviewCount: number;
};

/**
 * How many contacts are written at the same time.
 *
 * Enough that the waiting is spent in parallel instead of end to end — five thousand contacts
 * written one after another is minutes of staring at a bar. Not so many that a single import
 * saturates the connection pool the rest of the app shares, or reads to the server like
 * something to rate-limit.
 */
const IMPORT_CONCURRENCY = 12;

/** One ticked row, paired with everything already decided about it. */
type PlannedWrite = {
  /** Position in the ticked list. Results are filed by it so the report keeps file order. */
  index: number;
  row: CandidateRow;
  decision: TypeDecision;
  choice: CandidateChoice;
};

type WriteResult =
  | { kind: "created"; contact: Contact; reviewable: boolean }
  | { kind: "merged"; contact: Contact; reviewable: boolean }
  | { kind: "skipped" }
  | { kind: "failed"; failure: CandidateFailure };

/**
 * Which writes must not overlap each other.
 *
 * Two rows merging into the same existing contact are the one genuine race here: each sends a
 * whole draft built from the copy of that contact it read, so run together the second would
 * overwrite what the first had just filled in. They are put in one lane and run in order.
 *
 * Everything else gets a lane of its own, because a create touches nobody else's row.
 */
function laneKeyOf(task: PlannedWrite): string {
  if (task.choice === "merge" && task.row.duplicate !== null) {
    return `contact:${task.row.duplicate.contactId}`;
  }
  return `row:${task.index}`;
}

/**
 * Writing the ticked candidates, several at a time.
 *
 * The work is split into lanes that cannot interfere, and a small pool of workers takes a lane
 * at a time. Within a lane the writes stay in order, so merging two spreadsheet rows into one
 * existing person still happens one after the other and neither overwrites the other.
 *
 * A failure does not stop the run: the rest are still written, and every failure is reported
 * with its origin so a partly bad file still gets its good rows in. Results are filed by
 * position rather than by arrival, which keeps "Dòng 4, Dòng 9" reading in the order the person
 * will look for them in their file.
 */
export function useCandidateImport(): {
  run: (
    rows: readonly CandidateRow[],
    choices: Readonly<Record<string, CandidateChoice>>,
    decisions: Readonly<Record<string, TypeDecision>>,
    contacts: readonly Contact[],
  ) => Promise<CandidateOutcome>;
  progress: ImportProgress;
  isRunning: boolean;
} {
  const { addIndividual, addBusiness, saveIndividual, saveBusiness } = useContactActions();
  const [progress, setProgress] = useState<ImportProgress>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const run = useCallback(
    async (
      rows: readonly CandidateRow[],
      choices: Readonly<Record<string, CandidateChoice>>,
      decisions: Readonly<Record<string, TypeDecision>>,
      contacts: readonly Contact[],
    ): Promise<CandidateOutcome> => {
      const outcome: CandidateOutcome = {
        created: [],
        merged: [],
        failed: [],
        needsReviewCount: 0,
      };

      const decisionOf = (row: CandidateRow): TypeDecision =>
        decisions[row.key] ?? EMPTY_TYPE_DECISION;
      const doable = rows.filter((row) => canImportCandidate(row, decisionOf(row)));

      const tasks: PlannedWrite[] = doable.map((row, index) => ({
        index,
        row,
        decision: decisionOf(row),
        choice: row.duplicate === null ? "create" : (choices[row.key] ?? "skip"),
      }));

      const total = tasks.length;
      const results: WriteResult[] = new Array<WriteResult>(total);

      setIsRunning(true);
      setProgress({ done: 0, total });

      // Painted on a timer rather than on every write. At this size the count changes faster
      // than a screen refreshes, and re-rendering the dialog five thousand times would make the
      // import slower than the requests it is reporting on.
      let done = 0;
      let paintedAt = 0;
      const countOne = (): void => {
        done += 1;
        const now = Date.now();
        if (done === total || now - paintedAt >= 80) {
          paintedAt = now;
          setProgress({ done, total });
        }
      };

      const runOne = async (task: PlannedWrite): Promise<WriteResult> => {
        const { row, decision, choice } = task;
        const { candidate } = row;
        const reviewable = candidateNeedsReview(candidate);

        try {
          if (choice === "skip") return { kind: "skipped" };

          // A merge the screen would not have offered is refused here too, in case the two
          // ever disagree: the request would otherwise rewrite a company as a person.
          if (choice === "merge" && row.duplicate !== null && canMergeCandidate(row, decision)) {
            const existing = contactById(contacts, row.duplicate.contactId);
            if (existing === null) {
              return {
                kind: "failed",
                failure: {
                  origin: row.origin,
                  name: candidate.name,
                  reason: "Liên hệ cần gộp không còn nữa.",
                },
              };
            }

            const saved =
              existing.contactType === "individual"
                ? await saveIndividual(
                    existing.id,
                    mergeCandidateIntoIndividual(existing, candidate),
                  )
                : await saveBusiness(
                    existing.id,
                    mergeCandidateIntoBusiness(existing, candidate, decision),
                  );

            // Every value is offered; the RPC keeps only the ones that are neither the primary
            // channel nor already stored, so a merge adds numbers without overwriting any.
            const added = await fileChannels(
              saved.id,
              mergeChannelsOf(candidate),
              candidate.source,
              reviewable,
            );

            return { kind: "merged", contact: saved, reviewable: reviewable && added > 0 };
          }

          const type = resolvedType(row, decision);
          const saved =
            type === "business"
              ? await addBusiness(candidateToBusinessDraft(candidate, decision))
              : await addIndividual(candidateToIndividualDraft(candidate));

          const added = await fileChannels(
            saved.id,
            extraChannelsOf(candidate),
            candidate.source,
            reviewable,
          );

          return { kind: "created", contact: saved, reviewable: reviewable && added > 0 };
        } catch (error) {
          return {
            kind: "failed",
            failure: {
              origin: row.origin,
              name: candidate.name,
              reason: (error as Error).message,
            },
          };
        }
      };

      const lanes = new Map<string, PlannedWrite[]>();
      for (const task of tasks) {
        const key = laneKeyOf(task);
        const lane = lanes.get(key);
        if (lane === undefined) lanes.set(key, [task]);
        else lane.push(task);
      }

      const queue = [...lanes.values()];
      let cursor = 0;

      try {
        // Workers take the next lane rather than a fixed share, so one slow lane cannot leave
        // the others idle behind it.
        await Promise.all(
          Array.from({ length: Math.min(IMPORT_CONCURRENCY, queue.length) }, async () => {
            for (;;) {
              const at = cursor;
              cursor += 1;
              if (at >= queue.length) return;

              for (const task of queue[at]) {
                results[task.index] = await runOne(task);
                countOne();
              }
            }
          }),
        );
      } finally {
        setIsRunning(false);
        setProgress(null);
      }

      for (const result of results) {
        if (result === undefined || result.kind === "skipped") continue;
        if (result.kind === "failed") {
          outcome.failed.push(result.failure);
          continue;
        }
        if (result.reviewable) outcome.needsReviewCount += 1;
        if (result.kind === "created") outcome.created.push(result.contact);
        else outcome.merged.push(result.contact);
      }

      return outcome;
    },
    [addIndividual, addBusiness, saveIndividual, saveBusiness],
  );

  return { run, progress, isRunning };
}

/**
 * Files the channels that did not fit on the contact row, and says how many stuck.
 *
 * A channel that fails is deliberately not fatal to its contact: the person is already written
 * down and reachable on their primary number, so throwing here would undo a good import over a
 * spare phone number. The count is what decides whether the review banner appears — a contact
 * whose extra channels all turned out to be duplicates has nothing to review.
 */
async function fileChannels(
  contactId: string,
  channels: readonly PendingChannel[],
  source: CandidateRow["candidate"]["source"],
  needsReview: boolean,
): Promise<number> {
  let stored = 0;

  for (const channel of channels) {
    try {
      const saved = await addContactChannel({
        contactId,
        kind: channel.kind,
        value: channel.value,
        source,
        // Only a vCard suggests one; every other route sends null and the channel stays
        // unnamed, which is the honest state of not knowing what to call it.
        label: channel.label,
        needsReview,
      });
      if (saved !== null) stored += 1;
    } catch (error) {
      console.error("[candidate-import] không lưu được kênh liên hệ phụ", error);
    }
  }

  return stored;
}

/** How far the invitations have got, counted the same way as the import itself. */
export type InviteProgress = { done: number; total: number } | null;

export type BulkInviteOutcome = {
  sent: number;
  failed: { name: string; reason: string }[];
};

/**
 * Sending invitations to the people just imported, one at a time.
 *
 * `create_contact_invite` refuses a channel the contact has no address for, so each target
 * carries the channel it was offered rather than one choice applied to everyone — and a refusal
 * for one person is reported against their name instead of failing the batch.
 */
export function useBulkInvite(): {
  send: (
    targets: readonly { contactId: string; name: string; method: InviteMethod }[],
  ) => Promise<BulkInviteOutcome>;
  progress: InviteProgress;
  isSending: boolean;
} {
  const { invite } = useContactActions();
  const [progress, setProgress] = useState<InviteProgress>(null);
  const [isSending, setIsSending] = useState<boolean>(false);

  const send = useCallback(
    async (
      targets: readonly { contactId: string; name: string; method: InviteMethod }[],
    ): Promise<BulkInviteOutcome> => {
      const outcome: BulkInviteOutcome = { sent: 0, failed: [] };

      setIsSending(true);
      setProgress({ done: 0, total: targets.length });

      try {
        for (const [index, target] of targets.entries()) {
          try {
            await invite(target.contactId, target.method);
            outcome.sent += 1;
          } catch (error) {
            outcome.failed.push({ name: target.name, reason: (error as Error).message });
          } finally {
            setProgress({ done: index + 1, total: targets.length });
          }
        }
      } finally {
        setIsSending(false);
        setProgress(null);
      }

      return outcome;
    },
    [invite],
  );

  return { send, progress, isSending };
}
