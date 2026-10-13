/**
 * 112-A · 7 — real-life long data for layout tests. Đợt 2F checked overflow with empty screens;
 * people have very long names, write long unbroken words, paste links, and write in many scripts.
 * Every list here is meant to be reused by any test that renders people, messages or tasks.
 */

/** Names as they really come in contact books and accounts (VN-first, then the rest of the world). */
export const LONG_NAMES: readonly string[] = [
  "Nguyễn Thị Phương Thảo Hoàng Ngọc Bảo Trâm",
  "Tôn Nữ Thị Hoàng Oanh (Phòng Kế toán – Chi nhánh Bình Dương)",
  "Công ty TNHH Thương mại Dịch vụ Xuất Nhập Khẩu Đại Phát Thịnh Vượng",
  "Trần Đình Trọng",
  "Lê Đạt",
  "Ngô Nhật Thiên",
  "Phạm Hồng Phượng 🌸🌸🌸",
  "Hoàng Anh Tuấn — Anh Tuấn Xây Dựng — 0912 345 678",
  "Bartholomew Alexander Montgomery-Fitzgerald III",
  "María José Carolina de los Ángeles Fernández-Villaverde",
  "王小明（上海分公司·市场部）",
  "محمد بن عبد الرحمن آل سعود",
  "สมชาย ใจดีมากมาย ประเสริฐวงศ์",
  "Владимир Александрович Константинопольский",
  "김민지 (Kim Min-ji) 마케팅팀",
  "Supercalifragilisticexpialidociousandthensomemorewithoutanyspaces",
];

/** Message bodies: long paragraphs, unbroken tokens, links, mixed scripts, emoji runs. */
export const LONG_MESSAGES: readonly string[] = [
  "Anh ơi, em gửi lại toàn bộ danh sách vật tư cho công trình sảnh chính: xi măng PCB40 120 bao, cát vàng 18 khối, đá 1x2 22 khối, thép Hoà Phát D10–D22 tổng 3,8 tấn, gạch ống 4 lỗ 12.000 viên, keo dán gạch 40 bao. Anh xem giúp em trước 17:00 hôm nay để kịp đặt xe sáng mai nhé, cảm ơn anh nhiều ạ!",
  "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-very-long-shared-link?usp=sharing&resourcekey=0-abcdefghijklmnop",
  "Mãsốthuế0312345678901234567890KhôngCóKhoảngTrắngNàoCảĐểXemCóTrànKhông",
  "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶",
  "会议改到明天下午三点，请大家准时参加。مرحبا بالجميع، الاجتماع غداً. Xin chào mọi người!",
];

/** Task and project titles. */
export const LONG_TITLES: readonly string[] = [
  "Hoàn thiện hồ sơ thanh toán đợt 3 cho hạng mục chống thấm tầng hầm B2 và gửi chủ đầu tư ký duyệt",
  "Gọi lại cho chị Thảo",
  "Kiểm tra lại toàn bộ bản vẽ shopdrawing kết cấu thép mái sảnh — bản sửa đổi lần thứ 7 (R7) theo góp ý TVGS",
  "Đặt vé máy bay Hà Nội – TP.HCM – Đà Nẵng – Hà Nội cho đoàn 14 người dự hội nghị khách hàng thường niên",
];

/** Many items: a list of `count` rows built from the long sets, deterministic. */
export function manyNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${LONG_NAMES[index % LONG_NAMES.length]} ${index + 1}`);
}
