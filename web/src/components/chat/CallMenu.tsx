import { Phone } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { handOffCall } from "@/lib/call-handoff";
import { CALL_APPS, peerPhone, type CallApp } from "@/lib/calls";
import { useContactChannels } from "@/lib/use-contact-channels";
import { useContacts } from "@/lib/use-contacts";

const ICON_CLASS = "press rounded-md p-2 transition-colors hover:bg-accent/50 hover:text-foreground data-[state=open]:bg-accent/60";

/**
 * The call icon of a 1-1: pick Điện thoại, Zalo or WhatsApp and the call is handed to that app.
 *
 * The number comes from the viewer's own Liên hệ entry for this person. Zalo and WhatsApp get the
 * number copied first, so it is ready to paste if the app opens on its home screen instead of the
 * chat. Nothing is dialled by AVORA itself.
 */
export function CallMenu({ peerId, peerName }: { peerId: string | null; peerName: string }) {
  const contactsQuery = useContacts();
  const channelsQuery = useContactChannels();
  const found = useMemo(
    () => peerPhone(peerId, contactsQuery.data ?? [], channelsQuery.data ?? []),
    [peerId, contactsQuery.data, channelsQuery.data],
  );

  const call = async (app: CallApp): Promise<void> => {
    if (found === null) return;
    await handOffCall(app, found.phone);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Gọi ${peerName}`} title="Gọi" className={ICON_CLASS}>
          <Phone className="h-[19px] w-[19px]" strokeWidth={1.6} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[256px] rounded-xl p-1.5">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5">
          <span className="block text-[13px] font-semibold text-foreground">Gọi {peerName}</span>
          <span className="block text-[12px] font-normal text-muted-foreground">
            {found === null ? "Chưa có số điện thoại trong Liên hệ" : found.phone}
          </span>
        </DropdownMenuLabel>
        {found === null ? (
          <DropdownMenuItem asChild className="min-h-11 rounded-lg px-2.5 text-[14px]">
            <Link to="/lien-he">Thêm số trong Liên hệ</Link>
          </DropdownMenuItem>
        ) : (
          CALL_APPS.map((app) => (
            <DropdownMenuItem
              key={app.id}
              onSelect={() => void call(app.id)}
              className="min-h-12 flex-col items-start gap-0 rounded-lg px-2.5 py-2"
            >
              <span className="text-[14px] font-medium text-foreground">{app.label}</span>
              <span className="text-[12px] text-muted-foreground">{app.note}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
