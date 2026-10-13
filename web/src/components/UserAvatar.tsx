import { memo, useState, type MouseEvent } from "react";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { dotClasses, sizeClasses, type AvatarSize } from "@/lib/avatar-sizes";
import { avatarLook, useAvatar } from "@/lib/avatars";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  /** The Avora account. Absent for groups, projects and contacts not linked to an account → initials. */
  userId?: string | null;
  name: string;
  size?: AvatarSize;
  online?: boolean;
  className?: string;
};

const blockMenu = (event: MouseEvent): void => event.preventDefault();

/**
 * AVORA-115 — the one avatar of the app. Initials first, always; the person's picture is laid over
 * them only once it has loaded (no flash), and only when the server says this viewer may see it
 * (owner and friends). The picture is view-only: not draggable, not selectable, no context menu,
 * no "Save image" on long press (`avatar-view-only`). Avora does not let anyone save or forward
 * someone else's picture; it cannot stop a screenshot, and never says it can.
 */
export const UserAvatar = memo(({ userId, name, size = "md", online = false, className }: UserAvatarProps) => {
  const entry = useAvatar(userId ?? null);
  const url = entry?.url ?? null;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const look = avatarLook({ url, loadedUrl, failedUrl });

  return (
    <span className={cn("relative inline-flex shrink-0", className)} onContextMenu={url !== null ? blockMenu : undefined} data-avatar-look={look}>
      <InitialsAvatar name={name} size={size} />
      {url !== null && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
          className={cn(
            "avatar-view-only absolute left-0 top-0 rounded-full bg-secondary object-cover transition-opacity duration-150",
            sizeClasses[size],
            look === "image" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
      {online ? (
        <span aria-hidden="true" className={cn("absolute bottom-0 right-0 rounded-full border-2 border-card bg-online", dotClasses[size])} />
      ) : null}
    </span>
  );
});

UserAvatar.displayName = "UserAvatar";

/** The big, view-only picture (person card full screen). Initials when there is none to show. */
export function UserAvatarLarge({ userId, name }: { userId: string | null; name: string }) {
  const entry = useAvatar(userId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = entry?.url ?? null;
  return (
    <span
      className="relative flex h-[min(70vw,320px)] w-[min(70vw,320px)] items-center justify-center overflow-hidden rounded-full bg-secondary text-[min(18vw,88px)] font-semibold text-foreground/75"
      onContextMenu={blockMenu}
      data-avatar-large=""
    >
      {initialsOf(name)}
      {url !== null && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailedUrl(url)}
          className="avatar-view-only absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
