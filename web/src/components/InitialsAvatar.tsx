import { memo } from "react";

import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

type InitialsAvatarProps = {
  name: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
  className?: string;
};

const sizeClasses: Record<NonNullable<InitialsAvatarProps["size"]>, string> = {
  sm: "h-9 w-9 text-[12px]",
  md: "h-11 w-11 text-[13px]",
  lg: "h-14 w-14 text-[16px]",
};

const dotClasses: Record<NonNullable<InitialsAvatarProps["size"]>, string> = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
};

/** Circular avatar built from initials on warm sand — the app has no stock photography. */
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
