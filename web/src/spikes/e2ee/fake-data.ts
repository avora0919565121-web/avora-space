/** AVORA-E0 — made-up messages (never real ones): Vietnamese with marks, some emoji, ~120 characters. */
const WORDS = (
  "có phải hôm nay mình gặp nhau ở quán cà phê đường Nguyễn Huệ không anh chị em ơi nhớ mang tài liệu " +
  "báo giá hợp đồng tuần sau được không cảm ơn nhiều lắm mai họp lúc mấy giờ con đi học về chưa mẹ nấu " +
  "cơm rồi đó đừng quên uống thuốc nha trời mưa to quá kẹt xe hết đường về nhà chuyển khoản xong rồi nhé " +
  "đường đi Đà Lạt đẹp lắm chụp ảnh gửi cho mình với dự án chiếu sáng khách hàng đồng ý phương án hai"
).split(" ");
const EMOJI = ["😀", "🙏", "❤️", "👍", "🎉", "☕", "🌧️", "📎"];

/** A small deterministic PRNG so every device measures the same text. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeMessages(count: number, seed = 42): string[] {
  const rand = prng(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = 70 + Math.floor(rand() * 100);
    let text = "";
    while (text.length < target) {
      text += (text === "" ? "" : " ") + WORDS[Math.floor(rand() * WORDS.length)];
      if (rand() < 0.06) text += " " + EMOJI[Math.floor(rand() * EMOJI.length)];
    }
    out.push(text);
  }
  return out;
}

export const SAMPLE_QUERIES: readonly string[] = [
  "có phải", "co phai", "đường", "duong", "cà phê", "ca phe", "hợp đồng", "hop dong", "Đà Lạt", "da lat",
  "báo giá", "bao gia", "chuyển khoản", "chuyen", "mưa to", "mua", "dự án chiếu", "du an", "🙏", "☕",
];
