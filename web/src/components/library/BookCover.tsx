import { memo, useState, type ReactNode } from "react";

import { coverColor } from "@/lib/library";
import { cn } from "@/lib/utils";

type Size = "shelf" | "continue" | "thumb" | "mini";

/**
 * AVORA-103 · C — one cover everywhere a book shows (shelf, Đọc tiếp, Thư viện mở, trên máy,
 * Kế hoạch, ghi chép sách).
 * • a real cover (kept by Avora, or my own photo) — with a strip carrying the Vietnamese title when
 *   the book has one, so it is recognised at a glance;
 * • otherwise Avora draws one in CSS: the shelf colour, the Vietnamese title large, the original
 *   title small, the author.
 */
export const BookCover = memo(function BookCover({
  title,
  original = null,
  author = null,
  url = null,
  viStrip = null,
  size = "shelf",
  className,
  children,
}: {
  /** The title people read first (Vietnamese when there is one). */
  title: string;
  original?: string | null;
  author?: string | null;
  url?: string | null;
  /** On a real cover: the Vietnamese title in a strip at the bottom. */
  viStrip?: string | null;
  size?: Size;
  className?: string;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = url !== null && failed !== url;
  const tiny = size === "mini" || size === "thumb";
  return (
    <span
      className={cn("relative flex aspect-[2/3] shrink-0 flex-col overflow-hidden shadow-sm ring-1 ring-black/10", size === "mini" ? "rounded-[3px]" : "rounded-md", className)}
      style={{ backgroundColor: coverColor(title) }}
      data-book-cover={showImage ? "image" : "drawn"}
    >
      {showImage ? (
        <>
          <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(url)} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          {viStrip !== null && viStrip !== "" && !tiny ? (
            <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 backdrop-blur-[2px]" data-cover-vi-strip="">
              <span className={cn("line-clamp-2 font-semibold leading-tight text-white", size === "continue" ? "text-[10.5px]" : "text-[11px]")}>{viStrip}</span>
            </span>
          ) : null}
        </>
      ) : tiny ? null : (
        <span className={cn("flex h-full flex-col justify-between", size === "continue" ? "p-2" : "p-2.5")} data-cover-drawn="">
          <span>
            <span className={cn("line-clamp-4 font-semibold leading-snug text-white", size === "continue" ? "text-[11px]" : "text-[13px]")}>{title}</span>
            {original !== null && original !== "" && original !== title ? (
              <span className="mt-1 line-clamp-2 block text-[10px] italic leading-tight text-white/70" data-cover-original="">
                {original}
              </span>
            ) : null}
          </span>
          {author !== null && author !== "" ? <span className="line-clamp-2 text-[11px] text-white/75">{author}</span> : null}
        </span>
      )}
      {children}
    </span>
  );
});
