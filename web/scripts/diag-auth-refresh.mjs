// Chẩn đoán "đăng nhập rồi tự đăng xuất": mở app với một phiên thử, đếm số lần gọi /auth/v1/token.
// node scripts/diag-auth-refresh.mjs <url> <session.json> [seconds] [path]
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const [url, sessionFile, secs = "60", path = "/tong-quan"] = process.argv.slice(2);
const probe = JSON.parse(readFileSync(sessionFile, "utf8"));
const sbUrl = process.env.SB_URL ?? "https://myrubjdysllgucgafqjy.supabase.co";
const res = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: probe.anon, "Content-Type": "application/json" }, body: JSON.stringify({ email: probe.email, password: probe.pw }) });
const session = await res.json();
const ref = new URL(process.env.SB_URL ?? "https://myrubjdysllgucgafqjy.supabase.co").hostname.split(".")[0];
const browser = await chromium.launch();
const context = await browser.newContext({ timezoneId: "Asia/Ho_Chi_Minh", viewport: { width: 390, height: 844 } });
await context.addInitScript(([key, value]) => { if (!sessionStorage.getItem("__seeded")) { localStorage.setItem(key, value); sessionStorage.setItem("__seeded", "1"); } }, [`sb-${ref}-auth-token`, JSON.stringify(session)]);
const page = await context.newPage();
if (process.env.SKEW_S) await page.clock.install({ time: Date.now() + Number(process.env.SKEW_S) * 1000 });
const t0 = Date.now();
const events = [];
page.on("request", (r) => { if (r.url().includes("/auth/v1/")) events.push({ t: Date.now() - t0, m: r.method(), u: r.url().replace(/^.*\/auth\/v1/, "") }); });
page.on("console", (m) => { const s = m.text(); if (/lock|GoTrue|refresh|auth/i.test(s)) events.push({ t: Date.now() - t0, console: s.slice(0, 200) }); });
await page.goto(url.replace(/\/$/, "") + path);
await page.waitForTimeout(Number(secs) * 1000);
console.log(JSON.stringify({ final: page.url(), tokenCalls: events.filter((e) => e.u?.startsWith("/token")).length, events: events.slice(0, 60) }, null, 1));
await browser.close();
