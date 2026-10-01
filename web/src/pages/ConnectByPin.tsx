import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { InviteMessageDialog } from "@/components/contacts/InviteMessageDialog";
import { looksLikePin, normalizePinInput } from "@/lib/connections";
import { useConnections } from "@/lib/use-connections";

/**
 * Where a scanned AVORA QR code lands: `/ket-noi/A-XXXXXXXX`.
 * Asks for the request message first (AVORA-56 · A), then opens the verification frame (or the
 * ordinary 1-1 between bạn) and moves on to the thread.
 */
const ConnectByPin = () => {
  const { pin = "" } = useParams<{ pin: string }>();
  const navigate = useNavigate();
  const { connectByPin } = useConnections();
  const isValid = looksLikePin(pin);
  const [isAsking, setIsAsking] = useState<boolean>(isValid);

  const send = useCallback(
    async (message: string): Promise<void> => {
      const conversationId = await connectByPin(normalizePinInput(pin), message);
      navigate(`/tin-nhan/${conversationId}`, { replace: true });
    },
    [pin, connectByPin, navigate],
  );

  return (
    <div className="paper flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-[15px] font-medium text-foreground">
          {isValid ? `Kết bạn với ${normalizePinInput(pin)}` : "Mã này không phải PIN AVORA."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {isValid ? (
            <button
              type="button"
              onClick={() => setIsAsking(true)}
              className="press inline-flex h-11 items-center rounded-[10px] bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/92"
            >
              Viết lời nhắn
            </button>
          ) : null}
          <Link
            to="/lien-he"
            className="press inline-flex h-11 items-center rounded-[10px] border border-border px-4 text-[14px] font-medium text-foreground hover:bg-accent/40"
          >
            Về Liên hệ
          </Link>
        </div>
      </div>
      <InviteMessageDialog
        open={isAsking}
        onOpenChange={setIsAsking}
        recipientLabel={isValid ? normalizePinInput(pin) : ""}
        onSend={send}
      />
    </div>
  );
};

export default ConnectByPin;
