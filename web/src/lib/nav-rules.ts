import { ChevronLeft, Hand, Home, LayoutGrid, Undo2, X } from "lucide-react";

/** AVORA-94B · mục 0 / AVORA-100 · C (ADR-062 bản sửa): the rules, said once, the same words everywhere. Chạm là một bước, giữ là đi xa. */
export const NAV_RULES: readonly { icon: typeof ChevronLeft; title: string; line: string }[] = [
  { icon: ChevronLeft, title: "Chạm ‹: lùi một bước", line: "Về đúng chỗ vừa đến, kể cả ngoài tab — tên chỗ đó ghi ngay cạnh ‹. Nút lùi của máy và vuốt từ mép trái cũng vậy." },
  { icon: Undo2, title: "Giữ ‹: về đầu tab", line: "Đang ở Nhật ký thì về Kết nối › 1-1. Chuỗi lùi bên trong tab được bỏ; ở đầu tab có lại thanh tab và logo A." },
  { icon: Home, title: "Về nhà: chạm A", line: "Chạm logo A về Avora Space. Chạm lần nữa: quay lại đúng chỗ vừa rời." },
  { icon: Hand, title: "Giữ A: xem toàn bộ AVORA", line: "Giữ logo A để mở Avora Space và cả 5 tab trên một tấm." },
  { icon: LayoutGrid, title: "Đổi khu: thanh dưới", line: "Chạm một tab về chỗ đang dở. Chạm lại tab đang đứng về đầu tab." },
  { icon: X, title: "Đóng: ✕ hoặc lùi", line: "Tấm, lớp phủ, ảnh phóng to đóng trước, màn bên dưới giữ nguyên." },
];
