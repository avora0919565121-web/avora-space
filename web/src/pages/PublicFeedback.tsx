import { CheckCircle2, ChevronLeft } from "lucide-react";
import { useState } from "react";

import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { useAuth } from "@/lib/auth";
import { feedbackContext, submitPublicFeedback } from "@/lib/feedback";

/**
 * AVORA-100 · G.2 — `/gop-y`, open to anyone without signing in. The same sheet, an optional email
 * instead of a picture, a hidden field for bots; the server allows 30 a minute in all.
 * `‹ AVORA` is the way out (an installed app has no browser Back — luật 94B · C).
 */
const PublicFeedback = () => {
  const { session } = useAuth();
  const [isSent, setIsSent] = useState<boolean>(false);

  return (
    <div className="paper min-h-[100dvh] scroll-y" data-public-feedback="">
      <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-6 md:px-10 md:pt-10">
        <a href={session !== null ? "/cai-dat/gop-y" : "/dang-nhap"} data-feedback-exit="" className="press -ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-md px-2 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          <span className="wordmark text-[15px]">AVORA</span>
        </a>
        <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-foreground">Góp ý cho Avora</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Không cần tài khoản. Đội Avora đọc từng góp ý.</p>

        {isSent ? (
          <div className="mt-8 rounded-card border border-border bg-card p-6 text-center" data-feedback-sent="">
            <CheckCircle2 className="mx-auto h-8 w-8 text-primary" strokeWidth={1.6} aria-hidden="true" />
            <p className="mt-3 text-[17px] font-semibold text-foreground">Đã nhận góp ý. Cảm ơn bạn!</p>
            <button type="button" onClick={() => setIsSent(false)} className="press mt-4 min-h-11 rounded-control border border-border px-5 text-[15px] text-foreground">
              Gửi thêm một góp ý
            </button>
          </div>
        ) : (
          <FeedbackForm
            variant="web"
            className="mt-6"
            onSubmit={async (draft) => {
              await submitPublicFeedback({ kind: draft.kind, body: draft.body, email: draft.email, trap: draft.trap }, feedbackContext("/gop-y"));
              setIsSent(true);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default PublicFeedback;
