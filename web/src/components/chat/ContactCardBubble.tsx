import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { InitialsAvatar } from "@/components/InitialsAvatar";
import { fetchContactCard, fetchMessageRefs, REF_KIND_LABEL } from "@/lib/context-refs";
import { cn } from "@/lib/utils";

/**
 * AVORA-89 · `@@` (ADR-052) — a friend introduced by name + PIN. Read at view time; nothing
 * else (phone, email, note) ever travels. The button goes through the normal PIN invite flow.
 */
export function ContactCardBubble({ messageId, senderName, outgoing }: { messageId: string; senderName: string; outgoing: boolean }) {
  const navigate = useNavigate();
  const card = useQuery({ queryKey: ["contact-card", messageId], queryFn: () => fetchContactCard(messageId), staleTime: 60_000 });
  const person = card.data ?? null;
  return (
    <div data-contact-card="" className={cn("w-[260px] max-w-full rounded-[14px] border border-border bg-card p-3 text-foreground", outgoing ? "ml-auto" : "")}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" /> {outgoing ? "Bạn giới thiệu một người" : `${senderName} giới thiệu một người`}
      </p>
      {card.isPending ? (
        <p className="mt-2 text-[13px] text-muted-foreground">Đang mở…</p>
      ) : person === null ? (
        <p className="mt-2 text-[13.5px] text-muted-foreground" data-card-gone="">Không còn xem được</p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2.5">
            <InitialsAvatar name={person.name} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{person.name}</p>
              <p className="font-mono text-[12.5px] text-muted-foreground" data-card-pin="">{person.pin}</p>
            </div>
          </div>
          {person.isSelf ? null : (
            <button
              type="button"
              onClick={() => navigate(person.isFriend ? `/ket-noi/${encodeURIComponent(person.pin)}` : `/ket-noi/${encodeURIComponent(person.pin)}`)}
              className="press mt-3 h-10 w-full rounded-[10px] bg-primary text-[14px] font-semibold text-primary-foreground"
            >
              {person.isFriend ? "Nhắn tin" : "Gửi lời mời kết nối"}
            </button>
          )}
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">Chỉ có tên và PIN. {person.name} sẽ thấy lời mời như mọi lời mời bằng PIN.</p>
        </>
      )}
    </div>
  );
}

/** `#` chips under a message: label only while the viewer may still see it. */
export function MessageRefChips({ messageId, outgoing }: { messageId: string; outgoing: boolean }) {
  const refs = useQuery({ queryKey: ["message-refs", messageId], queryFn: () => fetchMessageRefs(messageId), staleTime: 60_000 });
  if ((refs.data ?? []).length === 0) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", outgoing ? "justify-end" : "")} data-message-refs="">
      {(refs.data ?? []).map((ref) => (
        <span key={`${ref.kind}:${ref.id}`} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] text-muted-foreground">
          <span className="shrink-0">#</span>
          <span className="truncate" data-ref-label={ref.label === null ? "gone" : ""}>{ref.label === null ? "Không còn xem được" : `${REF_KIND_LABEL[ref.kind]} · ${ref.label}`}</span>
        </span>
      ))}
    </div>
  );
}
