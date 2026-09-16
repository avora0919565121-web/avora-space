import { useCallback, useState } from "react";

import {
  canImportRow,
  mergeIntoBusiness,
  mergeIntoIndividual,
  rowToBusinessDraft,
  rowToIndividualDraft,
  type DuplicateChoice,
  type ImportRow,
} from "@/lib/contact-import";
import { contactById, type Contact, type InviteMethod } from "@/lib/contacts";
import { useContactActions } from "@/lib/use-contacts";

/** How far a run has got, so the button can say something truthful while it works. */
export type ImportProgress = { done: number; total: number } | null;

export type ImportFailure = { lineNumber: number; name: string; reason: string };

export type ImportOutcome = {
  created: Contact[];
  merged: Contact[];
  failed: ImportFailure[];
};

/**
 * Writing the ticked rows, one at a time.
 *
 * Sequential rather than parallel on purpose: each row is a `create_contact` round trip that can
 * fail on its own terms, and a failure has to be attributable to a line number the person can
 * find in their file. Firing them at once would also let two rows for the same new person race.
 *
 * A failed row does not stop the run — the rest are still written, and every failure is reported
 * with its line so the file can be fixed and the remainder re-imported.
 */
export function useContactImport(): {
  run: (
    rows: readonly ImportRow[],
    choices: Readonly<Record<number, DuplicateChoice>>,
    contacts: readonly Contact[],
  ) => Promise<ImportOutcome>;
  progress: ImportProgress;
  isRunning: boolean;
} {
  const { addIndividual, addBusiness, saveIndividual, saveBusiness } = useContactActions();
  const [progress, setProgress] = useState<ImportProgress>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const run = useCallback(
    async (
      rows: readonly ImportRow[],
      choices: Readonly<Record<number, DuplicateChoice>>,
      contacts: readonly Contact[],
    ): Promise<ImportOutcome> => {
      const outcome: ImportOutcome = { created: [], merged: [], failed: [] };
      const doable = rows.filter((row) => canImportRow(row));

      setIsRunning(true);
      setProgress({ done: 0, total: doable.length });

      try {
        for (const [index, row] of doable.entries()) {
          const choice: DuplicateChoice =
            row.duplicate === null ? "create" : (choices[row.lineNumber] ?? "skip");

          try {
            if (choice === "skip") continue;

            if (choice === "merge" && row.duplicate !== null) {
              const existing = contactById(contacts, row.duplicate.contactId);
              if (existing === null) {
                outcome.failed.push({
                  lineNumber: row.lineNumber,
                  name: row.name,
                  reason: "Liên hệ cần gộp không còn nữa.",
                });
                continue;
              }
              const saved =
                existing.contactType === "individual"
                  ? await saveIndividual(existing.id, mergeIntoIndividual(existing, row))
                  : await saveBusiness(existing.id, mergeIntoBusiness(existing, row));
              outcome.merged.push(saved);
              continue;
            }

            const saved =
              row.kind === "business"
                ? await addBusiness(rowToBusinessDraft(row))
                : await addIndividual(rowToIndividualDraft(row));
            outcome.created.push(saved);
          } catch (error) {
            outcome.failed.push({
              lineNumber: row.lineNumber,
              name: row.name,
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

/** How far the invitations have got, counted the same way as the import itself. */
export type InviteProgress = { done: number; total: number } | null;

export type BulkInviteOutcome = {
  sent: number;
  failed: { name: string; reason: string }[];
};

/**
 * Sending invitations to the people just imported, one at a time.
 *
 * `create_contact_invite` refuses a channel the contact has no address for, so each row carries
 * the channel it was offered rather than a single choice applied to everyone — and a refusal on
 * one person is reported against their name instead of failing the batch.
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
