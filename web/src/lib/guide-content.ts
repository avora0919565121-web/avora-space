/**
 * Cài đặt › Hướng dẫn (AVORA-57 · A).
 *
 * One data file, so the Avora AI window can read the same words later. Only what runs today:
 * nothing planned, nothing "sắp có", and no promises about protection (ADR-020).
 */
export type GuideCard = {
  id: string;
  title: string;
  /** Route of the area, so a card can link there. */
  to: string;
  lines: readonly string[];
};

export const GUIDE_CARDS: readonly GuideCard[] = [
  {
    id: "space",
    title: "Avora Space",
    to: "/tong-quan",
    lines: [
      "Trang mở đầu ngày: việc hôm nay, lời nhắc và các cuộc trò chuyện đang chờ bạn.",
      "Góc suy ngẫm hiện một câu mỗi ngày. Chọn loại câu hoặc ẩn đi trong Tuỳ chọn chung.",
      "Buổi tối có Nhìn lại hôm nay; ngày trước ngày nghỉ có Nhìn lại tuần.",
    ],
  },
  {
    id: "connect",
    title: "Kết nối",
    to: "/tin-nhan",
    lines: [
      "Nhật ký là chỗ viết cho riêng bạn. 1-1, Nhóm và Dự án là nơi trò chuyện với người khác.",
      "Kết bạn bằng PIN hoặc mã QR, kèm một lời nhắn. Người nhận thấy lời mời ở đầu Kết nối và tự quyết định.",
      "Tin chỉ gửi khi bấm nút Gửi; Enter là xuống dòng.",
      "Nhấn giữ một tin để trả lời, chép, lưu vào Nhật ký hay tạo nhiệm vụ. Chọn nhiều tin để chuyển tiếp thành một đoạn hội thoại.",
      "Nhấn giữ một cuộc trò chuyện để Ghim, Xem sau, Tắt thông báo hoặc Lưu trữ.",
    ],
  },
  {
    id: "tasks",
    title: "Nhiệm vụ",
    to: "/nhiem-vu",
    lines: [
      "Bấm + Nhiệm vụ để ghi việc, đặt hạn, giờ và lời nhắc.",
      "Đánh sao cho việc quan trọng; đánh dấu cột mốc cho việc đáng mừng.",
      "Việc trong nhóm có người giao, người làm; xong thì báo, người giao xác nhận.",
      "Xem theo danh sách hoặc theo lịch.",
    ],
  },
  {
    // AVORA-107 · 1.2 · 8.
    id: "habit",
    title: "Tạo một thói quen",
    to: "/nhiem-vu?muc=thoi-quen",
    lines: [
      "Ở Nhiệm vụ, chạm Thói quen (mục đầu tiên) rồi bấm +. Chọn một gợi ý hoặc tự đặt tên.",
      "Chọn Có đồng hồ khi cần thời lượng, Chỉ đánh dấu khi chỉ cần đúng giờ. Đặt một giờ cụ thể — nhiều khung cũng được.",
      "Làm xong thì chạm vòng tròn của khung đó. Thói quen ở lại Hôm nay tới hết ngày; lỡ một hôm thì mai bắt đầu lại.",
      "Cần nghỉ một thời gian thì Tạm nghỉ; lịch sử luôn còn.",
    ],
  },
  {
    id: "plan",
    title: "Kế hoạch",
    to: "/ke-hoach",
    lines: [
      "Mỗi bảng là một việc lớn bạn đang theo dõi; mỗi dòng trong bảng là một hạng mục.",
      "Bấm + để thêm hạng mục vào bảng đang mở; giữ + để tạo bảng mới.",
      "Cùng dữ liệu xem được dạng Bảng, Theo trạng thái hoặc Cây.",
      "Bắt đầu nhanh từ một mẫu có sẵn. Bảng đã xong cất lên Kệ sách.",
    ],
  },
  {
    id: "vault",
    title: "Két sắt",
    to: "/ket-sat",
    lines: [
      "Két sắt mở bằng một mã riêng, khác mật khẩu đăng nhập.",
      "Bấm Khoá ngay khi rời máy; đăng xuất cũng khoá Két sắt.",
      "Tài chính đã dùng được: giao dịch, tài khoản và báo cáo theo loại tiền bạn chọn.",
      "Những gì trong Két sắt không hiện trong ô tìm kiếm chung.",
    ],
  },
  {
    id: "settings",
    title: "Cài đặt",
    to: "/cai-dat",
    lines: [
      "Hồ sơ: tên hiển thị và PIN AVORA để người khác tìm bạn, và Đăng xuất mọi thiết bị khác khi lỡ đăng nhập ở máy lạ.",
      "Tuỳ chọn chung: loại tiền, múi giờ, Nhìn lại, hiệu ứng khi hoàn thành và kiểu nút.",
      "Thông báo: Chế độ tập trung, tắt thông báo có hạn và âm báo.",
      "Danh sách người đã chặn cũng nằm trong Tuỳ chọn chung.",
      "Riêng tư: AVORA giữ gì và ai thấy gì — đọc ở Cài đặt › Chính sách.",
    ],
  },
];
