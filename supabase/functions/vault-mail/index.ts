// AVORA-51 · vault-mail — sends the Két sắt / security emails through the Resend API:
//   · reset_code: the 6-digit code that lets the owner set a new Két sắt code (10 minutes, one use).
//   · alarm (reset | change): "the Két sắt code was just reset / changed" — sent on every reset or change.
//   · alarm (signout): AVORA-54 · C — "the account was just signed out on every other device".
// Called only by private.vault_send_mail() (pg_net), guarded by the same header secret as send-push.
// The code is never logged.

const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "AVORA <no-reply@avorachat.com>";

type Body =
  | { kind: "reset_code"; email: string; code: string }
  | { kind: "alarm"; action: "reset" | "change" | "signout"; email: string; when: string };

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function frame(vi: string, en: string, footer: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#F6F3EC;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F3EC;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid #E6DFD3;border-radius:16px;">
<tr><td style="padding:36px 36px 0 36px;font-family:${FONT};"><span style="font-size:17px;font-weight:700;letter-spacing:0.14em;color:#E0603C;">AVORA</span></td></tr>
<tr><td style="padding:20px 36px 0 36px;font-family:${FONT};color:#1C1A17;">${vi}</td></tr>
<tr><td style="padding:28px 36px 0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E6DFD3;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:24px 36px 0 36px;font-family:${FONT};color:#1C1A17;">${en}</td></tr>
<tr><td style="padding:24px 36px 0 36px;font-family:${FONT};color:#1C1A17;"><p style="margin:0;font-size:15px;line-height:24px;">Thân mời,<br>Đội ngũ AVORA</p></td></tr>
<tr><td style="padding:20px 36px 32px 36px;font-family:${FONT};"><p style="margin:0;font-size:12px;line-height:19px;color:#9B948A;">${footer}</p></td></tr>
</table></td></tr></table></body></html>`;
}

const p = (text: string, extra = ""): string => `<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;${extra}">${text}</p>`;
const codeBox = (code: string): string =>
  `<p style="margin:6px 0 18px 0;font-size:30px;line-height:38px;font-weight:700;letter-spacing:0.3em;color:#1C1A17;">${escapeHtml(code)}</p>`;

function compose(body: Body): { subject: string; html: string; text: string } {
  const email = escapeHtml(body.email);
  if (body.kind === "reset_code") {
    const vi = p("Chào bạn,") + p("Đây là mã xác nhận để đặt lại mã Két sắt trong AVORA:") + codeBox(body.code) +
      p("Mã dùng được một lần, hết hạn sau 10 phút.", "font-size:13px;color:#6B655B;") +
      p("Không phải bạn yêu cầu? Đừng đưa mã này cho ai, và hãy đổi mật khẩu tài khoản AVORA ngay.", "font-size:14px;");
    const en = p("Hi,") + p("Here is the code to reset your AVORA Két sắt (Vault) code:") + codeBox(body.code) +
      p("It works once and expires in 10 minutes.", "font-size:13px;color:#6B655B;") +
      p("Didn't ask for this? Don't share this code with anyone, and change your AVORA account password now.", "font-size:14px;");
    return {
      subject: `${body.code} là mã đặt lại Két sắt AVORA`,
      html: frame(vi, en, `Email này được gửi tới ${email} vì có yêu cầu đặt lại mã Két sắt.`),
      text: `Mã đặt lại Két sắt AVORA: ${body.code}\nDùng một lần, hết hạn sau 10 phút.\nKhông phải bạn? Đổi mật khẩu tài khoản ngay.`,
    };
  }
  const verb = body.action === "reset" ? "đặt lại" : body.action === "change" ? "đổi" : null;
  if (verb === null) {
    // AVORA-54 · C — signed out on every other device.
    const when = escapeHtml(body.when);
    const vi = p("Chào bạn,") +
      p(`Tài khoản của bạn vừa được <strong>đăng xuất trên mọi thiết bị khác</strong> lúc ${when}.`) +
      p("Không phải bạn? Đổi mật khẩu tài khoản AVORA ngay.", "font-size:14px;");
    const en = p("Hi,") +
      p(`Your AVORA account was just <strong>signed out on every other device</strong> at ${when}.`) +
      p("Wasn't you? Change your AVORA account password now.", "font-size:14px;");
    return {
      subject: "AVORA: vừa đăng xuất mọi thiết bị khác",
      html: frame(vi, en, `Email này được gửi tới ${email} mỗi khi tài khoản được đăng xuất từ xa.`),
      text: `Tài khoản AVORA vừa được đăng xuất trên mọi thiết bị khác lúc ${body.when}. Không phải bạn? Đổi mật khẩu ngay.`,
    };
  }
  const verbEn = body.action === "reset" ? "reset" : "changed";
  const when = escapeHtml(body.when);
  const vi = p("Chào bạn,") + p(`Mã Két sắt vừa được <strong>${verb}</strong> lúc ${when}.`) +
    p("Không phải bạn? Đổi mật khẩu tài khoản AVORA ngay, rồi đặt lại mã Két sắt.", "font-size:14px;");
  const en = p("Hi,") + p(`Your Két sắt (Vault) code was just <strong>${verbEn}</strong> at ${when}.`) +
    p("Wasn't you? Change your AVORA account password now, then reset the Két sắt code.", "font-size:14px;");
  return {
    subject: `Mã Két sắt vừa được ${verb}`,
    html: frame(vi, en, `Email này được gửi tới ${email} mỗi khi mã Két sắt thay đổi.`),
    text: `Mã Két sắt vừa được ${verb} lúc ${body.when}. Không phải bạn? Đổi mật khẩu tài khoản ngay.`,
  };
}

function isBody(value: unknown): value is Body {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.email !== "string" || !v.email.includes("@")) return false;
  if (v.kind === "reset_code") return typeof v.code === "string" && /^[0-9]{6}$/.test(v.code);
  if (v.kind === "alarm") {
    return (
      (v.action === "reset" || v.action === "change" || v.action === "signout") && typeof v.when === "string"
    );
  }
  return false;
}

Deno.serve(async (req) => {
  if (cronSecret === "" || req.headers.get("x-avora-cron") !== cronSecret) {
    return new Response("forbidden", { status: 403 });
  }
  if (resendKey === "") return new Response(JSON.stringify({ error: "resend_missing" }), { status: 500 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad_json" }), { status: 400 });
  }
  if (!isBody(body)) return new Response(JSON.stringify({ error: "bad_body" }), { status: 400 });
  const mail = compose(body);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [body.email], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) {
    console.error("[vault-mail] resend", body.kind, res.status);
    return new Response(JSON.stringify({ error: "send_failed", status: res.status }), { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
