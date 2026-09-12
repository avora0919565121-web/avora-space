import type { LucideIcon } from "lucide-react";

/**
 * A half of a section that exists in the navigation but not yet in the product.
 * One line, no inputs: there is nothing here to fill in, and pretending
 * otherwise would promise a feature that cannot answer.
 */
export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="paper min-h-0 flex-1 overflow-y-auto">
      <div className="animate-rise-in mx-auto flex max-w-lg flex-col items-center px-6 py-20 text-center md:py-28">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
          <Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-[24px] font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        <p className="wordmark mt-7 rounded-full border border-border bg-card px-4 py-1.5 text-[11px] text-muted-foreground">
          Sắp ra mắt
        </p>
      </div>
    </div>
  );
}
