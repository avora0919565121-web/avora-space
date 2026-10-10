import { MessageComposer, type MessageComposerProps } from "@/components/chat/MessageComposer";
import { setComposerDraft, useComposerDraft } from "@/lib/composer-draft";

/**
 * K3 · N3: the composer bound to its thread's draft store. Only this subtree re-renders while
 * typing; the chat screen around it hears about a keystroke only through `onTyped`.
 */
export function DraftedComposer({
  userId,
  conversationId,
  onTyped,
  ...props
}: Omit<MessageComposerProps, "value" | "onValueChange"> & {
  userId: string | undefined;
  conversationId: string | undefined;
  onTyped?: (next: string) => void;
}) {
  const value = useComposerDraft(userId, conversationId);
  return (
    <MessageComposer
      {...props}
      value={value}
      onValueChange={(next) => {
        setComposerDraft(userId, conversationId, next);
        onTyped?.(next);
      }}
    />
  );
}
