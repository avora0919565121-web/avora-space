import { useEffect, useRef } from "react";

/**
 * K3 · N9: the end of the 1-1 list. When it scrolls near view the next 50 threads load;
 * a plain button stays for keyboards, screen readers and browsers without IntersectionObserver.
 */
export function InboxMoreSentinel({ onLoadMore, isLoading }: { onLoadMore: () => void; isLoading: boolean }) {
  const ref = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <li ref={ref} data-inbox-more className="px-3 py-2">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={isLoading}
        className="press flex min-h-11 w-full items-center justify-center rounded-lg text-[13px] text-muted-foreground hover:bg-accent/30"
      >
        {isLoading ? "Đang tải thêm…" : "Xem thêm cuộc trò chuyện"}
      </button>
    </li>
  );
}
