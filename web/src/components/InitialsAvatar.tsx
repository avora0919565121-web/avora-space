import { memo } from "react";

import { dotClasses, sizeClasses, type AvatarSize } from "@/lib/avatar-sizes";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

type InitialsAvatarProps = {
  name: string;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
};

/**
 * Circular avatar built from initials on warm sand. AVORA-115: never imported directly any more —
 * `UserAvatar` draws it, and lays the person's own picture over it when they may be seen.
 */
export const InitialsAvatar = memo(({ name, size = "md", online = false, className }: InitialsAvatarProps) => (
  <span className={cn("relative inline-flex shrink-0", className)}>
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-secondary font-semibold tracking-wide text-foreground/75",
        sizeClasses[size],
      )}
    >
      {initialsOf(name)}
    </span>
    {online ? (
      <span
        aria-hidden="true"
        className={cn(
          "absolute bottom-0 right-0 rounded-full border-2 border-card bg-online",
          dotClasses[size],
        )}
      />
    ) : null}
  </span>
));

InitialsAvatar.displayName = "InitialsAvatar";
