/** AVORA-115: one set of avatar sizes, shared by the initials and the picture laid over them. */
export type AvatarSize = "sm" | "md" | "lg" | "xl";

export const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-9 w-9 text-[12px]",
  md: "h-11 w-11 text-[13px]",
  lg: "h-14 w-14 text-[16px]",
  xl: "h-20 w-20 text-[26px]",
};

export const dotClasses: Record<AvatarSize, string> = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
  xl: "h-4 w-4",
};
