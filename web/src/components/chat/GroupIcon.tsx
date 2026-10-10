import { GROUP_ICONS } from "@/lib/group-icons";


export function GroupIconGlyph({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = GROUP_ICONS[iconKey];
  if (Icon === undefined) return null;
  return <Icon className={className} strokeWidth={1.75} aria-hidden="true" />;
}
