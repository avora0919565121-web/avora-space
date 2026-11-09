import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/use-online";
import { NEEDS_NETWORK_MESSAGE } from "@/lib/blocks";
import { SUPPORT_BODY_MAX, SUPPORT_EMAIL, submitSupportRequest } from "@/lib/safety";

const inputClass =
  "mt-1 w-full rounded-[10px] border border-input bg-background px-3 py-2.5 text-[16px] md:text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-personal/60";

/** 111-B · Cài đặt › Hỗ trợ và liên hệ: the address, and a short form that reaches Avora's team. */
export function SupportSection({ defaultName }: { defaultName: string }) {
  const { user } = useAuth();
  const isOnline = useOnline();
  const [name, setName] = useState<string>(defaultName);
  const [email, setEmail] = useState<string>(user?.email ?? "");
  const [body, setBody] = useState<string>("");
  const send = useMutation({ mutationFn: () => submitSupportRequest({ name, email, body }) });
  const canSend = name.trim() !== "" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && body.trim() !== "" && isOnline && !send.isPending;

  return (
    <section id="ho-tro" aria-labelledby="support-heading" data-testid="support-section" className="mt-s-4 scroll-mt-4 rounded-card border border-border bg-card p-s-4">
      <h2 id="support-heading" className="text-[17px] font-semibold text-foreground">Hỗ trợ và liên hệ</h2>
      <a href={`mailto:${SUPPORT_EMAIL}`} className="press mt-s-2 flex min-h-11 items-center gap-2 text-[14px] font-medium text-foreground">
        <Mail className="h-[18px] w-[18px] text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
        {SUPPORT_EMAIL}
      </a>
      {send.isSuccess ? (
        <p className="mt-s-2 flex items-start gap-2 rounded-md bg-accent/60 px-3 py-2.5 text-[14px] text-foreground" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
          Đã gửi. Avora sẽ trả lời qua email {email.trim()}.
        </p>
      ) : (
        <form
          className="mt-s-2 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) send.mutate();
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-[13px] font-medium text-muted-foreground">
              Tên
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className={inputClass} />
            </label>
            <label className="block text-[13px] font-medium text-muted-foreground">
              Email nhận trả lời
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} className={inputClass} />
            </label>
          </div>
          <label className="block text-[13px] font-medium text-muted-foreground">
            Nội dung
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} maxLength={SUPPORT_BODY_MAX} placeholder="Bạn cần Avora giúp gì?" className={`${inputClass} resize-y leading-6`} />
          </label>
          {send.isError ? <p role="alert" className="text-[13px] text-destructive">{send.error.message}</p> : null}
          <div className="flex items-center justify-end gap-3">
            {!isOnline ? <span className="mr-auto text-[12.5px] text-muted-foreground">{NEEDS_NETWORK_MESSAGE}</span> : null}
            <button type="submit" disabled={!canSend} className="press flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Gửi
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
