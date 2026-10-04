/**
 * AVORA-66 (ADR-040) — Cài đặt › Chính sách and the public `/chinh-sach`: one source of words.
 * Every `done` item names its evidence (file / migration); `evidence` is internal and never shown.
 * An item without evidence is `soon`. Words copied as written; nothing promised beyond what runs.
 */
export type PolicyStatus = "done" | "soon";
export type PolicyItem = { id: string; text: string; status?: PolicyStatus; evidence?: string };
export type PolicySection = { id: string; title: string; items: PolicyItem[]; readyNote?: string; technical?: string[]; table?: { head: string[]; rows: string[][] } };
export type PolicyDoc = { id: string; title: string; sections: PolicySection[] };

export const POLICY_VERSION = "2026-10-02";
export const POLICY_DRAFT_NOTE = "Bản thử nghiệm — đang được luật sư rà soát.";
/** VMT fills these (F, I); a dash until then. */
export const POLICY_CONTACT = "—";

const M67 = "supabase/migrations/20261003090000_avora67_devices.sql";
const M68 = "supabase/migrations/20261003100000_avora68_vault_e2ee.sql";

export const PRIVACY: PolicyDoc = {
  id: "bao-mat",
  title: "Bảo mật & riêng tư",
  sections: [
    {
      id: "tom-tat",
      title: "Tóm tắt 30 giây",
      items: [
        { id: "own", text: "Dữ liệu của bạn là của bạn. AVORA không quảng cáo, không bán và không chia sẻ dữ liệu của bạn để kiếm tiền.", status: "done", evidence: "V5: no ad / analytics domains in web/src or supabase/functions" },
        { id: "scope", text: "Mỗi thứ chỉ người liên quan thấy. Nhật ký, việc riêng và Két sắt chỉ mình bạn. Tin 1-1 và Nhóm chỉ người trong cuộc.", status: "done", evidence: "RLS on 83/83 public tables (private.session_guard_gaps = 0)" },
        { id: "honest", text: "Nói thật về mức bảo vệ hiện tại: tin nhắn, nhiệm vụ, kế hoạch chưa được mã hoá đầu-cuối. Người quản trị máy chủ về kỹ thuật vẫn có thể truy cập phần dữ liệu đó. AVORA cam kết không mở xem nội dung của bạn, trừ khi bạn nhờ hỗ trợ và đồng ý, hoặc pháp luật bắt buộc.", status: "done", evidence: "ADR-020" },
        { id: "vault-e2ee", text: "Giấy tờ trong Két sắt được mã hoá ngay trên máy bạn. AVORA chỉ giữ bản đã khoá.", status: "done", evidence: `web/src/lib/vault-crypto.ts · ${M68}` },
        { id: "msg-e2ee", text: "Mã hoá đầu-cuối cho tin nhắn — ngay cả đội ngũ AVORA cũng không đọc được.", status: "soon" },
        { id: "choose", text: "Bạn chọn dùng phần nào. Mỗi khu vực dùng độc lập. Chưa cần thì cứ để đó." },
        { id: "both", text: "An toàn cần cả hai phía. Mật khẩu, thiết bị đã đăng nhập và người bạn mời vào cuộc trò chuyện nằm trong tay bạn." },
      ],
    },
    {
      id: "tai-khoan",
      title: "A. Tài khoản, đăng nhập & thiết bị",
      items: [
        { id: "mask", text: "Email và số điện thoại trong Cài đặt chỉ hiện một phần đầu và cuối.", status: "done", evidence: "web/src/lib/mask.ts" },
        { id: "guest", text: "Đăng nhập trên máy của người khác: chọn `Đây là máy của người khác` — phiên chỉ trong thẻ trình duyệt đó, không nhớ email.", status: "done", evidence: "web/src/lib/guest-machine.ts" },
        { id: "otp", text: "Đăng nhập bằng mã 6 số gửi qua email.", status: "done", evidence: "web/src/pages/Auth.tsx (otp mode)" },
        // V7: OTP length 6 / expiry 600 s confirmed by VMT in the Auth dashboard (01/10 19:16).
        { id: "otp-expiry", text: "Mã đăng nhập hết hạn sau 10 phút.", status: "done", evidence: "xác nhận cấu hình Auth 01/10 (6 số · 600 giây)" },
        { id: "signout", text: "`Đăng xuất mọi thiết bị khác`, kèm email báo cho bạn.", status: "done", evidence: "public.security_signout_notice · vault-mail alarm signout" },
        { id: "ranks", text: "Hai máy chính: điện thoại (Ưu tiên 1) và máy tính (Ưu tiên 2). Máy chính ngắt được các máy khác.", status: "done", evidence: `${M67} (revoke_device, set_device_rank)` },
        { id: "lock", text: "`Khoá thiết bị`: khi nghi ngờ, chặn mọi lần đăng nhập mới cho tới khi bạn tắt.", status: "done", evidence: `${M67} (set_device_lock, session_allowed)` },
        { id: "lost", text: "Báo mất thiết bị: máy bị báo mất ngừng dùng ngay; bạn xác nhận qua email.", status: "done", evidence: `${M67} (report_device_lost) · supabase/functions/device-action` },
        { id: "pin", text: "Mã PIN là tên định danh, không phải mật khẩu. Người lạ chỉ tìm thấy bạn khi biết PIN.", status: "done", evidence: "ADR-019 · public.start_pin_connection" },
        { id: "pin-retired", text: "PIN của tài khoản đã xoá không bao giờ cấp lại cho người khác.", status: "done", evidence: `${M67} (retired_pins, check_user_pin)` },
        // Turnstile is wired but VITE_TURNSTILE_SITE_KEY is not set: soon until it is on.
        { id: "bot", text: "Chặn đăng ký tự động bằng máy.", status: "soon" },
      ],
      technical: [
        "Đăng nhập do Supabase Auth xử lý. Mật khẩu được băm; AVORA không lưu mật khẩu dạng đọc được.",
        "Mã đăng nhập 6 số hết hạn sau 10 phút, gửi qua Resend.",
        "Mọi kết nối qua HTTPS. Máy chủ lấy danh tính từ mã phiên (JWT), không tin danh tính do máy gửi lên.",
        "Mỗi trình duyệt có một khoá thiết bị riêng không xuất ra được; máy phải ký chuỗi thử thách của máy chủ để chứng minh đúng máy.",
      ],
    },
    {
      id: "ket-noi",
      title: "B. Kết nối — Nhật ký, 1-1, Nhóm, Dự án",
      items: [
        { id: "journal", text: "Nhật ký chỉ mình bạn đọc.", status: "done", evidence: "conversations type=personal · RLS" },
        { id: "rooms", text: "Tin 1-1 và Nhóm chỉ người trong cuộc đọc. Chủ Nhóm cũng không đọc được tin riêng 1-1 giữa hai thành viên.", status: "done", evidence: "private.is_conversation_participant in messages RLS" },
        { id: "friends", text: "Chỉ nhắn riêng khi hai người đã là bạn. Kết bạn cần cả hai đồng ý, có lời nhắn giới thiệu. Khung làm quen chỉ gửi chữ, giới hạn số tin và thời gian.", status: "done", evidence: "ADR-029 · private.assert_direct_talk" },
        { id: "read", text: "Không ai biết bạn đã đọc tin của họ hay chưa.", status: "done", evidence: "ADR-028" },
        { id: "members", text: "Danh sách thành viên Nhóm không hiện email. Link mời vào Nhóm hết hạn sau 7 ngày.", status: "done", evidence: "AVORA-60 · C · group invites expires_at" },
        { id: "block", text: "Chặn và Báo cáo người dùng.", status: "done", evidence: "AVORA-37 · public.list_my_blocks" },
        { id: "forward", text: "Chuyển tiếp tôn trọng quyền của tệp (chỉ xem / được chuyển tiếp / được tải về) và ghi rõ nguồn.", status: "done", evidence: "web/src/lib/forwarding.ts" },
        { id: "push", text: "Thông báo trên điện thoại mặc định chỉ hiện tên người gửi, không hiện nội dung.", status: "done", evidence: "V2: profiles.push_show_content default false · push_claim_batch" },
        { id: "shared", text: "Tài sản chung (Bảng chung, Nhóm, Dự án) không ai xoá một mình được — chỉ đề nghị xoá.", status: "done", evidence: "ADR-031 · public.propose_shared_action" },
        { id: "e2ee-rooms", text: "Mã hoá đầu-cuối cho 1-1 và Nhóm.", status: "soon" },
      ],
      readyNote: "Bạn có thể chưa kết bạn với ai. Nhật ký, Ghi chép, Nhiệm vụ, Kế hoạch và Két sắt vẫn dùng đầy đủ một mình.",
      technical: [
        "Quyền đọc kiểm ở tầng cơ sở dữ liệu (Row Level Security): mỗi truy vấn chỉ trả về dòng tài khoản đó được phép thấy.",
        "Tin thời gian thực đi qua cùng lớp quyền đó. Mốc \"đã đọc tới đâu\" lưu riêng từng người.",
        "Hàm máy chủ chạy quyền cao (SECURITY DEFINER) tự kiểm người gọi và cố định `search_path`.",
        "Cuộc gọi đi qua Jitsi (meet.jit.si).",
      ],
    },
    {
      id: "nhiem-vu",
      title: "C. Nhiệm vụ & Kế hoạch",
      items: [
        { id: "tasks", text: "Việc riêng chỉ mình bạn thấy. Việc chung chỉ người liên quan thấy.", status: "done", evidence: "tasks RLS" },
        { id: "own-parts", text: "Giờ nhắc, thời gian đi lại, các bước của việc được giao chỉ người nhận thấy.", status: "done", evidence: "ADR-030" },
        { id: "boards", text: "Bảng của tôi chỉ mình bạn. Bảng chung chỉ thành viên của cuộc đó. Dấu ★ riêng từng người.", status: "done", evidence: "private.think_hub_table_visible" },
        { id: "contact-cell", text: "Ô Liên hệ trong Bảng chung chỉ hiện tên, không hiện số hay email.", status: "done", evidence: "supabase/migrations/20261002100000_board_contact_labels.sql" },
        { id: "offline", text: "Dùng được khi không có mạng; dữ liệu cá nhân lưu ngay trên máy bạn.", status: "soon" },
      ],
      readyNote: "Kế hoạch là tuỳ chọn. Không dùng thì Nhiệm vụ vẫn chạy bình thường.",
    },
    {
      id: "ket-sat",
      title: "D. Két sắt",
      items: [
        { id: "only-you", text: "Chỉ mình bạn thấy. Người trò chuyện 1-1 hay trong Nhóm đều không xem được.", status: "done", evidence: "finance RLS user_id = auth.uid()" },
        { id: "no-bank", text: "AVORA không kết nối với ngân hàng, không chuyển tiền, không cần mật khẩu hay mã OTP ngân hàng.", status: "done", evidence: "V5: no bank API domains" },
        { id: "code", text: "Khoá bằng mã 6 số; tự khoá sau 5 phút; sai 5 lần phải chờ; báo mọi thiết bị khi mã đổi.", status: "done", evidence: "ADR-034 · private.vault_register_failure" },
        { id: "no-search", text: "Không xuất hiện trong tìm kiếm chung.", status: "done", evidence: "ADR-032" },
        { id: "papers", text: "Chứng chỉ, Tài liệu, Tài sản được mã hoá ngay trên máy bạn, bằng chìa chỉ bạn giữ (Mật khẩu Két sắt + Bộ khôi phục). AVORA chỉ lưu bản đã khoá.", status: "done", evidence: `web/src/lib/vault-crypto.ts · ${M68}` },
        { id: "no-recover", text: "Quên cả Mật khẩu Két sắt lẫn Bộ khôi phục thì không ai mở lại được phần đã mã hoá, kể cả AVORA." },
        { id: "passwords", text: "Mật khẩu (ngăn riêng, thêm mã ngăn).", status: "soon" },
        { id: "finance", text: "Tài chính: mã hoá mô tả, ghi chú, tên người, ảnh hoá đơn. Số tiền và ngày tháng hiện vẫn để máy chủ tính báo cáo và nhắc hạn.", status: "soon" },
        { id: "ocr", text: "Đọc chữ trên giấy tờ ngay trên máy, không gửi ảnh cho ai đọc hộ.", status: "soon" },
      ],
      readyNote: "Bạn có thể chưa dùng Két sắt. Các phần khác vẫn chạy bình thường.",
      technical: [
        "Mã hoá đầu-cuối AES-256-GCM qua WebCrypto. Khoá chính sinh trên máy, được bọc bằng Mật khẩu Két sắt (Argon2id) và Bộ khôi phục 24 từ. Máy chủ chỉ lưu bản đã bọc.",
        "Mã 6 số mở nhanh dùng kèm khoá riêng của từng máy, nên lấy được bản sao dữ liệu máy chủ cũng không thử mã được.",
        "Khoản Vay / Cho vay: chỉ hai bên liên quan thấy. Mã Két sắt băm bcrypt; trạng thái mở khoá kiểm ở máy chủ trong từng hàm Két sắt.",
      ],
    },
    {
      id: "ai",
      title: "E. Trợ lý AI",
      items: [
        { id: "none", text: "Hiện chưa có trợ lý AI nào đọc dữ liệu của bạn.", status: "done", evidence: "V3: no model API calls in web/src or supabase/functions" },
        { id: "scope", text: "Khi có, AI riêng của bạn chỉ vào khu vực bạn cho phép; mặc định không vào Két sắt; không tự vào cuộc trò chuyện; người chưa đăng nhập không được AI đọc dữ liệu của ai.", status: "soon" },
        { id: "data", text: "Mọi thứ AI đọc được là dữ liệu, không phải lệnh.", status: "soon" },
      ],
    },
    {
      id: "du-lieu",
      title: "F. Dữ liệu của bạn",
      items: [
        { id: "where", text: "Lưu trên máy chủ Supabase.", status: "done", evidence: "V6: project myrubjdysllgucgafqjy (region: VMT confirms)" },
        { id: "trash", text: "Xoá → vào Thùng rác, khôi phục được.", status: "done", evidence: "deleted_at + restore RPCs" },
        { id: "logs", text: "Nhật ký hệ thống không ghi nội dung tin, số tiền, email, PIN hay mã phiên.", status: "done", evidence: "web/src/lib/log.ts" },
        { id: "export", text: "Xuất báo cáo tài chính ra CSV / Excel.", status: "done", evidence: "V4: web/src/lib/finance-export.ts" },
        { id: "later", text: "Xuất toàn bộ dữ liệu; tự xoá tài khoản trong Cài đặt; xoá vĩnh viễn thật; lưu trên máy bạn hoặc cloud bạn chọn; tài khoản 2 năm không đăng nhập → nhắc 3 tháng rồi mới xoá.", status: "soon" },
        { id: "ask", text: `Hiện muốn xoá tài khoản hoặc lấy dữ liệu: gửi yêu cầu tới ${POLICY_CONTACT}.` },
      ],
    },
    {
      id: "ben-thu-ba",
      title: "G. Bên thứ ba",
      items: [{ id: "no-ads", text: "Không quảng cáo, không công cụ theo dõi hay phân tích quảng cáo.", status: "done", evidence: "V5" }],
      table: {
        head: ["Dịch vụ", "Làm gì", "Thấy gì"],
        rows: [
          ["Supabase", "Cơ sở dữ liệu, đăng nhập, lưu tệp", "Dữ liệu lưu trên máy chủ (giấy tờ Két sắt: chỉ bản đã khoá)"],
          ["Resend", "Gửi email", "Địa chỉ email, nội dung email hệ thống"],
          ["Rork", "Lưu trữ và phục vụ ứng dụng web", "Truy cập trang"],
          ["Jitsi", "Cuộc gọi", "Âm thanh / hình ảnh trong cuộc gọi"],
          ["Cloudflare Turnstile", "Chặn đăng ký tự động (nếu đang bật)", "Tín hiệu trình duyệt lúc đăng ký"],
          ["Dịch vụ thông báo của trình duyệt / điện thoại", "Đẩy thông báo", "Tên người gửi (không nội dung)"],
        ],
      },
    },
    {
      id: "cua-ban",
      title: "H. Phần của bạn",
      items: [
        { id: "intro", text: "Thông tin này chỉ mình bạn biết — nhưng bạn cũng cần tự giữ: mật khẩu, thiết bị đăng nhập, Bộ khôi phục Két sắt, và những ai bạn mời vào cuộc trò chuyện." },
        { id: "guest", text: "Dùng máy người khác → `Đây là máy của người khác`, xong thì đăng xuất." },
        { id: "lock", text: "Nghi có người lạ → `Khoá thiết bị`. Mất máy → `Tôi mất thiết bị này` từ máy còn lại." },
        { id: "kit", text: "In Bộ khôi phục, cất ngoài điện thoại." },
        { id: "share", text: "Hai người dùng chung một tài khoản là cho nhau toàn quyền." },
      ],
    },
    {
      id: "lien-he",
      title: "I. Liên hệ",
      items: [
        { id: "contact", text: `Câu hỏi, yêu cầu về dữ liệu, báo lỗ hổng bảo mật: ${POLICY_CONTACT}.` },
        { id: "law", text: "Khi cơ quan có thẩm quyền yêu cầu dữ liệu theo pháp luật, AVORA chỉ cung cấp đúng phần bắt buộc và báo cho bạn nếu pháp luật cho phép. Giấy tờ đã mã hoá trong Két sắt thì AVORA không có chìa để mở." },
      ],
    },
  ],
};

export const TERMS: PolicyDoc = {
  id: "dieu-khoan",
  title: "Điều khoản sử dụng — giai đoạn thử nghiệm",
  sections: [
    {
      id: "dieu-khoan-chung",
      title: "Điều khoản",
      items: [
        { id: "beta", text: "AVORA đang thử nghiệm với nhóm người dùng đầu tiên. Có thể còn lỗi; tính năng có thể đổi." },
        { id: "notice", text: "Thay đổi ảnh hưởng tới dữ liệu của bạn sẽ được báo trước trong ứng dụng." },
        { id: "free", text: "AVORA miễn phí. Ủng hộ là tự nguyện, không mở khoá tính năng." },
        { id: "content", text: "Bạn chịu trách nhiệm với nội dung mình đăng và người mình mời." },
        { id: "suspend", text: "AVORA có thể tạm khoá tài khoản vi phạm Quy tắc cộng đồng, và sẽ báo lý do." },
        { id: "law", text: "Luật áp dụng, giới hạn trách nhiệm, giải quyết tranh chấp: đang chờ luật sư." },
      ],
    },
  ],
};

export const COMMUNITY: PolicyDoc = {
  id: "cong-dong",
  title: "Quy tắc cộng đồng",
  sections: [
    {
      id: "quy-tac",
      title: "Quy tắc",
      items: [
        { id: "respect", text: "Tôn trọng người khác. Không quấy rối, đe doạ, lừa đảo hay mạo danh." },
        { id: "legal", text: "Không gửi nội dung vi phạm pháp luật." },
        { id: "block", text: "Gặp người làm phiền: `Chặn` ngay; cần thì `Báo cáo`." },
        { id: "shared", text: "Tài sản chung là của mọi người: đề nghị và trao đổi, không quyết một mình." },
      ],
    },
  ],
};

export const HISTORY: PolicyDoc = {
  id: "lich-su",
  title: "Lịch sử thay đổi",
  sections: [{ id: "phien-ban", title: "Phiên bản", items: [{ id: POLICY_VERSION, text: `${POLICY_VERSION} — Bản đầu tiên.` }] }],
};

export const POLICY_DOCS: readonly PolicyDoc[] = [PRIVACY, TERMS, COMMUNITY, HISTORY];

/** The three calm lines Két sắt shows the first time, read from the policy (66 · 2.1 · 4). */
export const VAULT_REASSURANCE: readonly string[] = ["only-you", "no-bank", "papers"].map(
  (id) => PRIVACY.sections.find((s) => s.id === "ket-sat")?.items.find((i) => i.id === id)?.text ?? "",
);

/** AVORA-93 · 3.3: the phone chip drops the long tail (`Điều khoản sử dụng — giai đoạn thử nghiệm` → `Điều khoản`). */
export function policyShortTitle(title: string): string {
  if (title.startsWith("Điều khoản")) return "Điều khoản";
  return title.split(" — ")[0];
}
