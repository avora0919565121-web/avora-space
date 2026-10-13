import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, test, vi } from "vitest";

/**
 * 112-A · đo những dòng chuẩn kiểm được không cần trình duyệt: lỗi vĩnh viễn của hàng chờ,
 * múi giờ quanh nửa đêm (luồng 4, 7), lời báo lỗi đăng nhập (luồng 1), giới hạn tệp (luồng 6).
 * Ghi số đo vào docs/reliability/do-112a/*.json. Chỉ đo — không sửa mã chức năng.
 */
const rpcReply: { error: { message: string; code?: string } | null } = { error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: rpcReply.error }),
  },
}));

import { attachmentRejectionReason, sendMessageWithAttachments } from "@/lib/attachments";
import { toVietnameseError } from "@/lib/auth-errors";
import { sendMessage } from "@/lib/chat";
import { isNetworkError, isPermanentSendError } from "@/lib/outbox";
import { isDeadlinePast } from "@/lib/task-schedule";
import { todayIso } from "@/lib/tasks";

const OUT = path.resolve(__dirname, "../../../docs/reliability/do-112a");
const results: Record<string, unknown> = {};

function record(name: string, data: Record<string, unknown>): void {
  results[name] = data;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), `${JSON.stringify({ measuredAt: new Date().toISOString(), ...data }, null, 2)}\n`);
}

afterAll(() => {
  expect(Object.keys(results).length).toBeGreaterThan(0);
});

/** The server codes a send can end with that will never succeed on retry (from outbox.ts' own list). */
const PERMANENT_CODES = [
  "avora_not_a_participant",
  "avora_contact_unavailable",
  "avora_not_connected",
  "avora_verification_text_only",
  "avora_verification_quota",
  "avora_project_chat_closed",
  "avora_attachment_type_blocked",
  "avora_attachment_too_large",
  "avora_attachment_total_too_large",
  "avora_video_too_long",
  "avora_attachment_too_many",
  "avora_mentions_too_many",
  "avora_reply_out_of_scope",
  "messages_content_not_blank",
  "messages_content_max_len",
  "avora_urgent_daily_limit",
  "avora_urgent_locked",
  "avora_message_id_taken",
];

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("L2.4 · lỗi vĩnh viễn có dừng ngay không (sau khi lời báo đã được dịch sang tiếng Việt)", () => {
  test("mỗi mã lỗi vĩnh viễn: hàng chờ dừng ngay hay thử lại 5 lần (~15 giây)", async () => {
    const rows: { code: string; textPath: string; textStopsAtOnce: boolean; filePath: string; fileStopsAtOnce: boolean }[] = [];
    for (const code of PERMANENT_CODES) {
      rpcReply.error = { message: code, code: "P0001" };
      const textMessage = await errorOf(() => sendMessage("c", "u", "xin chào", null, [], null, null, false, [], "00000000-0000-4000-8000-000000000001"));
      const fileMessage = await errorOf(() => sendMessageWithAttachments({ conversationId: "c", content: "", attachments: [] }));
      rows.push({
        code,
        textPath: textMessage,
        textStopsAtOnce: isPermanentSendError(textMessage),
        filePath: fileMessage,
        fileStopsAtOnce: isPermanentSendError(fileMessage),
      });
    }
    rpcReply.error = { message: "TypeError: Failed to fetch" };
    const offline = await errorOf(() => sendMessage("c", "u", "x"));
    rpcReply.error = null;
    const notStopping = rows.filter((row) => !row.textStopsAtOnce || !row.fileStopsAtOnce);
    record("L2.4b-loi-vinh-vien-sau-khi-dich", {
      threshold: "lỗi không thể khỏi khi thử lại → hiện 'Chưa gửi được' ngay",
      codes: rows.length,
      stopAtOnce: rows.length - notStopping.length,
      retriedFiveTimesFirst: notStopping.map((row) => ({ code: row.code, text: row.textStopsAtOnce ? "dừng ngay" : row.textPath, file: row.fileStopsAtOnce ? "dừng ngay" : row.filePath })),
      networkStillRecognised: isNetworkError(offline),
      note: "lib/chat.ts và lib/attachments.ts dịch mã lỗi trước khi hàng chờ (outbox.ts · isPermanentSendError) đọc; câu tiếng Việt nào không chứa từ khoá trong danh sách thì bị coi là lỗi tạm, thử lại 5 lần (1+2+4+8 s) rồi mới báo.",
    });
    expect(rows.length).toBe(PERMANENT_CODES.length);
  });
});

/** Runs `measure` with the process clock in `zone` (Node re-reads TZ on change). */
function inZone<T>(zone: string, measure: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return measure();
  } finally {
    process.env.TZ = previous;
  }
}

describe("L4.3 · L7.4 · ngày và hạn chót quanh nửa đêm theo giờ Việt Nam", () => {
  test("23:30 · 23:59:59 · 00:00:30 · 00:30 (giờ VN) — máy đặt giờ VN, và máy đặt UTC trong khi hồ sơ là giờ VN", () => {
    // 13/10 23:30 VN = 13/10 16:30 UTC.
    const instants = [
      { label: "13/10 23:30 VN", at: "2026-10-13T16:30:00Z", vnDay: "2026-10-13", dueTodayPast: false, dueYesterdayPast: true },
      { label: "13/10 23:59:59 VN", at: "2026-10-13T16:59:59Z", vnDay: "2026-10-13", dueTodayPast: false, dueYesterdayPast: true },
      { label: "14/10 00:00:30 VN", at: "2026-10-13T17:00:30Z", vnDay: "2026-10-14", dueTodayPast: true, dueYesterdayPast: true },
      { label: "14/10 00:30 VN", at: "2026-10-13T17:30:00Z", vnDay: "2026-10-14", dueTodayPast: true, dueYesterdayPast: true },
    ];
    const check = (zone: string) =>
      inZone(zone, () =>
        instants.map((instant) => {
          const now = new Date(instant.at);
          const today = todayIso(now);
          // A task due 13/10 with no clock time: due at the end of 13/10 (VN).
          const due13Past = isDeadlinePast("2026-10-13", null, now);
          return {
            instant: instant.label,
            todayIso: today,
            todayCorrect: today === instant.vnDay,
            dueOn13Past: due13Past,
            dueOn13Correct: due13Past === (instant.vnDay !== "2026-10-13"),
          };
        }),
      );
    const deviceInVietnam = check("Asia/Ho_Chi_Minh");
    const deviceInUtc = check("UTC");
    record("L4.3-nua-dem-mui-gio", {
      threshold: "0 lỗi lệch ngày ở 23:30–00:30 (Asia/Saigon)",
      deviceInVietnam,
      deviceInVietnamErrors: deviceInVietnam.filter((row) => !row.todayCorrect || !row.dueOn13Correct).length,
      deviceInUtcWhileProfileIsVietnam: deviceInUtc,
      deviceInUtcErrors: deviceInUtc.filter((row) => !row.todayCorrect || !row.dueOn13Correct).length,
      note: "todayIso() và deadlineInstant() dùng giờ của máy, không dùng múi giờ trong hồ sơ (settings.timezone) hay deadline_tz của việc.",
    });
    expect(deviceInVietnam.length).toBe(4);
  });
});

describe("L1.4 · lời báo lỗi đăng nhập nói nguyên nhân và bước kế tiếp", () => {
  test("sai mật khẩu · mã hết hạn · mất mạng · email chưa xác nhận · quá nhiều lần", () => {
    const cases = [
      { case: "sai mật khẩu", message: "Invalid login credentials" },
      { case: "mã OTP hết hạn", message: "Token has expired or is invalid" },
      { case: "mất mạng", message: "Failed to fetch" },
      { case: "email chưa xác nhận", message: "Email not confirmed" },
      { case: "quá nhiều lần", message: "For security purposes, you can only request this after 47 seconds." },
      { case: "lỗi lạ", message: "Database error saving new user" },
    ];
    const rows = cases.map((entry) => {
      const text = toVietnameseError(entry.message);
      return { ...entry, shown: text, isVietnamese: /[ăâđêôơưàáảãạ]/i.test(text), notRawEnglish: text !== entry.message };
    });
    record("L1.4-loi-dang-nhap", {
      threshold: "100% trường hợp lỗi có câu rõ ràng (nguyên nhân + bước kế tiếp)",
      rows,
      note: "Bảng ghi đúng câu người dùng thấy; đánh giá 'có bước kế tiếp' làm bằng mắt trong bảng đo.",
    });
    expect(rows.length).toBe(cases.length);
  });
});

describe("L6.2 · vượt giới hạn dung lượng / loại tệp: báo trước khi tải lên", () => {
  test("30 MB pdf · ảnh 30 MB · tệp .exe · tệp .html · tệp rỗng", () => {
    const rows = [
      { file: "tai-lieu.pdf (30 MB)", size: 30 * 1024 * 1024, type: "application/pdf" },
      { file: "anh.jpg (30 MB, sẽ nén)", size: 30 * 1024 * 1024, type: "image/jpeg" },
      { file: "cai-dat.exe", size: 2048, type: "application/x-msdownload" },
      { file: "trang.html", size: 2048, type: "text/html" },
      { file: "rong.txt", size: 0, type: "text/plain" },
    ].map((entry) => ({ ...entry, refusedBeforeUpload: attachmentRejectionReason(entry) }));
    record("L6.2-gioi-han-truoc-khi-tai", {
      threshold: "100% báo rõ trước khi tải lên",
      rows,
      note: "Loại tệp bị chặn (.exe, .html…) chỉ bị kho từ chối khi tải lên (chính sách storage + private.attachment_blocked): người gửi thấy bong bóng 'Chưa gửi được' sau khi thử, không phải trước.",
    });
    expect(rows.length).toBe(5);
  });
});
