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
 * Writing the ticked candidates, one at a time.
 *
 * Sequential rather than parallel: each candidate is a `create_contact` round trip that can fail
 * on its own terms, and a failure has to be attributable to something the person can locate in
 * their file or their phone book. Firing them together would also let two entries for the same
 * new person race each other into the book.
 *
 * A failure does not stop the run. The rest are still written and every failure is reported with
 * its origin, so a partly bad file still gets its good rows in.
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

      setIsRunning(true);
      setProgress({ done: 0, total: doable.length });

      try {
        for (const [index, row] of doable.entries()) {
          const decision = decisionOf(row);
          const { candidate } = row;
          const choice: CandidateChoice =
            row.duplicate === null ? "create" : (choices[row.key] ?? "skip");
          const flagged = candidateNeedsReview(candidate);

          try {
            if (choice === "skip") continue;

            // A merge the screen would not have offered is refused here too, in case the two
            // ever disagree: the request would otherwise rewrite a company as a person.
            if (choice === "merge" && row.duplicate !== null && canMergeCandidate(row, decision)) {
              const existing = contactById(contacts, row.duplicate.contactId);
              if (existing === null) {
                outcome.failed.push({
                  origin: row.origin,
                  name: candidate.name,
                  reason: "Liên hệ cần gộp không còn nữa.",
                });
                continue;
              }

              const saved =
                existing.contactType === "individual"
                  ? await saveIndividual(existing.id, mergeCandidateIntoIndividual(existing, candidate))
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
                flagged,
              );
              if (added > 0 && flagged) outcome.needsReviewCount += 1;

              outcome.merged.push(saved);
              continue;
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
              flagged,
            );
            if (added > 0 && flagged) outcome.needsReviewCount += 1;

            outcome.created.push(saved);
          } catch (error) {
            outcome.failed.push({
              origin: row.origin,
              name: candidate.name,
              reason: (error as Error).message,
            });
          } finally {
            setProgress({ done: index + 1, total: doable.length });
          }
        }
      } finally {
        setIsRunning(false);
        setProgress(null);
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
