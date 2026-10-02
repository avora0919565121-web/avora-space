// AVORA-51 · vault-mail — sends the Két sắt / security emails through the Resend API:
//   · reset_code: the 6-digit code that lets the owner set a new Két sắt code (10 minutes, one use).
//   · alarm (reset | change): "the Két sắt code was just reset / changed" — sent on every reset or change.
//   · alarm (signout): AVORA-54 · C — "the account was just signed out on every other device".
// Called only by private.vault_send_mail() (pg_net), guarded by the same header secret as send-push.
// The code is never logged.

const cronSecret = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = "AVORA <no-reply@avorachat.com>";

type DeviceAction = "new" | "rank_code" | "rank_taken" | "lost_report" | "lost_result" | "lock_on" | "lock_attempt" | "lock_escape";

type Body =
  | { kind: "reset_code"; email: string; code: string }
  | { kind: "alarm"; action: "reset" | "change" | "signout"; email: string; when: string }
  | {
      // AVORA-67: device emails. Only labels, times and one-use links — never a PIN or a full name.
      kind: "device";
      action: DeviceAction;
      email: string;
      when: string;
      label?: string;
      old_label?: string;
      reporter?: string;
      code?: string;
      rank?: number;
      days?: number;
      result?: string;
      link?: string;
    };

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

const button = (href: string, label: string): string =>
  `<p style="margin:8px 0 18px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background-color:#E0603C;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;">${escapeHtml(label)}</a></p>`;

function composeDevice(body: Extract<Body, { kind: "device" }>): { subject: string; html: string; text: string } {
  const email = escapeHtml(body.email);
  const when = escapeHtml(body.when);
  const label = escapeHtml(body.label ?? "Thiết bị");
  const rank = escapeHtml(String(body.rank ?? ""));
  const footer = `Email này được gửi tới ${email} về thiết bị của tài khoản AVORA.`;
  const link = body.link !== undefined && /^https:\/\//.test(body.link) ? body.link : null;
  const open = link === null ? "" : button(link, "Mở trang xác nhận");
  const scanNote = p("Mở trang không làm gì cả — bạn phải bấm nút trên trang. Liên kết dùng một lần.", "font-size:13px;color:#6B655B;");
  const enLink = link === null ? "" : button(link, "Open the confirmation page");
  let subject = "AVORA: thiết bị";
  let vi = "";
  let en = "";
  switch (body.action) {
    case "new":
      subject = `AVORA: có máy mới đăng nhập (${body.label ?? ""})`;
      vi = p("Chào bạn,") + p(`Có máy mới vừa đăng nhập tài khoản của bạn: <strong>${label}</strong> lúc ${when}.`) +
        p("Không phải bạn? Mở AVORA trên máy chính › Cài đặt › Hồ sơ › Bảo mật để ngắt máy đó, rồi đổi mật khẩu.", "font-size:14px;");
      en = p("Hi,") + p(`A new device just signed in to your account: <strong>${label}</strong> at ${when}.`) +
        p("Wasn't you? Remove it from Settings › Profile › Security on your main device, then change your password.", "font-size:14px;");
      break;
    case "rank_code":
      subject = `${body.code ?? ""} là mã đặt Ưu tiên ${body.rank ?? ""} AVORA`;
      vi = p("Chào bạn,") + p(`Mã để đặt <strong>${label}</strong> làm <strong>Ưu tiên ${rank}</strong>:`) + codeBox(body.code ?? "") +
        p("Mã dùng một lần, hết hạn sau 10 phút. Máy đang giữ bậc này sẽ thành Máy khác.", "font-size:13px;color:#6B655B;") +
        p("Không phải bạn? Đừng đưa mã này cho ai và đổi mật khẩu ngay.", "font-size:14px;");
      en = p("Hi,") + p(`The code to make <strong>${label}</strong> your <strong>Priority ${rank}</strong> device:`) + codeBox(body.code ?? "") +
        p("One use, expires in 10 minutes.", "font-size:13px;color:#6B655B;");
      break;
    case "rank_taken":
      subject = `AVORA: ${body.label ?? ""} vừa nhận Ưu tiên ${body.rank ?? ""}`;
      vi = p("Chào bạn,") + p(`<strong>${label}</strong> vừa nhận <strong>Ưu tiên ${rank}</strong> lúc ${when}. <strong>${escapeHtml(body.old_label ?? "")}</strong> đã bị đăng xuất và thành Máy khác.`) +
        p("Không phải bạn? Bấm <strong>Không phải tôi</strong> trên trang dưới đây (cần mật khẩu tài khoản) để lấy lại bậc và gỡ máy kia.") + open + scanNote;
      en = p("Hi,") + p(`<strong>${label}</strong> just took <strong>Priority ${rank}</strong>. Your previous device was signed out.`) +
        p("Wasn't you? Press <strong>Not me</strong> on the page below (account password needed).") + enLink;
      break;
    case "lost_report":
      subject = `AVORA: ${body.label ?? ""} đã được báo mất — xác nhận giúp`;
      vi = p("Chào bạn,") + p(`<strong>${label}</strong> đã được báo mất từ <strong>${escapeHtml(body.reporter ?? "")}</strong> lúc ${when}. Máy đó đã ngừng dùng.`) +
        p(`Trên trang xác nhận có 3 lựa chọn: <strong>Đúng, tôi đã báo</strong> · <strong>Sai — tôi không báo mất</strong> · <strong>Tôi đã tìm lại thiết bị</strong>. Sau ${escapeHtml(String(body.days ?? 3))} ngày mà không ai bấm, AVORA coi như <strong>Đúng</strong>.`) +
        open + scanNote;
      en = p("Hi,") + p(`<strong>${label}</strong> was reported lost from another device of yours. It has stopped working.`) +
        p(`Confirm, reject or mark it found on the page below. With no answer in ${escapeHtml(String(body.days ?? 3))} days it counts as confirmed.`) + enLink;
      break;
    case "lost_result": {
      const result = body.result === "confirm" ? "đã được gỡ hẳn khỏi tài khoản" : body.result === "reject" ? "được dùng lại (báo mất bị từ chối); máy đã gửi báo bị đăng xuất" : "đã trở lại như cũ";
      subject = `AVORA: kết quả báo mất ${body.label ?? ""}`;
      vi = p("Chào bạn,") + p(`<strong>${label}</strong> ${result} lúc ${when}.`) +
        (body.result === "reject" ? p("Nên đổi mật khẩu tài khoản ngay.", "font-size:14px;") : "");
      en = p("Hi,") + p(`The lost-device report for <strong>${label}</strong> is settled (${escapeHtml(body.result ?? "")}).`);
      break;
    }
    case "lock_on":
      subject = "AVORA: đã bật Khoá thiết bị";
      vi = p("Chào bạn,") + p(`<strong>Khoá thiết bị</strong> vừa được bật từ <strong>${label}</strong> lúc ${when}. Mọi máy ngoài phạm vi đã bị đăng xuất và không đăng nhập thêm được cho tới khi bạn tắt.`);
      en = p("Hi,") + p(`<strong>Device lock</strong> was turned on from <strong>${label}</strong>. Other devices were signed out until you turn it off.`);
      break;
    case "lock_attempt":
      subject = "AVORA: có người thử vào tài khoản đang khoá";
      vi = p("Chào bạn,") + p(`Có một lần đăng nhập đúng mật khẩu vào tài khoản đang <strong>Khoá thiết bị</strong> (${label}) lúc ${when}. Máy đó chỉ thấy màn chặn.`) +
        p("Nếu không phải bạn, hãy đổi mật khẩu tài khoản.", "font-size:14px;");
      en = p("Hi,") + p("Someone signed in with the right password while your account is device-locked. They only see a block screen. Change your password if it wasn't you.");
      break;
    case "lock_escape":
      subject = "AVORA: yêu cầu tắt Khoá thiết bị sau 72 giờ";
      vi = p("Chào bạn,") + p(`Có yêu cầu <strong>“Tôi không còn máy chính”</strong> lúc ${when}. Khoá thiết bị sẽ tự tắt sau <strong>72 giờ</strong>.`) +
        p("Không phải bạn? Bấm <strong>Huỷ</strong> trên trang dưới đây hoặc trong Hồ sơ › Bảo mật của máy chính.") + open + scanNote;
      en = p("Hi,") + p("Someone asked to turn off device lock because they no longer have the main device. It turns off in 72 hours unless you cancel.") + enLink;
      break;
  }
  const text = `${subject}\n${body.when}${link === null ? "" : `\n${link}`}`;
  return { subject, html: frame(vi, en, footer), text };
}

function compose(body: Body): { subject: string; html: string; text: string } {
  if (body.kind === "device") return composeDevice(body);
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
  if (v.kind === "device") {
    const actions = ["new", "rank_code", "rank_taken", "lost_report", "lost_result", "lock_on", "lock_attempt", "lock_escape"];
    if (typeof v.action !== "string" || !actions.includes(v.action) || typeof v.when !== "string") return false;
    if (v.action === "rank_code") return typeof v.code === "string" && /^[0-9]{6}$/.test(v.code);
    return true;
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
