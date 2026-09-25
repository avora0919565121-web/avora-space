# AVORA — Design Contract

## Direction

AVORA is a desktop-first web app for private one-to-one text messaging between real people — no AI assistant, no group chat. A lightweight Nhiệm vụ module (Phase 3) adds personal to-dos and two-party 1-1 shared tasks, and a Tài chính module (Phase 4A) adds a household ledger — income, spending, accounts, eight reports — in the same paper language. The look is an editorial paper notebook that happens to deliver messages instantly:
warm bone canvas, white surfaces, heavy ink typography, thin hairlines, and one terracotta accent used sparingly.
Depth comes from paper-vs-surface contrast and hairlines only — never gradients, glow, or glassmorphism.

## Palette & typography

- Canvas (warm bone) `#F6F3EC` → `--background: 42 36% 95%`; a faint 22px dot grain (`.paper`) sits on it.
- Surface (white) `#FFFFFF` → `--card`, `--popover`.
- Ink `#1C1A17` → `--foreground`. Secondary warm grey `#6B635A` → `--muted-foreground`.
- Hairline `#E6DFD3` → `--border`, `--input`.
- Terracotta `#E0603C` → `--primary`, on `#FFF6F2` → `--primary-foreground`. Used ONLY for: primary buttons,
  outgoing message bubbles, unread badges, and the active nav marker/label.
- Soft wash `#F7E3DC` → `--accent` for hover and selected rows. Warm sand `#EFE7DA` → `--secondary` for avatars.
- Online dot `#3F8F6B` → `--online`.
- Ledger direction: money in `#3F8F6B` → `--money-in`, money out `#C0492A` → `--money-out`. The rust is
  deliberately NOT the terracotta accent, so a figure can never be mistaken for a button.
- Chart ink is one warm printed ramp, used in this order: `#E0603C #3F8F6B #C98A3E #5B7B8A #8C6A4A #7D8A4F
  #D68A6F #4E6E7D #A8926F #6B635A`. Never a default blue-purple ramp, never a gradient fill.
- Type: **Inter Tight** (Google Fonts) everywhere. Wordmark `AVORA` uppercase, weight 600, letter-spacing `0.34em`.
  Screen titles 26–34px semibold tracking-tight; conversation names 15px semibold; previews/timestamps 13px muted;
  message body 15px / 1.6. Timestamps and counters use tabular numerals (`.tabular`).
- Shape: radius 10px (`--radius: 0.625rem`) on inputs, buttons, cards; message bubbles 16px with a 4px tail corner
  on the sender side; avatars are perfect circles with initials. Gutters 24–40px.
- Motion: `rise-in` for screen entrances, `bubble-in` staggered 60ms per message, `blink` typing dots,
  `.press` scale-to-0.985 on tap. Nothing longer than 450ms.

## Screens

- **Đăng nhập / Đăng ký / Quên mật khẩu** (`/dang-nhap`, root, no site nav) — full-height split: left warm canvas
  brand column (wordmark, "Nhắn tin riêng tư, tức thì!", © line), right white column with the form. One screen
  covers three states via `?mode=dang-ky` and `?mode=quen-mat-khau`. In Quên mật khẩu only the email field shows,
  with "Gửi liên kết đặt lại" and "Quay lại đăng nhập"; the terms line and "hoặc" divider are hidden there.
- **Đặt lại mật khẩu** (`/dat-lai-mat-khau`, no site nav) — where the emailed link lands, same split layout with
  "Đặt lại mật khẩu." as the brand headline. Three states: checking the link, the two-field form (new password +
  confirmation), or a plain "Liên kết không dùng được" panel with a button to request a fresh email. On success it
  confirms in green, notes that other devices were signed out, and moves to Tin nhắn after ~1.6s.
- **Tin nhắn** (`/tin-nhan`, tab) — 320–360px white conversation column (title, search, new-chat icon button,
  rows with avatar/name/last message/time/unread badge) plus a wide canvas region showing the empty state
  ("Chọn một cuộc trò chuyện" + terracotta button). Real data; skeleton rows while loading, and an empty state
  inviting the first conversation by email. Own last message is prefixed "Bạn: ".
- **Cuộc trò chuyện** (`/tin-nhan/:id`, detail of Tin nhắn) — same list column with the active row on soft wash;
  right region becomes the thread: white header (avatar, name, email), one date separator per day, bubbles,
  pinned composer with terracotta Gửi. Real data. Outgoing bubbles appear instantly at 70% opacity with
  "Đang gửi…" until the server confirms. A thread you cannot access shows "Không mở được cuộc trò chuyện".
  Incoming messages appear on their own within a second, with the same 60ms staggered bubble entrance; the inbox
  row jumps to the top at the same moment. Opening the thread clears its unread badge; the sender then sees
  Đã xem under their newest message without reloading.
- **Trò chuyện mới** (sheet over Tin nhắn and Liên hệ) — centered ~540px dialog over a warm ink scrim: title,
  single exact-email field with a Tìm button, one result row, Huỷ + Bắt đầu trò chuyện. Real lookup.
- **Liên hệ** (tab) — the people you already have a conversation with, on canvas; each row opens that thread.
- **Nhiệm vụ** (`/nhiem-vu`, tab) — one screen read three ways, chosen by a segmented switch under the title:
  **Theo hạn** (default) is a timeline of white day-cards (Hôm nay, then `9 thg 9`…) holding every task, personal
  and shared together, each day ordered by clock then by whose work it is; **Theo người** is the original two-card
  tree (Cá nhân, then Nhiệm vụ chung grouped by person with avatar + name) and is where the composer lives;
  **Khẩn cấp** narrows to starred work only. Under the switch sits a row of category filter chips (coloured dot +
  name, soft wash when active, plus Bỏ lọc); above it, any reminder that has come due appears as an amber-hairline
  strip with Đã biết. A task row carries its deadline chip, then the clock when one was set, a repeat marker, an
  amber star if flagged, and its category tag. Cá nhân rows keep the ink check bubble (strike + muted when done,
  click to reopen); shared rows keep Chờ xác nhận to the creator, the terracotta Xác nhận button to the peer, and
  the Đã xác nhận chip once accepted. The composer still leads with three stacked required fields (Tiêu đề, Mô tả
  cụ thể, Hạn hoàn thành, each labelled with a terracotta asterisk) and the person picker on top for shared work,
  then an optional block underneath — Giờ, Hạng mục, Nhắc trước, Lặp lại, and a Khẩn cấp toggle — with a submit
  button that stays faint until the three required fields are filled. Every row says whose move it is in its own
  weight — the reader's own work in ink at semibold, work somebody else is carrying lighter, italic and warm grey,
  with the same fact in words for screen readers — while the order, the filters and every count stay untouched.
- **Avora Space** (`/tong-quan`, tab) — the opening screen: the greeting with the day named beside it ("Chào buổi
  sáng · Thứ ba, 15 thg 9"), the reader's name, then the day's thought on a hairline terracotta rule with a quiet
  "Viết lời bình" line under it that opens a private field saved into Nhật ký. Below: a three-cell hairline strip
  — Quá hạn / Hôm nay / Sắp tới, rust, warm and ink respectively, each zero in unscheduled grey — one sentence
  naming the most pressing fact, the three scope cards (Cá nhân / 1-1 / Nhóm), "Xem tất cả nhiệm vụ", and last
  who is waiting on a reply.
- **Két sắt** (`/ket-sat`, tab) — the safe: one section strip (wordmark-cased "KÉT SẮT" over Tài chính / Mật khẩu)
  above whichever half is open. Tài chính is the ledger below, unchanged; Mật khẩu is a Sắp ra mắt panel only.
- **Tài chính** (`/ket-sat`, inside Két sắt) — one section with four inner tabs (Tổng quan, Giao dịch, Tài khoản, Báo cáo)
  under a single title. Tổng quan is four stat cards (Tổng tài sản, Thu tháng này, Chi tháng này, Giá trị ròng)
  above a two-column grid of charts: spending trend, category doughnut with a clickable legend, multi-line account
  balance, this-month-vs-last bars, and a giving half-dial. A household-business card (Doanh thu / Chi phí / Lãi
  gộp plus a trend line) appears above them the moment one transaction is flagged as business.
- **Giao dịch** (`/ket-sat/giao-dich`) — the ledger on the left grouped by day with a per-day net, the unified
  composer on the right. One form for both directions: a two-way Khoản chi / Khoản thu switch (green for in, rust
  for out) that swaps the category list, then Tài khoản, Ngày, Số tiền, Hạng mục — the four required fields, each
  marked with a terracotta asterisk — then optional diễn giải, a business block, a recurring block and a receipt.
  Enter writes a newline; only Thêm giao dịch submits, and it stays faint until all four are filled. Due recurring
  patterns surface as Thêm / Bỏ qua reminders above the form; nothing is ever charged automatically.
- **Tài khoản** (`/ket-sat/tai-khoan`) — Tài sản / Nợ / Giá trị ròng (summed in the base currency), then account
  rows (name, type, tags, last movement, balance) with edit and close, a separate Đã đóng list, and the two
  category vocabularies as chips with inline add, edit and remove on the user's own ones only. An account's balance
  reads in the account's OWN currency, with the base-currency figure as a small muted second line beneath it only
  when the two differ; anything no rate can value says so instead of being counted as zero.
- **Báo cáo** (`/ket-sat/bao-cao`) — a report picker, a date range with Tháng này / Tháng trước / Từ đầu năm /
  12 tháng presets, Tạo báo cáo, then stats, a chart where one applies, and the table — with CSV and Excel beside
  the title. When more than one currency is in play, a hairline strip under the title states the rates used
  ("1 USD = 23.984,96 VND"), so a converted total can be checked rather than trusted.
- **Cài đặt** (`/cai-dat`, tab) — same section strip pattern as Két sắt, over Hồ sơ / Avora AI. Hồ sơ is the
  account screen below, unchanged; Avora AI is a Sắp ra mắt panel with no chat box and no assistant behind it.
- **Hồ sơ** (`/cai-dat`, inside Cài đặt) — real signed-in confirmation: "Xin chào, {display_name}", email, profile card with editable
  display name (RLS-scoped to the user), created date, then a Thiết lập card holding the two preferences the rest
  of the app reads — Loại tiền báo cáo (twenty currencies grouped by region, with a live "1 USD ≈ …" line) and
  Múi giờ — and Đăng xuất.
- **Sắp ra mắt** (Mật khẩu, Avora AI) — one hairline square icon tile, a title, a single line of plain Vietnamese,
  and a bordered "SẮP RA MẮT" pill. No form, no input, no fake preview: a half that cannot answer yet says so.
- **Site navigation**: fixed 240px left rail on canvas with the AVORA mark beside the wordmark, then exactly five
  places — Avora Space / Tin nhắn / Nhiệm vụ / Két sắt / Cài đặt — and a bottom block with the signed-in user and
  Đăng xuất. Liên hệ is reached by the person icon in the Tin nhắn header, beside the new-chat action. Below `md`
  the rail collapses to a top bar and the thread replaces the list column.

## Decisions

- 2026-09-05 — Product is human-to-human 1-1 chat only; no AI assistant, no groups, no tasks in v1.
- 2026-09-05 — Warm paper palette chosen over dark/mint options.
- 2026-09-05 — Build step 1 wires real Supabase email/password auth + `profiles` (RLS `auth.uid() = id`) only;
  Tin nhắn, Cuộc trò chuyện, and Trò chuyện mới stay visual-only until the messaging step.
- 2026-09-05 — Avatars render as initials on warm sand; no stock photography anywhere in the product.
- 2026-09-05 — Tin nhắn, Cuộc trò chuyện, Trò chuyện mới and Liên hệ now read real data; the demo dataset is deleted.
- 2026-09-05 — No browsable member directory: people are found by exact email only, never by partial search.
  Liên hệ therefore lists only people you have already talked to.
- 2026-09-05 — Presence dots, typing indicator, unread badges and the attachment button are removed until the
  features behind them are real; the call/info icons in the thread header stay decorative.
- 2026-09-05 — Until realtime lands, the inbox refreshes every 8s and an open thread every 4s.
- 2026-09-05 — Superseded: messages now arrive over a live connection, so there is no periodic refresh while
  the app is connected. Refreshing every 10s (inbox) / 5s (thread) is only a fallback when the live
  connection is down.
- 2026-09-05 — When the live connection drops, the app says so plainly: a quiet "Đang kết nối lại" marker beside
  the Tin nhắn title and one hairline strip above the thread. No blocking overlay, no red alarm state — messages
  stay readable and sendable throughout.
- 2026-09-05 — Unread badges are back, now backed by a real per-person read marker: a terracotta pill on the
  conversation row and a matching total beside Tin nhắn in the left rail. Unread rows also darken their preview
  text and time to ink; read rows stay grey.
- 2026-09-05 — A conversation counts as read only while its thread is open in a tab the user is actually looking
  at. A thread left open in a background tab keeps collecting unread messages.
- 2026-09-05 — Only your newest sent message carries a delivery receipt (Đã gửi → Đã xem, single then double
  tick), in muted grey — never terracotta. Older messages carry none, so the thread stays quiet.
- 2026-09-05 — Typing indicator stays out of scope for now; it is the next realtime feature if asked for.
- 2026-09-05 — Password recovery answers the same way for every address ("Nếu email này đã đăng ký…"), so the
  screen can never be used to check who has an AVORA account. No "email không tồn tại" message anywhere.
- 2026-09-05 — A session opened by a reset link may reach nothing but the Đặt lại mật khẩu screen until the new
  password is saved; the guard lives in the shared route gate, so it holds no matter which URL the link lands on.
- 2026-09-05 — Saving a new password signs out every other device, and the screen says so plainly.
- 2026-09-05 — Signup confirms by email. The screen never claims "tài khoản đã tạo" (untrue when the address
  already had one) — it says an email was sent, the same answer for both cases, matching the reset screen.
- 2026-09-05 — Signing in before confirming shows "Gửi lại email xác nhận" inside the error itself, so an
  unconfirmed account is never a dead end.
- 2026-09-05 — Brand tagline corrected by user: "Nhắn tin riêng tư, tức thì!" (dấu chấm than, không phải dấu chấm).
  Applies to the auth screen headline and the meta/og description in index.html.
- 2026-09-05 — An exhausted project mail quota never reads as "bạn thử quá nhiều lần" — the quota is shared, so
  another person's signup can trigger it. It says the system cannot send email right now and to retry in about an
  hour. The per-address cooldown keeps the short "đợi một lát" wording.
- 2026-09-05 — Transactional emails are bilingual, Vietnamese first then English, in one message — the app is
  Vietnamese but the address may be read anywhere. Approved wording lives in docs/email-templates/ (the canonical
  copy; .rork/ is gitignored) and is pasted into the Supabase dashboard by the user.
- 2026-09-05 — Emails never reuse Supabase's default phrasing ("Follow the link below to confirm this email
  address…"). Each one names AVORA and states why it arrived, because that default wording is common in phishing
  and gets flagged by corporate spam filters. Both emails also carry a reassurance line for the person who did
  not ask for them.
- 2026-09-07 — Phase 3 supersedes the v1 "no tasks" boundary (2026-09-05): personal + 1-1 shared tasks ship in
  the same paper language. A shared task starts only when both parties agree — the creator's Gửi plus the peer's
  Xác nhận — and stays untouched by direct edits while pending; only the peer can confirm, and either party can
  finish. Third parties always see zero task rows, never an error.
- 2026-09-07 — Tasks arrive over the same live connection as messages: a new shared task, the peer's Xác nhận and
  either side marking it done all appear on the other person's screen without a refresh. Nothing about task state
  is delivered by polling while the connection is up; the 10s refresh is only the offline fallback.
- 2026-09-07 — Finishing a shared task now takes both people, mirroring how one starts: the person who took the
  task reports it done, and the person who gave it approves. Supersedes the same-day line above allowing either
  party to finish. The circle beside the task fills only halfway while approval is outstanding, so an unreviewed
  claim can never look finished.
- 2026-09-07 — A shared task shows a button only to the person whose turn it is; the other side sees a quiet
  status word. No step ever asks both people to act, and no one can act twice in a row on the same task.
- 2026-09-07 — The half-filled circle fills from its left edge, never from its centre: a centred fill reads as a
  stripe, not as "half done". A finished task keeps its wording on screen rather than going blank, so the closed
  state is something you can see, not just the absence of a prompt.
- 2026-09-07 — Task wording splits by phase: the two opening states talk about taking the work (Chờ nhận việc,
  Đang làm) and the two closing states about confirming it (Chờ xác nhận, Đã xác nhận). No two states ever share
  a phrase — a repeated label would make different situations look identical.
- 2026-09-07 — Whoever is waiting is told who they are waiting on ("Chờ người giao xác nhận"), not merely that
  the task is waiting.
- 2026-09-07 — Accepting a task and finishing a task get separate vocabularies, superseding the same-day wording
  line above: the opening pair speaks of nhận việc (Chờ nhận việc, Đã nhận việc) and the closing pair of hoàn
  thành (Chờ xác nhận hoàn thành, Đã hoàn thành). Bare "xác nhận" is never a state name again — it read as both
  accepting and finishing. The accept button says Nhận việc, the closing one Xác nhận hoàn thành.
- 2026-09-07 — Four states, four shapes: empty square (not taken on), ring with one check (taken on), half-filled
  circle (reported done), solid disc with a double check (confirmed finished). The shape carries the meaning on
  its own, so the words confirm what you already see instead of being the only clue.
- 2026-09-07 — A personal task shows only the empty square or the finished disc. It has nobody to accept it and
  nobody to review it, so a single check would claim a hand-off that does not exist.
- 2026-09-07 — "Đang mở" counts every task the two people have not both closed, including one waiting on the
  creator's confirmation: work stays counted while it is still someone's responsibility, and only a confirmed
  task leaves the count. Section totals and per-person totals use that one rule, so they cannot disagree.
- 2026-09-07 — Reviewing a done claim has two answers and both belong to the reviewer: approve it, or trả việc to
  send the work back for redo. A returned task lands back on "đã nhận việc" with the claim cleared, so the person
  doing the work can report again — a rejection is never a dead end and never a new task.
- 2026-09-07 — Deleting is per person, not per task: each side of a shared task has its own bin, and the row only
  leaves the database when both have let go of it. Nobody can delete work off someone else's list. While it is
  one-sided the survivor is told plainly ("Người giao đã xoá"), because a task nobody will answer for anymore is
  different from one that is merely waiting.
- 2026-09-07 — "Xoá hẳn" appears only where one person owns the row outright, so it never destroys a copy someone
  else still keeps. A shared task in the bin offers only Phục hồi, with a line naming who is still holding it.
- 2026-09-07 — Deadlines are calendar days, never timestamps, and are always optional: most work has no promised
  day, and "due today" must read the same at 08:00 and at 23:00.
- 2026-09-07 — Urgency is carried by warm colour on the date itself, never by a red alarm and never by recolouring
  the task's own words: overdue #E17A5F, due within three days #D68A6F, scheduled #666666, and unscheduled #CCCCCC
  reading "Không có hạn". Body text stays ink so the list is legible at any urgency.
- 2026-09-07 — Lists read in the order a worried person scans them: overdue, then nearly due, then scheduled, then
  undated — and finished work sinks below all of it, however overdue it once was.
- 2026-09-07 — The counter beside a collapsed branch is bold and coloured by the most pressing thing inside, so a
  closed branch still admits it is hiding something late. At zero it goes faint and plain. A count above zero never
  uses the unscheduled grey: nothing outstanding is allowed to look like nothing.
- 2026-09-07 — Nhiệm vụ is one collapsible tree (section → person → tasks) that starts closed, with one exception:
  a branch holding your move or something overdue opens itself. Collapsed-by-default keeps a long list calm;
  the exception keeps it from hiding work you owe. Hand-collapsing a branch always wins over that rule.
- 2026-09-07 — A person with no tasks is not listed at all. The tree shows relationships that currently carry work,
  not a directory of contacts.
- 2026-09-07 — A task is a title, a description of what is actually wanted, and a day it is due. All three are
  required on both kinds of task; without them it is a note, not a task. The composer says so in one line and
  keeps its button inert until all three carry something, so the form never invites a request it will refuse.
- 2026-09-07 — Because the description is mandatory it is shown on the row, clamped to two lines, never hidden
  behind a tap. A requirement nobody reads would be paperwork.
- 2026-09-07 — A deadline may be today but never a day already past, and it is still a calendar day: "today" means
  the same at 08:00 and at 23:00. Consequently the unscheduled #CCCCCC "Không có hạn" band no longer occurs on new
  work — it survives in the code only so rows written before this rule still render.
- 2026-09-07 — Deleting turns on authority, not on progress, refining the two lines below it: a request nobody has
  accepted yet is the creator's to withdraw outright — no bin, no second copy, nothing to preserve — while after
  acceptance both sides only ever soft delete. The button says "Xoá hẳn" in the first case, because a delete that
  cannot be undone must not look like one that can.
- 2026-09-07 — Deleting is not symmetric, superseding the equal-bins line above on who may delete when: the person
  who asked for the work may withdraw it at any point, but the person doing it can only delete once the task is
  confirmed finished — not merely reported finished. Otherwise unfinished work could be swept off the list before
  anyone answered for it, which is the one thing the two-party flow exists to prevent. The bins stay per-person.
  The refusal names whose word closes a task: "Chỉ có thể xoá khi người giao xác nhận việc đã hoàn thành."
- 2026-09-07 — Where an action is not yours to take, the button is absent rather than present-and-refusing. The
  assignee gets no delete control until the task closes; the refusal message exists only as a server backstop.
- 2026-09-07 — Superseded by the authority rule above: the row is destroyed once both sides have let go, and the
  extra "only if closed" condition is dropped. Since the assignee can only ever bin a confirmed-finished task,
  a doubly-binned unfinished task cannot arise except by the creator withdrawing something never accepted.
- 2026-09-07 — The avatar stays the largest circle in a row (44px) and the task-state circle is deliberately smaller
  (32px): the person owns the row, the task's state is a detail inside it.
- 2026-09-07 — Phase 4A supersedes the v1 boundary again: AVORA keeps a household ledger. It is one module in the
  same paper language, reached from the same rail, not a second product bolted on.
- 2026-09-07 — Money is carried as integer cents everywhere and only becomes a decimal at the database edge. A
  ledger that cannot add up its own rows is worthless, and floating point cannot add 0.1 and 0.2.
- 2026-09-07 — Income reads green and expense reads deep rust; neither is the terracotta accent, which stays for
  buttons and navigation alone. Everyday spending is not an alarm, so an expense in a list is ink with a minus,
  and rust is kept for the figures that summarise it.
- 2026-09-07 — An account's balance is derived from its transactions and its opening balance, never stored as an
  independent claim. The database recomputes it on every write and the client has no privilege to write the
  column, so the number on screen cannot drift from the rows beneath it.
- 2026-09-07 — A transaction is never deleted, only marked as an error: the row stays for audit and leaves every
  total. Correcting a mistake must not be indistinguishable from hiding one.
- 2026-09-07 — Closing an account hides it from balances and keeps every transaction it ever held. History belongs
  to the ledger, not to the account.
- 2026-09-07 — Four fields make a transaction — account, date, amount, category — and the submit button stays faint
  until all four are filled. Diễn giải is optional: forcing a sentence onto every grocery run would stop people
  recording them at all.
- 2026-09-07 — Enter is for writing, not for sending, in the ledger as in Nhiệm vụ. Only the button commits, so a
  half-finished amount cannot be posted by a stray keystroke.
- 2026-09-07 — A recurring entry is a memory aid, never a standing order. AVORA notices the day has come and offers
  it; a person still presses Thêm. Skipping is remembered locally, because nothing financial happened.
- 2026-09-07 — The household business is one checkbox, not a mode. Ticking it on a single transaction is what makes
  the lãi lỗ card, the P&L and the deductible list appear; until then the app never mentions business at all.
- 2026-09-07 — P&L revenue is income actually flagged as business, not all income. Counting a salary as farm
  revenue would make the one number a farmer relies on a lie.
- 2026-09-07 — Category names are Vietnamese, because they are what the person reads and what the duplicate-name
  rule protects; a stable English slug carries the meaning that reports match on. Reports never match display text.
- 2026-09-07 — Every report is a pure function of the ledger and a date range, and the table, the CSV and the Excel
  file are all rendered from that one result — an export can never disagree with the screen it came from.
- 2026-09-07 — Exports carry bare numbers with the currency named once in the header, never a symbol glued to each
  cell: a spreadsheet can only sum a column of numbers.
- 2026-09-07 — One ledger, one currency, for now. Summing two currencies into a "total" would produce a figure that
  means nothing, so a second currency is refused with a sentence saying why rather than quietly mis-adding.
- 2026-09-07 — The giving dial is a half-arc that fills to 15%, coloured red under 5%, yellow through 10%, green
  above — with white ticks on the two boundaries so the verdict is legible without reading the number.
- 2026-09-08 — Phase 4B.1 supersedes "one ledger, one currency": AVORA now holds accounts in any of twenty
  currencies and reports totals in one base currency of the person's choosing. The old rule was standing in for
  conversion, not arguing against it — summing VND and USD is still forbidden, it is just done properly now.
- 2026-09-08 — An account's balance is shown in the account's own currency, never converted in place. Converting
  the headline figure would hide what is actually in the account; the base-currency value goes underneath, quietly,
  and only when the two differ.
- 2026-09-08 — A figure that cannot be valued reads as "chưa có tỷ giá", never as zero. A missing rate must not
  quietly shrink someone's net worth, so unvalued accounts and entries are named and excluded, not absorbed.
- 2026-09-08 — Exchange rates are anchored to USD in both directions and nothing else is stored; every cross rate
  is derived. Hand-written cross pairs make the answer depend on which row is found first — the brief's own figures
  disagreed by ~0.04% — and one anchor means one answer, with every round trip closing.
- 2026-09-08 — Reports state the rates behind a converted total. A number nobody can check is a number nobody
  should have to trust.
- 2026-09-08 — A deadline is a day first and an hour only if the person says so. A task with no clock is due at the
  END of its day, not 09:00: treating it otherwise would make work promised for today read as late by mid-morning,
  which is why no existing deadline was given a time when the column arrived.
- 2026-09-08 — The emergency star is a tiebreaker, never a promotion. It settles two tasks due at the same moment
  and nothing more, so flagging something can never push it ahead of work that is genuinely due sooner.
- 2026-09-08 — Theo hạn is the default reading of Nhiệm vụ, superseding the two-card tree as the landing view.
  What is due soonest is the one ordering that is not a matter of taste; Theo người stays one tap away, and is
  still where work gets created, because that is where you choose who it is for.
- 2026-09-08 — Consent is per occurrence: a repeating shared task comes back as Chờ nhận việc every time. The peer
  agreed to this week's standup, not to every standup for ever.
- 2026-09-08 — A repeat's next date is counted from the original deadline and then walked into the future, so a
  month-end task stays at month-end and a task finished three weeks late does not produce a successor born overdue.
- 2026-09-08 — Reminders are per person, not per task, and are delivered in the app. AVORA has no mail, SMS or push
  sender, so a reminder cannot reach a closed tab and the screen says so rather than implying a notification that
  will never arrive. A reminder that could only fire after its own deadline is not offered at all.
- 2026-09-08 — Task categories are private to their owner. A shared task carries its creator's label and the peer
  simply sees none — a filing system is for the person who made it, not a fact about the work.
- 2026-09-09 — Everyone has a Personal Journal: a conversation with exactly one participant, created at signup and
  backfilled for existing accounts. Private notes belong in the same place as everything else you write, so the
  journal is a real conversation rather than a separate note store. Asking for someone else's journal by id returns
  nothing at all — emptiness, not an error, because a refusal would itself confirm the journal exists.
- 2026-09-09 — A task's context snapshot is written once and can never be edited, by anyone, including the person
  who created it. It copies the message text and the sender's name as they read at that moment, so deleting the
  original message or renaming the sender cannot rewrite why the task exists. A record of what was said stops being
  a record the moment it can be revised.
- 2026-09-09 — Group identity lives beside the conversation, not inside it. A direct chat has no name and a journal
  has no owner, so a name/owner only exists where those things mean something, and renaming a group never touches
  the name of a task list inside it — the list was named by a person, for a reason of their own.
- 2026-09-09 — A task list may have no name. "The list" is what most people mean when there is only one, and
  demanding a title for it would be paperwork.
- 2026-09-09 — Who may switch task lists on follows the shape of the room: in a 1-1 either person, in a group only
  the owner, in a journal the person themselves. Members can always SEE the setting, so a rule they cannot change
  is at least never invisible to them.
- 2026-09-09 — Removing someone from a group is an owner's act alone. An admin may only ask, and the ask is a
  visible record with a name on it; the owner's answer is stamped with who decided and when. Putting someone out
  of a room is the kind of decision that should never be untraceable, and an admin who could do it silently would
  make it exactly that.
- 2026-09-09 — An owner may leave, but not before handing the group to someone else. The interface says so in
  words on the button rather than letting the press fail — a rule the person meets as an error message is a rule
  the design forgot to explain.
- 2026-09-09 — A group's ownership can move, but only by transfer: the old owner steps down before the new one
  steps up, so the group is never briefly ownerless and never briefly has two. Renaming a group still cannot
  change who owns it — the only opening is the transfer itself.
- 2026-09-09 — A private message that starts inside a group stays private from the group. The owner runs the room
  but is not entitled to what two people say to each other in it, and the same pair gets a separate thread per
  group so a conversation cannot follow them somewhere it was never meant to go. Deleting the group deletes those
  threads with it.
- 2026-09-09 — The group roster lives behind the info button of the conversation itself, not in a separate
  management screen. A group is a room, and its member list belongs at the door of that room: open the panel and
  the members are there, ranked by responsibility (owner, admin, members), each with exactly the buttons their
  seat allows — nothing more, nothing hidden in a menu.
- 2026-09-09 — Removing a person is always confirmed in words before it happens, and an admin's request names the
  asker. The dialog says what will occur and, for an admin, that their name goes with the ask — the accountability
  the database records should be visible at the moment of asking, not only afterwards.
- 2026-09-09 — The member search only appears once a roster is large enough to need it (seven people). A filter box
  above six names is decoration; above twenty it is the only way to find the person you came to deal with. The same
  query filters the pending requests, so "who is this about" and "what is being asked about them" narrow together.
- 2026-09-09 — An admin learns the owner's verdict on their request the moment it is made, wherever they are in the
  app, not by reopening the roster to check. A request is a question addressed to a person; the answer should come
  back to them, not wait on a shelf for them to notice.
- 2026-09-09 — Tin nhắn is split into three named directions — Nhật ký, Chat 1-1, Chat group — because choosing who
  you are writing to is a different decision from choosing what to say. One merged list forced the mode to be
  inferred from an avatar; three tabs make the choice explicit and give each direction its own way to start
  something new (an email for a person, a name plus emails for a group, nothing at all for the journal).
- 2026-09-09 — Nhật ký opens itself. It is the one thread with exactly one possible participant, so asking the
  person to pick it from a list would be asking a question with one answer. It carries no read receipt and no call
  button either: there is nobody on the other side to have seen it or to ring.
- 2026-09-09 — A group message wears its sender's name; a 1-1 message does not. With more than two people in a
  room, an unattributed bubble is unreadable — and with exactly two, a name on every line is noise.
- 2026-09-09 — In a group, an incoming bubble stands beside its sender's avatar — the same warm-sand initials
  circle used everywhere else, aligned with the bottom of the bubble. The name above still carries the words; the
  avatar answers "who" before reading begins. Own bubbles stay unaccompanied: the accent colour already says it is
  you, and a mirror at the right edge would be answering a question nobody has.
- 2026-09-09 — Group settings live behind one gear in the roster panel, and renaming is the owner's alone. The gear
  is shown to every member with the rule spelled out rather than the menu hidden: a member who goes looking for the
  setting should learn who can change it, not find nothing. A rename never touches membership or ownership —
  ownership still moves only by transfer.
- 2026-09-09 — A rename cannot be blank and cannot be a no-op: Save stays inert until the name actually differs,
  and what gets stored is the words the owner meant with stray whitespace collapsed away. Re-saving the current
  name is a write with nothing to say.
- 2026-09-09 — Appointing and standing down the admin are buttons on the member's own row, visible from the owner's
  seat only. Delegation is a statement about one person, so it belongs beside that person's name rather than in a
  settings menu — and the seat that answers removal requests is the only seat that may hand out the right to raise
  them.
- 2026-09-09 — The group holds one admin seat, and the interface says so before the database has to. While the seat
  is taken, the appoint button on other rows is disabled and names its current holder; freeing it is an explicit
  "Thu hồi quyền" on the admin's row. A second appointment is refused by the rules either way — better read as a
  sentence than as an error.
- 2026-09-09 — One invite link per group, carried by a secret token in the URL. Every member may share it; only the
  owner rotates or revokes it — the seat that decides who belongs decides which doors exist. Joining through a link
  makes you a plain member, no approval and no form; opening a link while already a member simply opens the group.
  A dead link reads as a sentence ("không còn hiệu lực"), and the invite page names the group and asks exactly one
  question — join or not.
- 2026-09-09 — Reading older messages is never interrupted. Opening a thread lands on its newest message with no
  animation; anything you send is always followed; someone else's message only glides the view down while you are
  already within ~96px of the live end. Otherwise the thread holds still and a small pill floats above the composer
  — warm-sand when it is only an invitation back ("Tin nhắn mới nhất"), primary green with a count when messages
  arrived out of sight ("3 tin nhắn mới", capped at 99+).
- 2026-09-09 — Nothing in the database answers to a signed-out caller. Application functions are executable by
  signed-in users only, and the trigger functions that enforce the rules answer to no one directly — they run when
  the data changes, never on request. `ensure_default_categories` keeps its signed-in grant because Tài chính calls
  it straight from the client to lay down a new user's default categories.
- 2026-09-09 — One rule decides who sees a task: it is yours if you wrote it, or it is shared and you are in the
  conversation it belongs to. The 1-1 and group cases were always the same sentence with a different noun, so they
  are now written once. Every rule on Nhiệm vụ addresses signed-in users explicitly rather than relying on an empty
  identity to fail the comparison.
- 2026-09-09 — The rule-keeping helpers follow the same line as the rest: the four that only run when data changes
  answer to nobody directly, while the two that genuinely compute something for a screen — the default finance
  categories and a task's deadline instant — stay open to signed-in users. A signed-out visitor can no longer reach
  a single function in the database.
- 2026-09-09 — Creating a task follows the same three shapes as reading one, so the INSERT rules are written once
  too: the row must be yours, and either it is personal with no conversation and starts confirmed, or it lives in a
  conversation you belong to and starts awaiting confirmation. The shared 1-1 and group branches are one sentence,
  and the participant lookup only runs for rows that get that far.
- 2026-09-09 — In every thread — 1-1, nhóm and Nhật ký — Enter belongs to the message, not to sending. It opens a
  new line like any other text box, the box grows with the draft up to a point and then scrolls, and a message
  leaves only when Gửi is pressed. Gửi stays unavailable while the draft is empty, whitespace-only, or a send is
  already in flight, so a blank message can never go out.
- 2026-09-10 — Shared work now starts where it was agreed. A task for another person is raised only from inside the
  conversation, with the message that prompted it copied onto the task and kept — the database refuses to let that
  copy be edited later. Accepting, handing back, finishing and binning happen in that same thread, where both sides
  can see what was actually said. Tab Nhiệm vụ becomes the place you read and arrange shared work rather than decide
  it: one button back to its context, and dragging that changes this person's order alone.
- 2026-09-10 — A group task names the one member carrying it. "The other person" is meaningful in a 1-1 and
  meaningless in a group, so the row records an assignee outright; everyone else in the room can read the task but
  is asked for nothing and has no bin for it. Older 1-1 rows keep working unchanged, where the assignee is still
  simply whoever is not the creator.
- 2026-09-10 — The list you check first is a matter of how you work, so the three readings can be dragged into any
  order and the one at the front is what opens next time. The middle reading is "Theo đối tượng", not "Theo người":
  it now groups by conversation, and a group is not a person.
- 2026-09-10 — Tổng quan answers one question — where to look first — with three counts: Cá nhân, 1-1 and Nhóm.
  Each block is a door into Tab Nhiệm vụ already narrowed to that kind of work, so the number tapped and the list
  landed on are always the same set of tasks.
- 2026-09-10 — A task can be raised from one particular message, not only from the end of the thread. Every bubble
  offers it — on hover with a mouse, on a held finger by touch — and the task then quotes that message. The button
  beside the box stays exactly as it was, quoting whatever was said last. Two doors, because "that thing you said
  earlier" and "what we just agreed" are different questions.
- 2026-09-10 — The panel inside a group chat is called "Nhiệm vụ chung" and holds only the viewer's own business:
  what they were asked for, and what they are waiting on from others. A room of twelve generates work that has
  nothing to do with you, and reading it each time you open the chat is noise. The room's full list — who is
  carrying what — opens from the header as "Danh sách nhiệm vụ nhóm". A 1-1 is left whole: two people can never
  make a list too long to read.
- 2026-09-10 — The assignee box is typed into, not read through: names narrow as you type, with or without tone
  marks, so "hoa" finds Hoà and "dat" finds Đạt. Several people can be named, each becoming a chip that can be
  taken back off. Confirming with three people writes three separate tasks — same wording, same quoted message,
  one assignee each — because a promise is between two people, and three of them finish at three different times.
- 2026-09-10 — Time is chosen from a grid of five-minute marks rather than typed into the browser's own control.
  A deadline is an intention, not a stopwatch: 16:05 and 16:07 mean the same thing to whoever reads it. The field
  stays optional and stays a clock — empty until pressed, showing "16:05" beside the icon once set, with no box to
  type digits into. This is the only time control in the app.
- 2026-09-10 — A panel waiting on something that has already failed says so instead of spinning. The invite link
  can only be fetched once the viewer's role is known, and the role comes from the member list, so a broken member
  list used to leave "Đang tải liên kết…" on screen for ever — a loading line that was really an error, which is
  what hid the fault. A blocked dependency now reads as its own state, names the member list as the cause, and
  offers Thử lại. No surface in AVORA is allowed to describe a dead wait as loading.
- 2026-09-10 — Qualifying a name with `pg_catalog.` is only correct for built-ins: `auth.users` lives in another
  schema, and `pg_catalog.auth.users` is read by Postgres as database.schema.table and refused outright. A pinned
  `search_path` is the right hardening and stays; the schema-qualified names beside it are what must be checked
  after any advisory pass, because such a rewrite breaks a function at run time while leaving its grants intact.
- 2026-09-10 — AVORA can be kept on a phone's home screen: same web app, one configuration layer, no second
  codebase. Installed it is called AVORA (AVORA Space in full), opens standalone on the bone canvas with no
  browser bar, and carries the folded-paper icon — including a maskable cut, so a round or squircle crop takes
  paper, never a clipped fold. The status-bar tint is the canvas the app actually shows, not the terracotta
  accent: the accent is for buttons and marks, and a coloured band across the top of every screen is not sparing.
- 2026-09-10 — The service worker exists to make the app installable and for nothing else. It never touches a
  Supabase response — messages, tasks and money are read from the network every time, never from a cache — and it
  never handles the HTML document, so the build that loads is always the one just deployed. Static build output is
  fetched network-first with the cache as an offline fallback only, and each new worker takes over immediately
  instead of waiting for every tab to close. Offline reading stays out of scope: a cached ledger that quietly
  disagrees with the server is worse than an honest failure to load.

- 2026-09-11 — The main rail carries five places and no more: Avora Space (the dashboard, still on `/tong-quan`),
  Tin nhắn, Nhiệm vụ, Két sắt, Cài đặt. Liên hệ moved out of the rail into the Tin nhắn header, because the people
  you talk to belong beside the talking, not beside the sections. Two names are now containers rather than pages —
  Két sắt holds Tài chính plus Mật khẩu, Cài đặt holds Hồ sơ plus Avora AI — and the halves inside them are
  reached by a quiet section strip, deliberately flatter than the pills a page draws for its own contents, so the
  two levels never read as the same row of tabs. Every renamed URL redirects to its new home with its query string
  intact: a saved `/tai-chinh/giao-dich?thang=…` link still opens the same filtered ledger, never a 404 and never
  an unfiltered one. `/tong-quan` was deliberately NOT renamed with its label — a live route is worth more than a
  tidy slug.
- 2026-09-11 — A half that exists in the navigation but not in the product shows one line and a SẮP RA MẮT pill,
  never a disabled form. Mật khẩu stores nothing and Avora AI answers nothing; giving either an input would
  promise a feature that cannot reply, which is the same dishonesty as a spinner over a failure.
- 2026-09-11 — The brand is now the twin-fold chevron lockup: the mark alone (on bone) as app icon and favicon,
  the mark beside the letter-spaced wordmark in the rail, and the full icon-plus-AVORA lockup centred on the sign-in
  column at ~264px, width-capped with `h-auto` so it can never stretch. Icon files keep their published names, so
  the PWA manifest and iOS meta are untouched and the service worker's rules stay exactly as chosen for v1.0; the
  full lockup ships under a new filename rather than overwriting an existing public asset, because `public/` files
  are served at stable, browser-cached URLs.
- 2026-09-11 — Avora Space closes on two quiet lines below the task cards, in this order: who is waiting, then one
  thought. The messages line counts CONVERSATIONS with something new, not messages — five unread from one person is
  one person waiting — and reads "X cuộc trò chuyện có tin mới" as a full-width card with a dotted chevron row into
  Tin nhắn. At zero it collapses to a single muted sentence, "Không có tin nhắn mới.", with no card and no link:
  an empty inbox should feel like nothing to do, not like a button greyed out.
- 2026-09-11 — Daily Thought is off until asked for (`khong_chon` is the default), and its wording is fixed data,
  never generated: 30 scripture lines and 20 maxims, stored verbatim. Scripture carries the speaker's name and
  NOTHING else — the book, chapter and verse live in the data file for checking the wording and can never reach the
  screen, because the view model handed to the page has no field to hold them. Maxims are shown with no name at all.
  The block is a bordered card on translucent bone with a hairline left rule down the quote, introduced by a line
  that changes with the hour on the same boundaries as the greeting (before 11 / before 18 / after).
- 2026-09-11 — The day's line is chosen by walking the list with a fixed stride that shares no factor with its
  length, seeded by the reader's LOCAL calendar day. This makes three promises exact rather than likely: reopening
  the app all day shows the same line, a new day always brings a different one, and every line appears once in any
  run of 30 (or 20) days — not merely in laps counted from some epoch. A shuffled-per-lap scheme was tried first and
  rejected: it can repeat a line across a lap boundary and leave others unseen for months.
- 2026-09-11 — Superseded, on the owner's instruction: the thought now sits directly UNDER the greeting and the
  reader's name, as part of being met by name, and is a hairline terracotta left rule rather than a card — the page
  opens on a thought, not on a count. It shows the line and the speaker and NOTHING else: the introducing sentence
  is deleted, not hidden, because the greeting above has already spoken and a second voice announcing each quote
  turned one quiet line into a performance. The time-of-day intro wording is therefore gone from the product
  entirely, along with the hour boundaries it needed. Who is waiting on a reply stays below the task cards: that is
  something to act on, not something to sit with.
- 2026-09-11 — Signing in lands on Avora Space, never on Tin nhắn. Opening on the inbox puts whoever wrote last in
  charge of the reader's attention, which is the opposite of what this product is for; opening on Avora Space means
  the first thing seen is what they chose to carry. All five paths home agree through one constant — sign-in,
  sign-up, a finished password reset, the bare "/", and a dead link (whose button now reads "Về Avora Space").
- 2026-09-11 — Since nothing redirects to the other tabs any more, the rail's badges are the ONLY reminder, so
  Nhiệm vụ gained one beside Tin nhắn's. It counts only what is overdue or waiting on this person's own move — not
  every open task — because a badge that is permanently lit is decoration, not information. A lit badge always
  means "yes, go and look"; badges remind, they never redirect.
- 2026-09-13 — Privileges are audited by probe, not by reading an advisor list. Two real holes were found that the
  Security Advisor never reported: every table granted TRUNCATE to signed-in users (and TRUNCATE ignores Row Level
  Security entirely, so a person could empty a table they cannot read one row of), and the RLS helper functions sat
  in the API-exposed schema where they answered questions about strangers — "is that person in that room?". Both were
  proven on throwaway tables before anything production was touched, and the TRUNCATE fix also changed the DEFAULT
  privileges so the next table created cannot re-open the hole. The helpers moved to a `private` schema rather than
  having EXECUTE revoked, because revoking it makes every guarded table silently unreadable.
- 2026-09-13 — A SECURITY DEFINER function may accept an id, but never as a claim about who is calling: the actor
  always comes from auth.uid(), and any id passed in is a target to be checked. All 60+ existing functions were read
  against this rule and all of them hold it.
- 2026-09-13 — The group Decision Log keeps two kinds in one place because they are the same idea at different
  temperatures: a Meeting Note is a decision already made, a Poll is one still being made. Both guarantees live in the
  database, not the interface. A finalized note is refused by a trigger for UPDATE and DELETE — proven by editing it
  as the table owner and being refused — so "locked" holds for anyone with an API key, not just for people looking at
  our screens. An open poll shows no tally because RLS hands the reader only their own ballot; the tally is genuinely
  absent rather than hidden, which is why the entry carries null instead of zeroes. An empty tally and a concealed one
  look identical on screen and only one of them is honest.
- 2026-09-13 — Delegation is one permission for one record, spent on use and stamped with what it produced, so
  "used" can never be claimed without something to show for it. A partial unique index allows at most one unspent
  grant per person per kind, so repeated granting cannot quietly stockpile into an unlimited licence.
- 2026-09-13 — Project mode is schema only: a flag on the group, objectives, deliverables, and two nullable columns
  on tasks. Reads are granted, writes are NOT — the rules that will validate an objective arrive with the feature
  that owns them, and granting INSERT early would leave a window where anyone in a group could write records nothing
  yet checks. Unfiling is not deleting: removing an objective sets a task's link to null and never removes the work.
- 2026-09-14 — "Important" and "how heavy" are opinions, not properties of a task, so they moved off `tasks` onto a
  per-person row. The person who asked for the work and the person carrying it rarely agree about either, and under
  the old single column one side's star silently reordered the other side's list. Each side now keeps its own reading
  and neither can see or disturb the other's — proven by two accounts holding opposite values on the same task.
- 2026-09-14 — The tab is "Quan trọng", not "Khẩn cấp": the deadline already answers urgency, and calling the tab
  urgent made every important thing without a date look like it did not belong there. Calling your mother takes four
  minutes, has no deadline, and is one of the more important things on the list.
- 2026-09-14 — Nhiệm vụ nặng is the one list NOT ordered by deadline. It sorts by the room left after the work
  itself is subtracted, because a four-hour job due tomorrow is in more trouble than a ten-minute errand due this
  afternoon — ordering heavy work by date would put the wrong task first, which is the mistake the view exists to fix.
- 2026-09-14 — A dashboard block now opens the reading that makes it meaningful, not just the filter. Sending a
  "1-1" click into the deadline timeline showed the right tasks with the grouping that made the block make sense
  nowhere in sight, so the screen appeared to have ignored what was clicked.
- 2026-09-14 — Editing a live task is open to both parties and stops when a done claim is filed. At that point the
  description IS the thing being reviewed, and rewriting it would mean judging finished work against wording that
  changed after the fact. An edit that changes nothing closes the form without writing, because bumping updated_at
  would tell the other side something happened when nothing did.
- 2026-09-14 — A Meeting Note's structured fields are optional but their LABELS are not: minutes lose things because
  nobody was reminded the field existed. Locking the note is also what hands out the work — an action item ticked
  "Tạo Task" becomes a real task at finalize, never while the note is still a draft being argued with. A ticked line
  missing a person or a date refuses the whole lock out loud rather than being skipped silently, and each line is
  stamped with the task it produced so re-locking cannot issue the work twice.
- 2026-09-14 — Đã thu hồi destroys the words, it does not hide them. The row survives so replies quoting it still
  have something to point at, but the text is gone from the database — a withdrawal that leaves the words readable to
  anyone with an API key is not a withdrawal. This forced the blank-content rule to become conditional (a live message
  must carry text; only a tombstoned one may be empty) rather than weakening the recall to a flag.
- 2026-09-14 — An edit is admitted out loud with "(đã chỉnh sửa)". A silent correction would let someone change what
  they are on record as having said, which is a worse problem than the typo it fixes. Both edit and recall are refused
  by the server past 24 hours, so the window is a rule rather than a hint the interface keeps.
- 2026-09-14 — Per-message actions collapsed into one "…" menu. Four icons on every line of a conversation is
  furniture; actions absent past their window beat actions offered and then refused, which teaches people not to
  trust the menu.
- 2026-09-14 — The quick reaction bar is not all positive. Sadness, sympathy and surprise belong in a real
  conversation as much as approval does — a set that can only agree turns every reaction into applause, and then
  nobody uses it to say anything true. Reactions have no stored count: the rows are the count.
- 2026-09-14 — Typing and presence are carried by the socket and stored nowhere, so closing a tab makes both facts
  disappear rather than leaving a stale "online" nobody can correct. There is deliberately no "last seen at": a
  timestamp outlives the moment it described and becomes a log of when someone was at their desk. The typing
  preference is one-directional — it silences what you send and never blinds you to others, because a privacy choice
  that charges a price is one people leave switched off for the wrong reason.
- 2026-09-14 — Mentions are stored as ids, never as the text "@Minh": display names change, so re-reading the words
  later could resolve to a different person or to nobody. The ids follow the words — breaking up a name un-names that
  person — and only recorded mentions light up, so typing "@nobody" cannot fake having named someone.
- 2026-09-14 — The Gia đình mark is one-directional and invisible to its subject. Asking for confirmation would turn
  "my mother" into a negotiation and a refusal into an insult; five fixed kinds rather than free text because the
  record exists to be read by the mute rule, which cannot act on a relationship typed out by hand. Adoptive parents
  and children sit inside `parent` and `child` — separate kinds would ask people to rank their own family.
- 2026-09-14 — Pins come in two kinds because two needs were being confused: a group pin is the room speaking
  (shared, limited, officer-only) and a personal pin is one person's bookmark that must not consume the room's space.
  The limit of three is the feature — a wall of twenty pins is a second inbox. An officer is ASKED which audience they
  mean rather than having "group" assumed, because silently publishing a private note to the whole room is the wrong
  default in the more damaging direction.
- 2026-09-14 — Muting AVORA is absolute: no family exception, no mention exception. An app that decided some of its
  own notifications were too important to obey the switch would make the switch untrustworthy, and then nobody would
  use it. Below it, family clears Tin nhắn and a tab, and being named clears a group only — in a 1-1 every message is
  already addressed to you, so "@" would exempt everything and the mute would mean nothing.
- 2026-09-14 — Every mute carries an end, and the per-tab layers get four fixed answers with no free-text box.
  Silencing the whole app is a decision about your own day; silencing one group is a decision about the people in it,
  who are left believing their messages arrive. There is NO mute for Nhiệm vụ anywhere — a task is a promise someone
  is waiting on, and the way to make it quiet is to finish it.
- 2026-09-15 — Depth for people who plan in depth, invisible weight for everyone else. Milestone, progress,
  and dependencies are all empty by default and stay empty unless asked for, gathered in one quiet block
  rather than sprinkled through the form. A plan where everything is a milestone has no milestones in it,
  and a percentage nobody maintains is worse than no percentage at all — so none of them is ever required,
  and leaving all of them alone is the ordinary outcome, not an unfinished task.
- 2026-09-15 — An empty progress box and 0% mean different things and are stored differently. A task nobody
  has estimated is not a task somebody reported as untouched; collapsing the two would turn every new task
  into a public claim of no progress. Clearing an estimate is therefore its own explicit request, never a
  side effect of setting some other field.
- 2026-09-15 — A dependency is stated, never enforced. Recording that one piece of work waits on another is
  a note about reality; turning it into a lock would mean the app telling someone they may not start their
  own work. Finished tasks stay linkable for the same reason — "this waited on that, which is now delivered"
  is exactly the history worth keeping.
- 2026-09-15 — "Bắt đầu làm" is one person's own note, never an announcement. Two people carrying the same
  shared task start at different moments, and one of them picking it up says nothing about whether the other
  has — so it can never be a single column on the task. It changes no status, tells the other side nothing,
  and mutes nothing; the indicator says "chỉ bạn thấy" because that is literally true.
- 2026-09-15 — A suggestion is not a task and no longer pretends to be one: it lives in its own place
  until somebody says yes. Writing the task the moment somebody asked put unanswered requests into the
  receiver's deadlines, counters and badges as though they had already agreed — the app counted a question
  as a commitment. The task is now created at the instant of "Tạo nhiệm vụ" and not one moment sooner, and
  "Bỏ qua" leaves no trace on any task list at all, because there was never anything there to remove.
- 2026-09-15 — An accepted suggestion becomes a task that is already accepted, not one waiting to be.
  The person pressing the button just agreed; asking them to confirm the thing they confirmed would be
  ceremony. Both halves of the two-party record are written at once because both genuinely happened.
- 2026-09-15 — A suggestion left unanswered past its proposed date stays answerable. Creating the task
  later moved it under the rule that refuses past deadlines, which would have made "Tạo nhiệm vụ" fail on a
  two-day-old request and left "Bỏ qua" as the only button that worked — declining by timeout, which is not
  an answer anybody gave. The task is created already overdue, exactly as an aged request always was.
- 2026-09-15 — The asker gets their own heading, "Đã gợi ý, đang chờ", collapsed on arrival. Waiting on an
  answer and having work underway are different states of mind, and only one of them is anybody's
  responsibility yet; nothing under this heading is owed by the reader, so it must not compete with work
  that is.
- 2026-09-14 — A shared task is a suggestion, not an instruction, so the two buttons are named for what
  they actually are: "Tạo nhiệm vụ" and "Bỏ qua", above a line saying who asked. "Xác nhận / Xoá" framed
  declining as deleting someone's request, which is why people left requests unanswered instead. Declining
  belongs to the person asked and to nobody else — a creator who could "skip" on their behalf would be
  withdrawing their own request while making it look like a refusal.
- 2026-09-14 — Bỏ qua is a state, not a deletion. The row survives so the person who asked can see their
  request was answered; erasing it would leave them unable to tell whether it ever arrived. A declined task
  stays on the list with its own shape — dashed, neither the empty square (still waiting) nor the filled disc
  (work somebody did) — and stops counting as open, because nobody is waiting on anyone any more.
- 2026-09-14 — Declining offers the words, already addressed to the asker and sendable without a keystroke.
  The hardest part of saying no is finding the sentence, and someone who cannot find it says nothing at all,
  which reads as being ignored. The offered line promises to come back to the matter rather than refusing
  outright, because that is usually what is true.
- 2026-09-14 — Silence is allowed in a 1-1 and refused in a group, and the database enforces the asymmetry.
  In a 1-1 the decline is visible on the task itself, so saying nothing still leaves the other person
  informed; in a group the same silence leaves a room watching a request go unanswered with no way to tell
  it was even seen. A group therefore has two options rather than three with one greyed out — an option
  offered and then refused teaches people the menu cannot be trusted. A written reply may not be blank:
  that is silence wearing the costume of a reply.
- 2026-09-14 — A silent decline leaves a quiet centred line, not a message and not a system notice: nobody
  said anything, so it gets no bubble, no sender and no reactions. It is derived from the task rather than
  stored, since a silent decline creates nothing to store. The wording stops at "có lý do riêng của họ" —
  choosing not to explain is a legitimate answer, and the thread must not imply an explanation is owed.
- 2026-09-14 — Every shared task raised from a chat must carry the conversation it came from, enforced where
  tasks are RAISED rather than as a NOT NULL column: eleven older tasks predate the in-chat flow and the
  recurrence spawner copies rows forward without a snapshot, so a column constraint would have demanded a
  fabricated quote for them. A suggestion with no trace of the exchange behind it is exactly what leaves the
  receiver unable to tell what it refers to.
- 2026-09-14 — An open poll is a question, so it stays answerable: while it is open a person may change their choice
  as often as they like, with no confirm step, because the point of asking is to learn what people think rather than
  to catch them at their first instinct. One person holds exactly one ballot row, so a change MOVES that row — "the
  last vote counts" is true by construction rather than by a tie-break rule elsewhere. Once the poll closes the
  ballot is fixed, because the result is published by then and a late change would rewrite something the room has
  already read. This narrowed an existing absolute rule: a ballot was immutable against every UPDATE, and the honest
  rule turned out to be immutable-once-closed. A vote can be moved but never withdrawn — there is no taking a ballot
  back out of the box, and the moment someone first answered is kept even as their choice moves.
- 2026-09-15 — Finishing asks one question, always, and never requires an answer. "Việc này mang lại điều gì?"
  appears at every completion (personal and shared alike) because the answer is what makes work worth reading back;
  but an empty box completes the task exactly the same as a full one, because demanding an essay before letting
  someone tick a checkbox would teach people to tick without opening the dialog at all.
- 2026-09-15 — An empty answer and a named result are stored differently, and the blank one is honest. A task
  completed without an output stays null and simply does not appear in Báo cáo — it is not a task with an empty
  result. The output is written once, at the claim; once the creator has reviewed, the record is closed and no
  retry can rewrite what was already judged.
- 2026-09-15 — Re-opening a task keeps the old output. It is a record of what happened last time, and the next
  completion overwrites it; erasing it by hand would be a separate decision, not a side effect of reopening.
- 2026-09-15 — Báo cáo is a section, not a view mode: it sits between the working lists and the bin, collapsed on
  arrival, holding only work that closed AND named what it brought, newest first. A task finished without an output
  has nothing to read back and gains no entry by merely being finished; what this person has binned is gone from
  their day however good its result was; and a group's completed result stays visible to anyone who can read the
  task, because a delivered result is worth seeing regardless of whose hands produced it.
- 2026-09-15 — A completed result lands in the journal by copying, not by moving. The journal is the one place
  nobody else reads, which is exactly why a result goes there; forwarding twice is ordinary journaling, not a bug,
  and the task itself keeps its result.
- 2026-09-15 — Celebrations are ephemeral by design. Confetti plays only on the screen of the person who finished
  the work; the milestone burst rides a realtime broadcast that nothing in the database remembers — no table, no
  unread counter, no history. The burst topic itself is not access-controlled, so its payload carries only opaque
  ids and each receiver reconstructs the meaning from their own caches: a non-participant reconstructs nothing.
- 2026-09-15 — Withdrawing your own question is not declining somebody's request. "Rút lại" belongs to the
  proposer alone and is deliberately a different action from "Bỏ qua": taking a question back says nothing about
  how the person asked would have answered, and must never be recorded as a refusal on their behalf. No task is
  deleted — none was ever created. It gets one confirmation and no second chance.
- 2026-09-15 — A question still open may be reworded; a question answered may not. Editing a suggestion moves
  only the wording — title, description, deadline — by the same rules the ask was born under. Who is being asked
  and the quoted exchange are not parameters, because changing them would be asking a different question, not
  editing this one. Once accepted, skipped or withdrawn, the record stands as what it was when it was answered:
  a retractable edit would let a proposer rewrite an offer after the other person had already relied on it.
- 2026-09-15 — A decline answered with words quotes what it declines. The reply is sent as an ordinary message
  that answers the very message the suggestion came out of, so the ask and its answer read together even with
  other talk in between; a suggestion raised in an empty thread has nothing to quote and its reply stands alone.
  A silent 1-1 decline still sends nothing — the annotation on the suggestion remains the whole answer.
- 2026-09-15 — Every task row says whose move it is, in its own weight. The reader's own work — their to-do, or
  shared work they were asked to carry — is ink at semibold; work somebody else is carrying is lighter, italic and
  warm grey. Italic does what colour alone cannot, because muted grey is already what finished and binned rows
  wear. This is a reading, not a ranking: it is deliberately NOT the tier that orders the list (two tasks in one
  tier can be in different hands), and it changes no sort, no filter and no count — nothing is hidden, everything
  stays exactly where its deadline put it. A finished or binned row ignores the distinction entirely: a closed task
  is nobody's next move, and bolding it would claim something is still owed. The weight is only a hint, so every
  row carrying it also carries the fact in words for anyone who cannot see two type weights apart.
- 2026-09-15 — Avora Space opens with the day named beside the greeting and three numbers that PARTITION what is
  open: late, due today, ahead. A partition, not three statistics — they always sum to the total the sentence
  beneath them states, so the page can never argue with itself, and they count exactly what every other open
  counter on the screen counts. Undated work is ahead, never late: someone should not be punished for writing
  something down without committing to a day. A zero sits in the unscheduled grey, because nothing overdue is good
  news and must not look like an alarm. Under them, one sentence names the single most pressing fact rather than
  repeating the strip in words.
- 2026-09-15 — The day's thought can be answered, and the answer belongs to the journal. The field stays shut
  behind one quiet line: a thought that arrives with an open text box beside it is homework, and this page sets
  none. What is written goes to the journal — the one thread nobody else can read — with the line it answers
  quoted above it, because a reflection read back a month later has to carry what it was reflecting on. Still no
  book, chapter or verse: the view model has no field to put one in. No new screen either, and an empty note is
  refused rather than saved — silence is a legitimate answer to a thought and should leave no entry at all.
- 2026-09-15 — On Avora Space the name is not a headline. The greeting, name and day read as one sentence at one
  size with only the name in semibold; a name set alone at display size takes the page's voice away from the
  thought, and the thought is what this page is for. Accordingly the thought itself is the largest text on the
  screen — larger than the greeting, larger than the sentence under the pulse strip — because a quotation meant
  to be sat with cannot read like a caption.
- 2026-09-15 — A celebration waits for the person who was not there. The live burst only ever reached whoever
  happened to be looking, which is almost nobody: shared work closes while the other person is asleep or in
  another part of the app. Closing a two-party task now records the moment in the database, and the next time
  that person opens the conversation it plays — once, then it is marked seen and never greets them again. It is
  emphatically NOT a notification: no text, no badge, no unread count, nothing to dismiss, and nothing to act on.
  A celebration that nags is not a celebration. It is also not retroactive archaeology: past a week the confetti
  stops firing, because applause for something finished a fortnight ago reads as confusion rather than joy — the
  row stays as the record that it happened. The realtime burst is untouched and still fires instantly for anyone
  present, so the two paths cover "there" and "not there" without either replacing the other.
- 2026-09-15 — Only finished work may celebrate, and only the database may say so. The row is written by a
  trigger on the crossing into done, never by a client: a task closes once, the task's own id is the key, so a
  retried completion cannot mint a second party. Shared and genuinely accepted work only — an unconfirmed task
  that somehow reaches done was never a promise between two people, so closing it is not news for a room. A
  personal task celebrates nobody else; there is no room to tell. Reading is scoped to the room it happened in
  and having-seen-it is scoped to the one person, with no update and no delete on either: seeing something is not
  undoable, and a client that could un-see a celebration could replay it forever.
- 2026-09-15 — A milestone is applause, not a bigger pop. Three waves in sequence, thrown to alternating sides
  of the screen, where ordinary work gets one — several pops read as a room clapping, while one huge pop reads as
  the same event with more confetti. Capped at five: past that the screen is merely busy and the waves start
  delaying whatever the person wanted to do next. Someone returning to a week of finished work gets one generous
  celebration rather than forty, because the point is the welcome, not the arithmetic.
- 2026-09-15 — Confetti belongs to the screen, not to the panel the button was in. The canvas is parented to the
  document and sits above every overlay, so a milestone closed from inside a sheet, a dialog or the chat task
  panel fills the whole window instead of being a few squares trapped in a box — the celebration is for the
  person, and they are not looking at a panel, they are looking at Avora.
- 2026-09-15 — Dropping a feeling has weight. Every emoji in the picker answers a press with the same small
  scale-down-and-overshoot — not just the heart: the bar is deliberately not all-positive, and a press that only
  feels alive when you agree teaches people that only agreement counts. One bounces at a time, because two moving
  at once would make it ambiguous which face took the tap, which is the animation's entire job. The reaction is
  saved the instant the button is pressed and the sheet waits out the bounce rather than the network — the pause
  is the animation's, never the data's — and it stands down entirely for anyone who has asked for calmer motion.
- 2026-09-15 — The daily maxim belongs to the calendar, not to a shuffle. Danh ngôn v0.2 is 365 lines, one per
  day of the year in order, and the year itself turns the wheel: offset = year × 137 mod 365, so the same date
  opens a different line each year while a year never repeats a line. 137 is coprime with 365, so the same date
  takes 365 years to come back around. v0.2's own edit is honored in the text: no "hơn / nhất" — a line states
  what is true and does not need to rank itself above something else to be honest.
- 2026-09-15 — Scripture is paused, not deleted. The picker stops offering it, but it stays a working category:
  someone who chose it before the pause keeps seeing their verse every day, and their own picker still lists it —
  hiding it from them would silently rewrite what their saved setting means. The pause only stops new selections.
  The old "Không chọn" becomes "Ẩn", which says what it does, and someone who never chose anything now opens on
  the maxims — a thought, not a blank. The old default ('khong_chon') was the stored value for both "never chose"
  and "explicitly chose nothing", so those could not be told apart; existing rows were moved to the maxims and
  anyone who wants the quiet back is one tap from "Ẩn".
- 2026-09-15 — A leap year's extra day is not given its own line. Day 366 repeats day 365's maxim: the list is
  shaped by the 365-day year, and December 31st should read the year's last line, not a 366th thought invented
  for a calendar quirk.
- 2026-09-15 — Cài đặt is four siblings, not one page wearing four hats. Thiết lập and Thông báo left the
  profile — the account a person IS and the app's behaviour around them are two different questions, and a
  screen that mixes them makes the second one feel hidden. Hồ sơ keeps only the person and their way out;
  every option moved verbatim, value for value. The strip of tabs is the map, so a section that exists only
  as a promise (Avora AI) sits in the same row as the ones that answer.
- 2026-09-15 — Tin nhắn's strip is a roadmap, and it says so honestly. Five tabs in reading order: Nhật ký,
  1-1, Nhóm, Dự án, Email. The two that are not built yet borrow the same "Sắp ra mắt" screen as Mật khẩu
  and Avora AI — one line, no inputs — because a placeholder that pretended to have a function would be a
  door into a wall. Their labels name what they will be, not what they are.
- 2026-09-15 — The desktop columns answer the hand. On web, the rail and the list can be dragged wider or
  narrower, the choice is remembered per device (never in the account), and it stays inside a range where
  every column still works — a layout someone can render unusable is a layout that will be made unusable.
  Double-clicking a handle gives the default back, because a customization people cannot undo they will not
  make. The phone keeps its single column and never sees a handle.
- 2026-09-15 — A contact is either a person or a company, and the record says which from birth. `contact_type`
  is required with no default: a row that has not decided what it is would let every later rule guess. Each
  type carries only its own fields (a person has a birthday, a company has a tax code and a representative),
  and the required set differs — a person needs one way to reach them, a company needs its tax code, its
  representative, and one channel among the four it may have.
- 2026-09-15 — Validation lives in the database, not in the form. `create_contact` is the only door: it takes
  the owner from the session rather than from the client, and rejects an incomplete contact before a row
  exists. The cross-row rules Postgres cannot express as CHECK (an employer must be a company; only a person
  can have an employer or a linked account) are triggers, so they hold whether the write came from the app,
  a script, or a future screen nobody has written yet.
- 2026-09-15 — An invitation is a person-to-person act. Only an individual contact can be invited (a company
  is not someone who signs in), only its owner can invite, and accepting is a single privileged step — the
  table itself grants no UPDATE, so a status cannot be flipped by hand. Accepting writes both directions at
  once: the inviter's contact gains the link, and the person accepting gets their own contact pointing back.
  A relationship only one side can see is not a relationship.
- 2026-09-16 — Liên hệ stopped being a by-product of having chatted. It used to list whoever a conversation
  existed with, which quietly meant the address book could not hold the people who matter most before the
  first message — or anyone not on AVORA at all. It now reads the contact records themselves, so a contact
  exists because someone decided to keep it, and stays after the last message.
- 2026-09-16 — People and companies are two tabs, never one mixed list. They answer different questions
  ("who do I call" / "who do I invoice"), they are searched by different fields — a person by name, phone or
  email, a company by name or the tax code being copied off an invoice — and their rows carry different facts.
  Sorting them together by name would put a tax code between two phone numbers. A company's representative is
  deliberately not searchable: the row on screen shows the company and its code, so a hit on a hidden field
  would read as a bug.
- 2026-09-16 — Adding a contact begins by naming what it is. The type is asked before anything is typed,
  because it cannot be changed afterwards and the two forms barely overlap; one form with fields that appear
  and vanish would make that permanent decision invisibly, halfway through filling it in. The form's own checks
  are a mirror of the database's, kept only so the button can explain itself before a round trip — the server
  validates independently and is the one that decides.
- 2026-09-16 — A company's record offers no invitation and no message button, and the absence is the point.
  A company does not sign in, so a button that existed only to be refused would promise something the model
  never made. It shows who works there instead — the question actually asked of a company. An empty staff list
  says so in one line rather than hiding the section: "nobody recorded yet" and "no such field" are different
  facts, and hiding the block would make the first look like the second.
- 2026-09-16 — An invitation is prepared, not sent. Each channel opens the person's own messages app with the
  text already written, so the last read and the send belong to them — the same rule that keeps AVORA out of
  calendars and phone calls. Once one is waiting, the buttons are replaced by its status rather than sitting
  beside it: a second invitation would issue a second token, and the one they already tapped would be wrong.
- 2026-09-16 — Editing measures a contact against the type it was born with. `update_contact` takes no type
  parameter at all — it re-reads the stored one and applies that type's rules, so a person cannot be edited
  into a company. Ownership is re-checked inside the function rather than left to RLS, since a definer function
  bypasses it, and the employer must be a company in the caller's own book: the trigger blocks pointing at a
  non-company, but only this check blocks pointing at someone else's. The link to an account is not editable
  by any form — only accepting an invitation sets it.
- 2026-09-16 — An invitation link now has somewhere to land. It was being handed out before the screen that
  receives it existed, so every invitation already sent ended on the not-found page — the one part of the
  handover AVORA does control, and the one it was dropping.
- 2026-09-16 — The person receiving an invitation cannot read it. The invite row is visible only to its
  sender and a profile only to its owner, so the screen could not answer even "who is asking?" — or "does
  this token exist?". A read-only function answers those on the invitee's behalf, the same way group links
  are already previewed. It returns the inviter's name and nothing else: whoever holds the token can call it,
  so every extra field would be a field given away, and the name the sender wrote down privately is not the
  screen's business.
- 2026-09-16 — Everything that can stop an acceptance is read before anything is pressed, and the button
  exists only where pressing it can work. A link is opened days later, by the wrong person, twice — so the
  five dead ends are stated as sentences instead of arriving as a button that fails. The sender opening their
  own link is told they meant to forward it, not shown the database's refusal; an already-accepted link
  reports the outcome even to its sender, because that is the useful fact rather than the one they know.
- 2026-09-16 — The preview is a courtesy, not a gate. Accepting re-checks every rule server-side, so a page
  left open while something changed elsewhere refuses honestly rather than writing half a link — and the
  screen re-reads itself afterwards, so a stale invitation is never left sitting next to its own refusal.
  Accepting lands on the address book, where the contact it just created is the proof it worked.
- 2026-09-16 — An invitation is good for 14 days. Both the preview and the acceptance already had a branch
  for an expired invitation, but nothing ever set that state, so in practice no invitation ever ran out — a
  link messaged once stayed acceptable forever. Expiry is now decided in one shared place both of them call,
  so the screen and the acceptance cannot drift: a link the screen calls expired is one acceptance also
  refuses.
- 2026-09-16 — Running out of time is worked out when read, not written down. It follows from when the
  invitation was sent, so storing it would mean writing to the table every time someone opens an old link —
  and leaving a never-opened one marked "waiting" forever, the same row meaning two things depending on
  whether anyone happened to visit. Nothing has to run on a schedule when the answer can always be computed.
- 2026-09-16 — Expiry and never-existed stay separate sentences. An expired link was real and the sender can
  simply send another, so it says so and names the 14 days; an unknown token never existed, and telling
  someone to ask for a new link is only useful when there was an old one.
- 2026-09-16 — A timed-out invitation stops counting as one still waiting. The sender's panel replaces the
  invite buttons with a status while something is pending, so a link that had quietly run out would have
  stranded them twice over: still told the person was deciding, and unable to ask again. Only an invitation
  that can still be accepted holds those buttons back.
- 2026-09-16 — An invitation must have somewhere to go. Sending was checked against who was asking and what
  kind of contact it was, but never against whether the chosen way had an address: a person with only an
  email could be invited "by message", which issued a token and wrote a row with no number to send it to.
  Both the channel checks now live next to the ownership ones, so the gap closes for anything calling the
  function, not only for the screen. A missing entry in the original specification rather than a coding slip.
- 2026-09-16 — A link needs no channel of its own and is always offered. Whoever sends it picks how to pass
  it on — messages, email, paper — so demanding a stored address to copy a link would deny the one route
  that always works, and it is exactly the route left for a contact with nothing else written down.
- 2026-09-16 — A way that cannot work is left out rather than shown greyed out, the same rule already used
  for importing from the phone book. A disabled button poses a question it does not answer; an absent one
  leaves the choices that do work, and the remaining link keeps the panel from ever being empty.
- 2026-09-16 — The screen and the database refuse the same thing, and the refusal is still translated. The
  screen only leaves buttons out for what it can see, so a number deleted on another device while this page
  sat open still reaches the database's own objection — which is then said in the reader's language, and
  names the link as the way through instead of dead-ending.
- 2026-09-16 — An address book arrives by spreadsheet first. Of the ways in that were weighed — the phone's
  own contacts, a mail account, iCloud — a file is the only one that works on every browser and device, needs
  no permission from anyone else, and shows the person exactly what is about to be written before any of it
  is. The other routes are additions to this one, not replacements: they all end at the same preview table.
- 2026-09-16 — The file states the type; the importer never guesses it. A `loai` column filled in by hand is
  the person's own explicit word on whether a row is a human being or a company, which is the one fact that
  can never be edited afterwards. Inferring it from whether a tax code happened to be filled in would put
  that permanent decision in our hands, silently, hundreds of rows at a time.
- 2026-09-16 — A person has one name but several numbers, so the extra ones live in their own table while
  the contact row keeps holding the primary phone and email. Widening the contact row was the other option
  and was rejected: every screen, every stored procedure and every invitation rule already reads those two
  fields, and they would all have had to learn which of several numbers counts. The result is that a contact
  with a single number stores nothing at all in the new table — the simple case pays nothing for the
  complicated one.
- 2026-09-16 — Two numbers written differently are one number. `+84 912 345 678` and `0912345678` reach the
  same person, so someone who stored one form and imported the other must end up with one contact rather
  than two. The rule that decides this now exists in the database as well as in the app, because the table
  itself refuses duplicates and has to agree with the screen that predicted them — if the two ever drifted,
  the preview would promise a merge that the database then stored twice.
- 2026-09-16 — An import can tell that someone has three numbers; it cannot tell which one they answer.
  Rather than guess and quietly promote the wrong one, every channel arriving from a file or a phone book is
  marked as unconfirmed, and a separate screen is where the one person who knows settles it. Guessing would
  have been invisible and wrong; asking at import time would have stopped a bulk action to interrogate
  someone about hundreds of rows.
- 2026-09-16 — Owning a contact and owning its channels is checked twice, in two different ways. The row
  carries its owner so the permission rule is a comparison rather than a lookup, and a separate check makes
  sure that owner always matches the contact's — otherwise someone could attach their own number to a
  stranger's contact, since both halves would look legitimate on their own.
- 2026-09-16 — Correcting a number is removing it and adding it again, not editing it in place. Only the
  confirmation mark and the label can be changed after the fact, which keeps the record of where each value
  came from honest: a number that arrived from a phone book cannot quietly become something else while still
  claiming that origin.
- 2026-09-16 — Adding a channel that is already there is not an error. A file routinely repeats the same
  number in two columns, and failing the whole batch over something harmless would punish the person for
  their spreadsheet's habits — so a repeat quietly returns what is already stored, and a value that merely
  restates the contact's primary channel adds nothing at all.
- 2026-09-16 — Nothing is ticked when the table opens, not even the rows that are perfectly valid. An import
  writes to the address book in bulk, so the tick is where the person takes responsibility for each row; a
  pre-ticked table would make "import everything" the accidental default and the review a formality.
- 2026-09-16 — A broken row stays visible and loses its checkbox rather than being dropped or greyed out.
  Dropping it silently would leave someone counting rows and finding fewer than they sent, with no clue which
  ones; every complaint about a row is listed at once, so reopening the spreadsheet fixes the whole line in
  one pass rather than one re-upload per problem.
- 2026-09-16 — A match already in the book defaults to being left alone. Of the three answers — fill the gaps,
  skip, write a second row — only skipping is certain to destroy nothing, and the other two stay one click
  away. Filling the gaps is offered only between two contacts of the same kind, because a person's details
  poured into a company row are nonsense, and it never overwrites a field that already had something in it:
  the file is a source of missing facts, not a correction to facts already recorded.
- 2026-09-16 — The uploaded file is read, shown, and forgotten. These are other people's phone numbers held
  only because someone is passing them along, so nothing is cached, no draft table is kept, and closing the
  dialog starts the next attempt from an empty file picker. There is nothing to re-run on the next visit
  because there is nothing left to re-run it on.
- 2026-09-16 — Inviting is a separate step after importing, and its defaults are inverted. Everyone new is
  ticked here, unlike the import table: these are people the user just deliberately added, so asking them to
  tick the same names twice would be ceremony. Email leads where both channels exist — it carries a whole
  sentence and a link, and costs the sender nothing — and a channel the contact has no address for is never
  drawn, matching what the database would refuse anyway.
- 2026-09-16 — A spreadsheet and a phone book become the same thing before anything is decided about them.
  They disagree about almost everything — how they are read, what they may ask for, whether they know a
  contact's type — but they agree completely on what follows: is this person already here, which number is
  the real one, should they be invited. So each source only converts its own entries into one shared shape,
  and every decision after that is written once. The alternative, two parallel flows sharing helpers, is how
  the two would have slowly come to behave differently on the same data.
- 2026-09-16 — The phone book route is absent where it cannot work rather than present and refusing. Only
  one browser family exposes a contact picker at all, and the file route works everywhere — so on the rest
  there is simply no button, the same rule already used for an invitation channel the contact has no address
  for. A greyed-out button would pose a question it cannot answer.
- 2026-09-16 — The device is asked what it can share before it is asked to share. Requesting a field a phone
  book does not support rejects the entire request, so asking for "name, number, email" outright would yield
  nothing at all on a device that withholds emails, instead of the numbers it was willing to give. Where
  neither numbers nor emails are on offer the attempt stops with that said plainly, since a name alone is not
  a contact and a picker whose every result would be discarded is worse than an explanation.
- 2026-09-16 — Where the source states the type, it is never questioned; where it cannot, the question is
  asked once, at the row. A filled-in `loai` column is the person's own word and the one fact that cannot be
  edited later. A phone book has no notion of a company, so guessing from an organisation field would file
  someone as a business on the strength of their employer being written down — instead a toggle, off by
  default, opens exactly the two fields a company cannot exist without and holds the row back until they are
  filled. Asking there beats a create call that fails one row at a time after the person has walked away.
- 2026-09-16 — A duplicate is judged against every channel of every candidate, not the first of each kind.
  The number that identifies someone already in the book is routinely not the one their file lists first, and
  it may not be a primary channel at all — so all of them are compared against both the contact rows and the
  channel table. A cheaper check would quietly write second copies of people already there.
- 2026-09-16 — A merge hands every number it brought to the one place that can compare them. It cannot tell
  which of them the existing contact already holds, and the channel call already refuses a value that repeats
  the primary channel or something stored — so guessing locally would either lose a new number or store a
  duplicate, while passing everything through adds only what is genuinely new.
- 2026-09-16 — An entry with no way to reach anyone is left out of the table rather than listed as broken.
  A spreadsheet line missing a field is a mistake its author can go and fix, so it is shown with its reason;
  a phone book entry with no number is not a mistake at all, and showing it as an error would ask someone to
  repair something they never wrote.
- 2026-09-16 — A spare phone number does not fail its contact. If filing an extra channel is refused, the
  person is already written down and reachable on their primary number, so the import keeps going and only
  the channel is logged as lost — unwinding a good contact over a second phone number would cost more than it
  saves.
- 2026-09-16 — The flow ends on the one thing worth doing next, never on a static list. If the import could
  not tell which of someone's numbers is the real one, that question is handed over with a way straight to it;
  if nothing was left open, the same place says so and goes back to the address book. A summary that simply
  stopped would leave the unresolved numbers to be discovered weeks later, by accident.
- 2026-09-16 — There are two ways a phone number can be tangled, and they are opposite questions. One person
  with three numbers asks "which of these is theirs"; one number on three people asks "which of these people
  is it". They read almost identically as sentences and mean nothing alike, so they sit in separate blocks
  under their own headings, each absent entirely when it has nothing in it. Interleaving them would turn every
  row into a small puzzle about what is being asked before it could be answered.
- 2026-09-16 — A shared number is found by grouping the address book on read, not by a stored flag or a
  scheduled sweep. It is a fact about the data as it stands rather than an event anyone caused, so a contact
  created a second ago is already part of it and there is no cache to fall out of date. The two lists this
  screen already loads are enough; the check costs no request at all. Primary and extra channels are compared
  in one pass, because a number shared between one contact's phone field and another's spare channel is
  exactly the case a cheaper check misses.
- 2026-09-16 — A contact holding the same number twice does not count as sharing it with itself. That is the
  other block's question, and counting it here would report a tangle no choice on this card could fix.
- 2026-09-16 — Taking a number off a contact is addressed by the number, not by the row holding it. The person
  is answering "this is not theirs"; whether their copy sat in the contact's own phone field or in the
  extra-channels table is a fact about storage, not about the decision. One call, because clearing the field
  and promoting whatever number is left to replace it have to happen together — done separately there would be
  a moment where the contact has numbers on file but none reachable, and saving that contact would be refused
  until somebody worked out why.
- 2026-09-16 — Nothing may leave a contact with no way to reach it. Creating and editing both demand at least
  one channel, so a removal that emptied the last one would produce a record that can never be saved again
  while still looking fine on screen. If another number or address is on file it takes the place; if there is
  genuinely nothing left, the removal is refused and says that plainly.
- 2026-09-16 — The three answers are offered plainly and none is chosen for the reader. Every one of them
  deletes something from somebody's contact, which is precisely where a second press earns its cost — unlike
  the everyday acts elsewhere in AVORA, which are never made to ask twice.
- 2026-09-16 — "This belongs to a company" is offered only when a company is already one of the holders.
  Otherwise the answer would mean picking a company out of the whole address book: a larger, different
  decision than the one being made, and not one anybody asked for while tidying a duplicate.
- 2026-09-16 — When a number is declared a company's, the company is made certain of it before anyone gives it
  up. In the other order a refusal halfway through would leave the number on nobody at all. Each holder is
  also cleared separately and a refusal is reported by name: six contacts sharing a number is already a mess,
  and abandoning the cleanup at the second one leaves a worse one.
- 2026-09-16 — A card acting on a group that has since changed deletes nothing. Naming a contact that no
  longer holds the value yields an empty plan and an explanation, never a fallback of "remove from everyone" —
  a stale screen is the one case where the permissive reading would destroy the most and explain the least.
- 2026-09-16 — Each contact keeps its own spelling of a shared number, including the company that ends up
  owning it. "+84 900 111 222" and "0900111222" are one number to every rule in the system and two different
  things to the person who typed one of them, so the card shows what each contact actually stored and each
  removal quotes that contact back to itself.
- 2026-09-16 — The banner into this screen counts both kinds of tangle as one number. Someone with two
  unconfirmed numbers and one shared number has three things to look at, not two lists to add up in their head
  — though the line beneath still says which kinds are waiting, because the two need different thinking.
- 2026-09-16 — A phone book export is the third way in, because on an iPhone it is the only way in. Safari has
  no contacts picker and never will by our doing — Apple withholds it — so an iPhone owner previously had no
  bulk route at all short of typing a spreadsheet by hand. The same file is what Android, Outlook and Gmail
  export, so one reader serves every device rather than one per vendor.
- 2026-09-16 — The phone book file is not a separate feature. It is chosen in the same dialog, by extension
  alongside the spreadsheet, and from the preview onwards runs the identical code: same duplicate matching,
  same company question, same invitations. A second "import contacts from vCard" flow would double every
  decision the first one already answers and let the two drift apart.
- 2026-09-16 — Every number on a card is kept, not the first of each kind. A person with a mobile, a desk line
  and a home number has three, and an import that silently took one would lose the other two at the moment
  they were finally being written down. The first of each kind becomes the contact's own field and the rest
  are filed as extra channels, exactly as a spreadsheet's second column is.
- 2026-09-16 — The card's own `TYPE=WORK` pre-fills a channel name and decides nothing. Phone books disagree
  about these words — an iPhone writes CELL for a number its owner uses purely for work — so it arrives as a
  suggestion the person can rename. A type nobody can interpret suggests no name at all: an invented "Khác"
  would read as though somebody had decided something.
- 2026-09-16 — A card naming a company still waits to be confirmed as one. Apple states it outright, and an
  organisation standing alone with no person beside it is the other honest sign; an employer written next to
  somebody's name is not, and guessing there would file a person as a firm. Either way the card cannot supply
  a tax code or a representative, so the row stays unimportable until a person supplies them.
- 2026-09-16 — One unreadable card costs one contact, never the address book. The file is cut into cards
  before the parser sees any of them, because the parser refuses a whole file over a single bad entry — and
  a truncated card stops at the next one rather than swallowing the person written after it. Cards that
  yielded nothing at all are counted and shown, in the same place a spreadsheet's unusable lines are.
- 2026-09-16 — Line endings, an unknown version number and Android's quoted-printable are repaired rather
  than refused. All three are facts about how a file was written, not about the contact inside it, and a card
  whose name and number are perfectly legible should not be dropped over its punctuation.
- 2026-09-16 — The ceiling rose from five hundred to five thousand only once the two things that made it a
  real limit were fixed: the preview now renders just the rows on screen, and contacts are written several at
  a time. A whole phone book is one file, and making somebody split their own contacts into ten pieces was a
  limit of our making, not theirs. It stays a ceiling — past that a browser holding every row breaks next,
  and a refusal naming the limit beats a tab that dies silently.
- 2026-09-16 — Parallel writing is shaped by what can actually collide. Two rows merging into the same
  existing person run in order, because each sends a whole record built from the copy it read and the second
  would undo the first; everything else runs freely. Results are filed by position, so the closing report
  reads in the order of the file the person will go back to.
- 2026-09-16 — The progress count is painted on a timer, not on every write. At five thousand contacts it
  changes faster than a screen refreshes, and redrawing the dialog that many times would make the import
  slower than the requests it is reporting on.
- 2026-09-16 — Only long lists are virtualised. A dozen phone-book entries in an inner scroller inside a
  dialog that already scrolls is worse than the problem it solves, so short lists render exactly as before
  and the machinery appears only when a file is big enough to stutter without it.
- 2026-09-16 — A file no longer has to use our column names. It used to be turned away at the door —
  "thiếu cột loai hoặc ten" — which asked somebody to go and rename the headings of a report they did not
  write, in a file they may not know how to edit. Now the file keeps its own headings and is asked about
  once instead: "Họ tên", "SĐT" and "Full Name" are ours as far as anyone using them is concerned.
- 2026-09-16 — The matching step is a layer in front of the importer, not a change to it. It rewrites the
  file under our own headings and hands it on, so from that line forward a CRM export and a file saved from
  our template are the same table going through the same validation, duplicate matching and preview. Nothing
  downstream can tell them apart, which is what stops the two from drifting.
- 2026-09-16 — A heading either is a word we know or it is left for a person to answer. There is no
  similarity scoring and no nearest match: a wrong guess here files two thousand phone numbers as notes, and
  it would sit pre-filled on a screen most people click straight through. An empty dropdown asks a question;
  a plausible wrong one does not.
- 2026-09-16 — Punctuation is not part of a heading's identity, but the heading shown is always the file's
  own spelling. "S.Đ.T" and "SĐT" are one word for matching, while the dropdown, the stored choice and the
  "not importing" list all quote the file back to itself — somebody checking our reading of their
  spreadsheet should see their own words, not our normalised version of them.
- 2026-09-16 — One column cannot fill two fields. A file with a single "Liên hệ" column would otherwise
  become both the phone and the email, and duplicate the same value into two places for every row.
- 2026-09-16 — A missing name column is said once, about the file, at the moment it can be fixed by one
  dropdown. The same fact discovered at the preview is two thousand identical per-row complaints about
  something that was never a property of any row.
- 2026-09-16 — A file that never says what its rows are is asked once, for the whole file, and every row
  stays changeable at the preview. A file that does have a type column keeps its own values, blanks
  included — a row whose type was left empty is a row somebody has to look at, not one for us to decide.
- 2026-09-16 — The mapping is remembered per person and per layout, keyed by the set of headings rather
  than their order, so next month's export of the same report arrives already filled in even if a column has
  moved. It is always shown before it is used: a report that has grown a column since last time would
  otherwise be read wrongly and silently, and this is the step that writes to somebody's address book.
- 2026-09-16 — A remembered choice is believed only as far as the file in hand allows. A heading that has
  since disappeared is dropped rather than followed to whatever now sits in that position, and a stored
  mapping that no longer fits anything counts as no memory at all.
- 2026-09-16 — The template is now an offer rather than an instruction. It stays on the first screen,
  because starting from a known-good file is still the easiest route for somebody with no export at all, but
  the wording no longer implies the columns must match.

### Tiền đã hẹn trước — vay, cho vay và thuế

- 2026-09-16 — Money that has been promised lives in the same ledger as money that has moved, not in a
  second book beside it. A loan and a lunch both change what is in the account, and two separate books would
  mean two balances to reconcile and two places to look before anybody could answer "what do I actually have".
- 2026-09-16 — An obligation has no spending category, and the database refuses to let it have one. A loan
  filed under "Ăn uống" would read as money eaten; the four new types answer "what kind" with their own name
  instead. Income and expense still require a category exactly as before — the rule now depends on the type
  rather than applying blindly to every row.
- 2026-09-16 — Direction is declared per type rather than assumed. The ledger used to add income and
  subtract everything else, which was true while everything else was expense; borrowing brings money in, so
  the assumption had to be replaced by a statement before a loan could be recorded at all. One function in
  the database and one table on the client, deliberately mirroring each other, because a balance on screen
  that disagrees with the balance in the ledger is worse than either being wrong alone.
- 2026-09-16 — Recording a borrowing moves the balance immediately, including while it is still marked as
  planned. The money is in the account from the day it arrives whatever the paperwork says, and a balance
  that waited for a status to change would be a balance nobody could trust against their own wallet.
- 2026-09-16 — Obligations never reach income or expense totals. Borrowing is not earning and repaying is
  not spending: letting either into a profit-and-loss would inflate both sides of it and overstate the tax
  owed on the result. They move balances and net worth, and they stay out of the eight reports.
- 2026-09-16 — The state of an obligation is worked out from the due date and what has been paid, never
  stored as somebody's opinion. A row that simply sat there overnight becomes overdue without anyone writing
  to it, so the database recomputes it on every write and the screen derives it again on every read.
- 2026-09-16 — Overdue outranks part-paid. Having paid half of something that is now late does not make it
  less late; the badge says what needs doing and the amount still owed says how far along it is.
- 2026-09-16 — A payment is added to what has been settled and never subtracted from what was owed. The
  original figure is the agreement, and a ledger that quietly rewrites it loses the only record of what was
  actually promised.
- 2026-09-16 — Borrowing and lending must name a person, and that person must be one of your own contacts —
  checked in the database, not in the browser. A debt with nobody attached is an amount with no way to
  settle it. Tax asks for a period instead, because there is nobody on the other end to name.
- 2026-09-16 — The four types get their own form rather than four more branches inside the thu/chi form.
  The required fields genuinely differ, and folding them together would put conditional inputs for loans and
  tax periods in front of somebody recording a bowl of phở.
- 2026-09-16 — An opportunity is a record ABOUT a contact, not a field on one. Most of an address book is
  family and friends who will never be business, one customer can be two separate deals at once, and a stage
  written onto the contact row would print a sales word next to somebody's mother. A contact that is not an
  opportunity therefore costs nothing but one quiet button.
- 2026-09-16 — The opportunity book is private, deliberately, even when a deal is tied to a group
  conversation. The group is discussing work; its members are not jointly watching one person's sales funnel.
  So there is no exception in the rules for fellow participants — the four database rules are one sentence,
  "yours to read, yours to change", and a shared thread does not widen it.
- 2026-09-16 — Tying a deal to a conversation asks two questions, not one: are you the owner of this
  opportunity, and are you still in that conversation. Checking only ownership would turn a guessable id into
  a way to test whether a conversation exists. Untying is the same call with nothing named, because a link
  that only goes one way traps whoever attached the wrong thread.
- 2026-09-16 — The five stages move in any direction. Re-reading a customer as cooler than you thought and
  stepping back from "đang chăm sóc" to "tiềm năng" is ordinary judgement, so the picker offers all five at
  once rather than a next/previous pair that would imply a deal only ever improves.
- 2026-09-16 — The address book badges what is still in play, never what once was. "Đối tác" and "không
  thành" are both endings — one won, one lost — and neither is waiting on anybody, so neither marks a row.
  A contact holding both a closed deal and a live one still counts as live: the badge answers "is there
  anything open here", and last year's result should not hide today's work.
- 2026-09-16 — A contact being a company does not decide whether it can be a lead. A freelancer is as much
  a piece of business as a firm, so the section is offered on both. The contact type says who somebody is,
  not whether there is business to be had with them.
- 2026-09-16 — Nothing estimated reads as "chưa định giá", not as zero. A new lead usually has no price
  yet, and "0 ₫" would claim the deal is worthless — a different statement from not having priced it.
- 2026-09-16 — Opening a deal and dropping one are not symmetrical. Marking a contact is one press,
  because it only starts watching something; removing takes two and says what survives — "liên hệ vẫn giữ
  nguyên" — because the two things being confused there would cost somebody a contact.
- 2026-09-16 — A task can point at an opportunity only if both belong to the same person, and the database
  enforces that through the key itself rather than a rule written in a second place. Deleting an opportunity
  cuts the link and leaves the task, which is why the cut names its column: a paired key would otherwise
  blank the task's author too, and refuse the deletion with a message about a field nobody touched.
- 2026-09-16 — Deleting a contact takes its opportunities with it. An opportunity must name a contact to
  mean anything, and the alternative is a deletion that fails with a foreign-key complaint on a screen that
  never mentions the word "cơ hội". A conversation disappearing is the opposite case and only clears the
  link: the customer is still being tracked.
- 2026-09-16 — The stage is not writable from the browser even by its owner. It travels through the one
  call that knows the five permitted values, while the title and the estimate are editable in place — and
  ownership fields are editable by nobody, since a direct write there would move a deal onto someone else's
  contact in a way the row-level rules cannot see.
- 2026-09-16 — "Dự án" is left as an empty column with no relationship attached. The module does not exist
  yet, and inventing the connection now would mean either a table nobody uses or a link pointing at nothing.
- 2026-09-17 — Tổng quan now opens with what money is asking for, above the four figures rather than
  instead of them. Borrowing, lending and tax existed in full but were invisible outside the Giao dịch list,
  so the one question a person actually opens a ledger with — is anything due — had no answer on the screen
  meant to answer it.
- 2026-09-17 — Late is a column of its own, never a share of "sắp tới". This is the rule Nhiệm vụ already
  follows: a thing that is past its day is a different kind of fact from a thing that is coming, and folding
  the two into one number lets the late one hide inside it. The three counts are a partition — overdue,
  today, the next seven days — so they always add up and nothing is counted twice or left out.
- 2026-09-17 — The strip shows counts and no amounts. It exists to send somebody to a list, and a figure
  here would only be a worse copy of the one on the screen it leads to. Each number is a button for the same
  reason: a count nobody can act on is just anxiety. A number at zero is not a button at all, since offering
  to open an empty list is a promise the screen cannot keep.
- 2026-09-17 — Tapping a number filters the existing ledger instead of opening a screen of its own. The
  filter lives in the address, beside the month and category filters that were already there, so the three
  due counts are a way into what exists rather than a fourth place where obligations are listed.
- 2026-09-17 — Giá trị ròng now counts what is owed each way, and counts it exactly once. Money lent out
  has already left the account, so what is still to come back is an asset nothing else records; money
  borrowed is already sitting in the account, so what is still to repay is a debt nothing else records.
  Recording either now leaves a person exactly as wealthy as they were a minute before, which is what makes
  the figure trustworthy.
- 2026-09-17 — Tax is deliberately left out of that sum. A tax bill lowers the balance the day it is
  written — the money is treated as gone — so adding the unsettled remainder as a debt would subtract the
  same money twice. An obligation booked against a credit card or loan account is skipped for the same
  reason: that account's own balance already carries it.
- 2026-09-17 — The account-based figure is computed first and the obligations folded on afterwards, as a
  separate step. The older number keeps its own meaning and can still be read alone, and the accounts a
  missing exchange rate could not value survive the folding instead of being quietly dropped.
- 2026-09-17 — Két sắt's badge carries a number and nothing else. It is visible on every screen in the app,
  outside the vault, before anything has been unlocked — an amount, a lender's name, or even the word thuế
  would put on display precisely what the vault exists to keep. It reuses the rail's existing badge rather
  than a new one, so the three tabs that ask for attention ask in the same voice.

## Business HUB

- 2026-09-17 — Business HUB is a separate book from the opportunity one, not a generalisation of it. An
  opportunity is a specific claim — a contact being turned into business, through stages the app understands
  and can badge an address-book row with. A HUB table is whatever its owner says it is: building sites,
  suppliers, machines under repair. Merging them would force every table to answer sales questions, and
  would put a stage word on a list of scaffolding.
- 2026-09-17 — One owner, no sharing, exactly like Tài chính cá nhân. Sharing a table is not a feature that
  can be added halfway: it opens who may rename a column under someone else's records, whose record is whose,
  and what happens to a person removed from a table they filled in. Shipping a partial answer to those would
  be worse than shipping none.
- 2026-09-17 — The first visit lands in a working table called "Bảng tổng hợp" that nobody had to create.
  Opening a new area onto an empty page with a "create your first table" button sets homework before the
  person knows what a table here even is. The default is made by the server under a per-user lock, because
  two tabs opened at once both see "no tables yet" and would otherwise both create one.
- 2026-09-17 — The shape of a table lives on the table, the values live on the records. Keeping the column
  definitions in one place means renaming a column is one write rather than a thousand; keeping the values
  on each record means adding a column touches no existing data at all. That is what makes "+ Thêm cột" safe
  to press on a table that already holds a year of work.
- 2026-09-17 — A column's key is issued by the server and never derived from its label. Labels get renamed,
  and two columns can honestly share one ("Ghi chú" twice), while the key is what every stored value points
  at. A key built from the label would turn renaming a column into silently emptying it.
- 2026-09-17 — Four column kinds, and they stay four in v1. Every extra kind is a promise about how the
  value sorts, totals and validates — cheap to add to a picker, expensive to withdraw once somebody's data
  is inside it.
- 2026-09-17 — A value of the wrong kind is refused, but a value under a key the table no longer defines is
  ignored. The first is worth interrupting someone for: a Số column holding "abc" is a column that no longer
  adds up, and the person typing it deserves to know immediately. The second is just the residue of a column
  that was removed, and failing a save over it would block an edit nobody can understand.
- 2026-09-17 — An empty cell is stored as nothing, never as an empty word or a zero. "Nobody has filled this
  in" and "this is worth 0" are different facts, and a table that confuses them reports wrong totals.
- 2026-09-17 — Trạng thái has no fixed list, unlike the opportunity stages. The suggested four are there so
  a new board has columns to drag between, but the database stores whatever word is used and the board builds
  its columns from the data — so a table about construction runs on "Đang thi công" without asking. An
  unknown status is shown exactly as typed rather than folded into "Khác", which would merge three of
  somebody's columns into one.
- 2026-09-17 — Bảng and Kanban are two ways of looking at the same records, not two places. Nothing is saved
  or lost by switching, and the board groups by status only: a board that can group by any column brings its
  own set of questions (where records with no value go, what orders the columns) and status is the grouping
  people actually reach for.
- 2026-09-17 — The empty table still draws its columns. The seven default columns ARE what a new table is
  offering, and hiding them until the first record would open the HUB on a blank page — the exact problem
  the default table was created to avoid.
- 2026-09-17 — The 1.000-record ceiling is counted in the database, and the screen only repeats it. A limit
  enforced in the interface is not a limit; it is a suggestion that any other path ignores. The count skips
  records that were put away, so "hãy dọn bớt trước khi thêm" is advice that actually works — and restoring
  one is checked against the ceiling too, since that is otherwise a way around it.
- 2026-09-17 — Only SELECT is granted on both tables; every write goes through a function. Granting INSERT
  directly would be a door around both the ceiling and the check that a record's table belongs to the same
  person, and the row policies stay underneath as the ceiling on every path regardless.
- 2026-09-17 — Ownership is checked by a trigger as well as by the functions. Row policies can only compare
  the owner column to the session, so without it someone could create a record of THEIR own pointing at
  somebody ELSE's table — the owner matches, the table id does not belong to them, and the policy sees
  nothing wrong. The same hole crm_opportunity closes the same way.
- 2026-09-17 — Editing a record sends a patch, not a list of arguments. With nullable arguments "leave the
  note alone" and "clear the note" are the same call; with a patch, a key that is present is written and a
  key that is absent is untouched. A key nobody recognises is refused outright rather than skipped, because
  silently ignoring a misspelled field lets someone believe they saved something.
- 2026-09-17 — Putting a table away leaves its records alone. Marking a thousand records and then having to
  un-mark exactly the right thousand is how things get lost; the table carries the state, and its contents
  come back with it.
- 2026-09-17 — Business Space only reads. It answers "what is asking for me across everything I keep" and
  then hands over to the table holding the answer — a place that both summarises and edits ends up a worse
  version of both. Its three windows are the same three Tài chính uses for money that is due, so the same
  shape means the same thing wherever it appears.
- 2026-09-17 — Dự án reuses the `objectives` and `deliverables` tables that already existed, rather than
  creating `project_objectives` and `project_deliverables` beside them. Both tables were already keyed to a
  conversation and already had `tasks.objective_id`/`tasks.deliverable_id` pointing at them. A parallel pair
  would have produced two Objective→Deliverable trees meaning the same thing, and left those two task
  columns dead forever. Only what was genuinely missing is new: `projects`, `objectives.project_id`, the two
  sign-off columns, and the join table.
- 2026-09-17 — A project lives INSIDE a conversation, and that is the whole permission model. The
  conversation decides who it belongs to: a journal makes it private, a 1-1 thread makes it two people's, a
  group makes it the group's. There is no project type and no project membership list — a second source for
  "who can see this" could only ever disagree with the one that actually applies. `conversation_id` is
  therefore not editable in place: moving a project between threads would silently change its readers,
  something row policies cannot see because the row is still "yours".
- 2026-09-17 — Tasks are attached through a join table, not through `tasks.deliverable_id`. The existing
  policy only allows UPDATE on a personal task, so writing that column would have worked for private work
  and silently failed for every 1-1 and group task — half the product. The join table also means taking a
  task out of a project deletes one row and leaves the task, its history and its confirmations untouched.
- 2026-09-17 — Percent complete is computed on read, never stored. A saved number needs a trigger on `tasks`
  to stay honest, and disagrees with the checklist the moment anything is linked, unlinked or reopened. A
  deliverable counts finished tasks over linked tasks, an objective averages its deliverables unweighted, and
  a project averages its objectives — invented weights would read as precision the number does not have. An
  empty deliverable reads 0%, because averaging "no tasks" as complete makes a new project look finished.
- 2026-09-17 — A confirmed deliverable reads 100% however its tasks stand. Sign-off is a person's judgement
  that the result was delivered, and it outranks the checklist that led there; otherwise an accepted
  deliverable shows as unfinished forever.
- 2026-09-17 — Anyone in the conversation may add objectives, deliverables and task links; only the person
  who opened the project may sign a deliverable off. Noticing what the work needs is what a room does
  together, but "this result was achieved" is a claim about the project, and it belongs to whoever answers
  for it. That refusal returns the code `avora_project_not_owner` rather than a sentence, so the screen can
  hide the button and explain who can press it instead of showing the same warning as every other failure.
- 2026-09-17 — Confirming twice is not an error. Two people on two machines pressing the same button is not
  an incident worth a dialog, so a second call returns the deliverable unchanged.
- 2026-09-17 — Task actions stay in the chat the task was made in. The project screen reads the work; Confirm,
  Return and Hoàn thành stay where both sides can see what was actually agreed, and each task row links back
  to that thread rather than duplicating the buttons here.
- 2026-09-17 — Projects get their own 📁 strip above a thread, separate from pinned messages. A pin says "read
  this line again"; a project says "this is what we are building". Folding them together would mean one
  collapse hides both, and neither count could be trusted to mean anything.
- 2026-09-17 — The create form requires a title and a first objective, and nothing else. A project with no
  objective is an empty name: the detail screen would open onto three blank tiers with no next step to
  suggest. The four charter questions stay folded away and all stay optional — people open a project when
  they have an intention, not a scope document.
- 2026-09-17 — A project whose conversation has not loaded yet is held back rather than guessed at. Filing it
  under the wrong heading would misstate who can read it, which is the one thing that list must never do; it
  appears as soon as the inbox answers.
- 2026-09-17 — Taking work on yourself inside a group is allowed, and it is not a suggestion. A suggestion is a
  question asked of somebody else, so naming yourself was refused outright — which left a member volunteering
  for something the group had just discussed with no way through the chat at all. They had to open a detached
  personal task that no longer remembered the message it came from. A 1-1 keeps the old rule: there is exactly
  one other person in the room, so naming yourself there is a slip rather than a choice.
- 2026-09-17 — Self-assigned work still writes a suggestion row, born already accepted. The message link and the
  context snapshot live on that row, and every reader — the chat panel, the mark on the message — already knows
  how to read it. The task itself is created by calling the ordinary acceptance path, so there is exactly one
  piece of code that turns an agreement into a task rather than a second one drifting out of step with it.
- 2026-09-17 — The rule against assigning yourself moved from a CHECK constraint to a trigger. Deciding now needs
  the conversation's type, which lives in another table and a CHECK cannot see. The guarantee was worth keeping
  rather than dropping: the RPC is the only write path today, but the table should not depend on that staying true.
- 2026-09-17 — A message that produced work is marked with one dot beside its time, and nothing else. A system
  line would put words in the room that nobody said, and a notification would tell everyone twice — once by the
  task, once by an announcement about it. A mark answers "what came of this" for whoever scrolls past, and says
  nothing at all to anybody who does not.
- 2026-09-17 — The dot is orange when any of the work is the reader's own and green when it is somebody else's,
  using the two colours the app already speaks rather than inventing a third. Their own promise is why they would
  look twice at an old message, so it wins whenever one message produced work for several people.
- 2026-09-17 — Only pending and accepted work is marked. A suggestion that was declined or withdrawn is not work
  anybody is carrying, and a dot for it would say something is happening when nothing is — so skipping or taking
  a request back removes the mark, which is the same rule the panel above the composer already follows.
- 2026-09-17 — Several pieces of work from one message stay one dot, with a count beside it. A row of dots would
  be counting rather than saying the one thing worth knowing. Pressing it opens the task when one exists and the
  pending question when it does not, because a mark that leads nowhere is worse than no mark.
- 2026-09-17 — Enter continues a list in every box where notes are written up: a task's description and the three
  long fields of a meeting note. Enter on an empty marker ends the list instead, which is how every editor people
  already know behaves — without it a list can only be escaped by deleting characters by hand. What is stored
  stays plain text: the dashes and numbers are literally what was typed, so the note reads the same everywhere it
  is quoted. This is deliberately not a rich-text editor.
- 2026-09-17 — Action items are numbered by position, and the number is display only. "Dòng 3" is how people refer
  to a row out loud while reading a note together; storing the number would mean deleting a row leaves a gap, when
  what a reader expects is for the rest to renumber.
- 2026-09-17 — Sổ quyết định opens as a centred window on a wide screen and stays a full-height sheet on a phone.
  A 448px column pinned to the right edge is the wrong shape for a meeting note — an action item carries a
  description, a person, a date and a tick, and each was wrapping onto four lines while most of the screen sat
  empty. The heading stays put while the log scrolls, so a long note never leaves the reader wondering which
  group they are in.
- 2026-09-17 — A draft saves itself a couple of seconds after the typing stops, and "Lưu nháp" stays exactly where
  it was. A meeting note is written WHILE the meeting happens: the window is open for an hour, and losing it to a
  closed laptop means losing the only record of what was agreed. The autosave never closes the editor, never
  toasts on success and never steals focus — it is happening while somebody is still typing — and it says the
  time it last saved rather than a bare "Đã lưu", because a time is a fact the person can check.
- 2026-09-17 — A note in the journal can become a task, and it becomes one outright. Everywhere else "Nhiệm vụ"
  raises a suggestion, because somebody else has to agree to carry it; a journal has nobody to ask, so the same
  button that opened a question there opened nothing at all. The dialog drops the assignee field entirely rather
  than showing it filled in and disabled — a field with one possible answer is not a question. The note travels
  with the task so "Xem trong ngữ cảnh" leads back to the line that prompted it.
- 2026-09-17 — Two people have one conversation, wherever they open it from. Reversing the 09-09 rule: a separate
  thread per group meant the same pair's words were scattered across as many places as they had rooms in common,
  and the inbox showed those places as identical rows with no way to tell them apart. What the old design was
  protecting — a private word inside a group not outliving that group — is a fact about the MESSAGE, not about
  the conversation, so it now lives there: a message knows which room it was spoken in, and deleting the room
  takes those messages and leaves the rest of the conversation whole. The server checks that claim against real
  membership; a client cannot assert that a message came from a room its sender was never in.
- 2026-09-17 — Anyone can ask the sender to take a message back, and that is all it does. Asking is not deleting:
  the words belong to whoever wrote them, so the ask arrives as a quiet line under their own bubble with two ways
  out — withdraw it, or keep it — and either answer ends the matter. It names who asked rather than counting them,
  because "ai đó phản đối" invites suspicion of everyone in the room. No limit on asking: if it becomes a way to
  badger people, that is a rule to write once there is evidence for it, not a guess to build in now.
- 2026-09-17 — A photo with no caption is a message; an empty message still is not. The rule that a message must
  say something now reads "words OR a file", and the count it checks is written by the database rather than by
  the app — a caller cannot claim an attachment it never made in order to post nothing. Because the file and the
  message have to arrive together for that rule to hold, sending them is one operation rather than two.
- 2026-09-17 — Who may do what with a file is decided on the file, before it is sent, and never widens afterwards.
  Each attachment carries one of three rungs — look at it, carry it further inside AVORA, take it out of AVORA —
  set in the composer while changing it still costs nothing. "Cho tải về" is the default, because an ordinary
  document sent to a colleague is meant to be usable and narrowing it should be the deliberate act. A file marked
  "chỉ xem" has no download button anywhere, and the app says so plainly rather than pretending the file is
  locked: a determined reader can always photograph a screen, and implying otherwise would be a promise the
  product cannot keep.
- 2026-09-17 — A file exists once, however many conversations point at it. Forwarding adds a pointer, not a copy,
  so carrying a 20MB deck into four threads costs 20MB and not 80. Access follows the pointers: you can read a
  file when some conversation you are in points at it, which is also what makes taking the message back take the
  file with it. Withdrawing a message deletes its pointers — without that, "thu hồi" would destroy the words and
  leave the photo readable, which is the opposite of what people ask for.
- 2026-09-17 — Photos are shrunk on the sender's device before they are sent. A phone camera produces six
  megabytes of something that is read at 400px wide in a chat; re-encoding puts that cost once on the person who
  chose to send it, rather than on every reader's data plan. A picture that would not get smaller is left alone,
  and an animation is never re-encoded into a still.
- 2026-09-17 — A forwarded message says where it came from, one hop back and no further. "Đã chuyển tiếp từ Minh"
  is what a reader needs to judge what they are looking at; a full chain of who passed what to whom would be a
  record of people's behaviour that nobody asked to be kept. The original author is stored beside the message
  rather than looked up through it, so the attribution survives the original being withdrawn. Files marked
  "chỉ xem" do not travel, and the copy says so in place of them — a file silently missing from a forward is
  worse than a forward that admits what it could not bring. Mentions are not carried either: naming someone in a
  room they are not in would notify nobody and read as a summons from a conversation they cannot see.
- 2026-09-17 — Picking several messages is a mode you turn on, not tick boxes that are always there. A checkbox
  on every bubble makes reading a conversation feel like auditing one. Once on, a bar floats over the thread
  rather than replacing the composer, so the conversation stays readable while choosing — which is the whole
  point of picking things out of it.
- 2026-09-17 — "Xoá" exists only in the journal, and is absent rather than greyed out everywhere else. A journal
  note is nobody else's record, so deleting it leaves nothing behind. A message in a shared thread is part of
  something two people took part in, and the honest instrument there is "Thu hồi", which leaves a visible gap
  both can see. A disabled "Xoá" in a chat would suggest the app is withholding a power it has; it does not
  have one.
- 2026-09-24 — The first open of a new calendar day starts at Avora Space, wherever the app was left. The test is
  the local date, not time away: 23:59 to 00:01 is a new morning, six hours on the same day is not. An invite link
  opened on a new day still wins — a link is an explicit intent — and a same-day return is left exactly as before.
- 2026-09-24 — Avora Space is six blocks in an order held as data (`SPACE_BLOCK_ORDER`), each saying in one line
  what it holds and what tapping does. Only Planning and Invitations hide when empty: a standing "0 lời mời" is
  permanent noise for everyone never invited. The rest say their empty state aloud, because "nothing today" is news.
  The three scope cards were folded away: the pulse strip now heads "Cần chú ý hôm nay".
- 2026-09-24 — The reminders block reads each person's own reminders, not a field on the task. On shared work each
  side sets their own nudges; a single task-level `remind_at` would have imposed one person's reminder on the other.
- 2026-09-24 — The ambient wash behind Avora Space is a state, not an animation: computed once when the screen
  opens, never refreshed, never moving. With no weather source yet, the time of day stands in for it.
- 2026-09-24 — Motion now has one source, `AVORA-Motion.tokens.json`: two durations, one easing, opacity only.
  Rhythm follows the device's reduce-motion setting (reduced → Tĩnh, short; otherwise Cân bằng, gentle) until AVORA
  has a setting of its own. Confetti and the scaling milestone card are gone: finishing work now brings one soft
  wash that fades in and out once, fired only right after a completion is confirmed. Waiting celebrations are marked
  seen without playing — an effect on opening a room would be an effect for work finished before the screen existed.
- 2026-09-24 — Projects are group work. `create_project` refuses anything but a group; existing personal and 1-1
  projects stay readable. The journal and 1-1 threads show the person's own Business HUB tables instead — tables
  belong to the person, not to a conversation, so the strip reads the same in every such thread.
- 2026-09-24 — An Event is a task with `requires_presence`, same row, same id. The calendar owns no data: it
  projects tasks, drawing an Event as a block from start to end and anything else as a marker on its deadline day.
  Invitations to take part run beside `assignee_id`, never instead of it; only the task's creator invites, only
  people already in the conversation, and nothing — the assistant included — invites anyone on its own.
- 2026-09-24 — A shared task's schedule is edited by the same two people who may reword it (creator + assignee,
  while pending or confirmed), through one RPC that re-checks that on the server. No new approval step: the
  schedule is part of what was agreed, and the people allowed to change the words are the ones allowed to change
  the when and where. Turning "Cần tôi có mặt" off clears start, end, place and travel together.
- 2026-09-24 — Lịch (Ngày / Tuần / Tháng / Năm) is a view and nothing else. It queries `tasks` for the days on
  screen only, draws finished work dimmed (a past week with its work erased would misreport it) and never draws
  skipped work. Tapping a task goes to its context; Lịch has no edit or delete. The quick-look sheet opened from a
  chat or a task panel is the same view without a way out; opened from a task form, tapping a day only fills the
  deadline field — it is never a way to create a task. It fades rather than slides, because the motion tokens allow
  opacity only.
- 2026-09-24 — A message that fails to send stays where it was written, marked "Gửi lỗi" in amber rather than red:
  nothing is lost, it just has not gone yet. Tapping it sends the same words, quote and files again from the same
  place. Failed sends live in memory beside the query cache, not in it, because the cache is refetched after every
  send and the server has never heard of this message. They survive switching threads but not a reload.
- 2026-09-24 — Trust Phase 1 (ADR-020): `messages` and `message_attachments` carry nullable `key_version` and
  `algorithm_version`, written in pairs and only by the server. Nothing is encrypted yet; null means plaintext.
- 2026-09-24 — Business HUB is Think Hub (ADR-001): tables `think_hub_table` / `think_hub_record`, nav label
  "Kế hoạch" at `/ke-hoach` (the old `/business-hub` redirects). A record is called "Hạng mục" on screen
  (ADR-022); Tài chính's income/expense categories became "Danh mục" so the two never share a word.
- 2026-09-24 — A Think Hub table has exactly one scope — personal (Diary), one 1-1 or group conversation, or one
  project — and the scope is the permission: the people who can read that place can read and add Hạng mục; only
  the table's owner renames it, reshapes columns or puts it away. Clients hold SELECT only; every write is a server
  function that re-checks scope. A Hạng mục must be written from its table's own scope (a group table cannot take a
  Diary record even from someone who can read both), and the picker lists only in-scope tables.
- 2026-09-24 — Sub-tables grow from one Hạng mục, inherit the parent's scope, and stop at depth 3 (ADR-004, ADR-006).
  A new one suggests "Theo dõi cho: [Hạng mục]" as its purpose, freely editable. Each project owns exactly one root
  table, made with the project; that root has no purpose of its own and reads the project's Kim chỉ nam / Mục tiêu.
  Every column carries an `id` issued once; renaming a column changes only its label, never where values live.
- 2026-09-24 — Objectives and deliverables are gone (ADR-005). Project structure is Hạng mục → Task only:
  `project_tasks.record_id` is nullable on purpose, so ad-hoc work raised in the project stays in its list. Tasks
  handed out from the project screen use the same two-step group handshake as chat. The single test project
  (HANA-2607, in a Diary) was deleted with its tiers, with the owner's go-ahead.
- 2026-09-24 — Project Charter: title, Kim chỉ nam (`value_orientation`), Mục tiêu (`objective`), start date and
  target end date are all required and none is pre-filled. Scope and assumptions stay optional text. Success
  criteria are their own rows, added over the project's life, each measured by % or by a finalized meeting note,
  and soft-deleted. Closing keeps the status word `done` and is allowed only when every live criterion has its
  evidence and no non-skipped task is due after the target end. Only the opener adds criteria, records results and
  closes; dates and status are not client-writable. Nothing records a result or closes on anyone's behalf.
- 2026-09-24 — Sub-groups use `conversations.parent_group_id` + `group_depth` (1–3, ADR-007); `related_group_id`
  keeps its older meaning (the group a 1-1 was opened from). Owner or admin of the parent opens one through
  `create_sub_group`, becomes its owner, and may only bring people already in the parent. Membership never flows
  down the tree (ADR-014). The group panel always shows "Tạo nhóm con"; a member sees it dimmed with the rule.
- 2026-09-24 — The Dự án tab has two sections: "Bảng của tôi" (personal and 1-1 root tables as a folded tree that
  opens into Hạng mục in place) and "Nhóm" (group projects). The always-empty Cá nhân and 1-1 sections are gone.
- 2026-09-25 — Every confirm button disables itself on the first click until the request returns (a ref closes the
  door synchronously; `isPending` alone lets a fast double click through — how "APĐ | Nhà ở" was made twice).
- 2026-09-25 — Kế hoạch: a column may carry `width` (60–800 px) and `hidden`, set only by the table's owner and
  applied to everyone reading it; ids, keys and values never change. Each Hạng mục has exactly one sub-table (a
  put-away one comes back instead of a second). "Tạo tác vụ" works on any Hạng mục: a Diary table makes a personal
  task, a 1-1 or group table a shared task waiting for confirmation, a project table a project task. Outside
  projects the link is `think_hub_record_tasks`; inside, `project_tasks.record_id`. A third view, Cây, draws the
  same Hạng mục as a folder tree with sub-tables and task counts — nothing new is stored (OPEN-008).
- 2026-09-25 — A project is its own sub-group. Opening one (Owner/Admin of the group only) creates a child group
  with every current member of the parent and the opener as owner, then files the charter there, so parallel
  projects never share a chat and each can add its own people. The one existing project was moved into a new
  sub-group; its old messages stay in the parent. Opening a project opens its chat, with a strip "Đang thảo luận
  trong Dự án" leading to the charter page.
- 2026-09-25 — Closing has two branches. With every criterion met, `done`, then one empty question for the leader's
  own thank-you (no draft, ADR-021), posted once and pinned. Stopping early, `closed_early`, needs a reason that
  only the opener can read, posts nothing, and opens a private Check-Adjust (reason, criteria met or not, unfinished
  work, one note "Lần sau điều chỉnh gì"). Either way the chat, tables, Hạng mục, tasks and criteria go read-only,
  enforced in the database; the opener can reopen at any time.
- 2026-09-25 — Only the root group's owner deletes a project, typing its exact title and a reason. A system line
  (`messages.system_kind`, server-written only, drawn centred with no bubble) records who and why, then the project
  and its sub-group are soft-deleted — the Inner tier of ADR-011. The same owner restores it from "Dự án đã xoá".
  Outer Trash and crypto-erasure wait for OPEN-001.
- 2026-09-25 — "Thêm vào Hôm nay" is per person (`task_flags.my_day_on`) and counts only on the day it was set, like
  a day-planner page; it never touches the deadline.
- 2026-09-25 — The calendar has one fixed place on every screen: a slim bar at the top right of the content. The
  chat keeps its own calendar button beside the box; attach, voice note and create-task fold into one "+". Every
  calendar view keeps the same height and scrolls inside.
- 2026-09-25 — Nav "Tin nhắn" is "Kết nối" (ADR-022). The Dự án tab carries "Đang hoàn thiện" in the same pill as
  "Sắp ra mắt". Task Hub section names are Vietnamese; Kanban reads "Theo trạng thái".
- 2026-09-25 — A Task inside a deleted group is hidden from everyone, members included. Visibility (`tasks` policy
  and `private.can_view_task`, which also gates checklist, resources, dependencies, participants and Hạng mục links)
  now asks `private.conversation_is_live`: the chat and every group above it must have no `deleted_at`. Nothing on
  the Task changes, so restoring the group brings it straight back. Personal Tasks are untouched.
- 2026-09-25 — One submission at a time also covers Tạo nhóm, creating a Task from chat and Lưu liên hệ.
- 2026-09-25 — The calendar bar became a small round bubble floating at the top right: no row of its own, beside
  the AVORA mark on a phone, in the page corner on a computer (the chat header leaves room for it). The bubble holds
  an ordered list of quick actions; with exactly one (Lịch, today) a tap opens it directly. The chooser for several
  actions and a reorder screen are not built. The peek now offers Năm as well.
- 2026-09-25 — Tasks follow the four Connect Hub layers, always in this order: Của tôi (no conversation) → 1-1
  (direct) → Nhóm (group, no project) → Dự án. A task is project work when its chat is a project's sub-group OR
  it is linked to a project through the existing project–task links — the second case keeps work agreed in the
  parent group, before the project had its own chat, under its project. No new column. "Xem trong ngữ cảnh" on
  project work opens the project's sub-group; the quoted message is only scrolled to (or reported deleted) in the
  chat it was sent in. Theo đối tượng shows the layers as sections (Dự án branches per project) with chips Tất
  cả / Của tôi / 1-1 / Nhóm / Dự án kept in the address; the other readings are unchanged. "Cần chú ý hôm nay"
  keeps its eight most pressing items, laid out under the same four headings with urgency kept inside each.

## Out of scope

Dark mode, voice or video calls (the call icon is decorative
for now), AI features, heavy project management (the lightweight Nhiệm vụ module ships, now with clocks,
categories, reminders and repeats; boards, teams and dependencies stay out), and any social feed. Task reminders
delivered outside the app — email, SMS or push to a closed tab — need a scheduled worker and a push subscription,
and are not built. Group chat is now creatable and manageable from the interface (three-way Tin nhắn tabs, roster panel with roles,
removal requests, ownership transfer, renaming, appointing and standing down the admin, invite links, leaving, and
private messages started from a group's roster — which now land in the pair's single shared conversation, tagged
with the room they were sent from). Joining through an invite link requires being signed in — a signed-out visitor is
sent to the sign-in screen and must reopen the link afterwards. Task lists and context snapshots exist in the database
with their rules enforced there, but have no screens yet; the recurring-task spawner also stays a database trigger
rather than a scheduled job. Org charts, SSO, audit logs and permission inheritance stay out. In Kế hoạch: Timeline,
Calendar, Gantt, a free radial mindmap and responsibility-matrix views, and tying a Hạng mục to a contact stay out of
v1. In Dự án: a calendar view, budgets tied to `financial_item`, editing the dates after opening, and permanent
deletion (Outer Trash, crypto-erasure) stay out until OPEN-001.
The mark on a message that produced work stays a mark: no system line in the thread, no notification and no push.
Chat attachments cover images, files and voice notes; video capture, stickers, GIFs, and editing or annotating an
image in the app stay out. A file's permission is fixed when it is sent — there is no revoking a file already
delivered, and no ask-for-an-upgrade flow. Forwarding records one hop, never a chain, and cannot start a new
conversation: the destination must already exist.
Real weather for the Avora Space wash (needs a provider), an in-app Space Rhythm setting, task Drafts (shown as
"Sắp có"), map pins from latitude/longitude, and delivering departure reminders outside the app all stay out for
now. End-to-end encryption of chat is Phase 2+: the placeholder columns exist, no key exchange or encryption does.
Auto-list in a note is Enter-continuation only — no rich text, no formatting toolbar, and nothing stored but the
characters typed.
In Tài chính: budgets and envelopes, transfers between accounts, sole-proprietor accounting,
tax fields and quarterly estimates, automatic posting of recurring entries, and automatic rate fetching (rates are
seeded and updated by hand) all stay out for now. The installed app is a wrapper over the live site, not an
offline product: no cached messages, tasks or balances, no background sync, and no push notifications. Purple gradients, glassmorphism, drop shadows, and stock
illustration are deliberately avoided.
