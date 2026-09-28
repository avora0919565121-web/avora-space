import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { looksLikePin, normalizePinInput } from "@/lib/connections";
import { useConnections } from "@/lib/use-connections";

/**
 * Where a scanned AVORA QR code lands: `/ket-noi/A-XXXXXXXX`.
 * Opens the verification frame (or the ordinary 1-1 between bạn) and moves on to the thread.
 */
const ConnectByPin = () => {
  const { pin = "" } = useParams<{ pin: string }>();
  const navigate = useNavigate();
  const { connectByPin } = useConnections();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!looksLikePin(pin)) {
      setError("Mã này không phải PIN AVORA.");
      return;
    }
    connectByPin(normalizePinInput(pin))
      .then((conversationId) => navigate(`/tin-nhan/${conversationId}`, { replace: true }))
      .catch((reason: Error) => setError(reason.message));
  }, [pin, connectByPin, navigate]);

  return (
    <div className="paper flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        {error === null ? (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-[14px] text-muted-foreground">Đang mở khung kết bạn…</p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium text-foreground">{error}</p>
            <Link
              to="/lien-he"
              className="press mt-4 inline-flex rounded-md border border-border px-4 py-2 text-[13.5px] font-medium text-foreground hover:bg-accent/40"
            >
              Về Liên hệ
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default ConnectByPin;
