/**
 * Daily Thought — one line a day on Avora Space, chosen for the reader and then left alone.
 *
 * Three rules shape this file:
 *
 * 1. The text is a fixed, hand-checked list. Nothing is generated, paraphrased or fetched.
 *    A verse the app invented would be worse than no verse at all, so the only lines that can
 *    ever appear are the ones written below, word for word.
 * 2. The choice is stable for a whole day and rotates through the entire list before any line
 *    comes back. A plain `random % length` would repeat some lines twice in a week and skip
 *    others for a month, so the day number walks the list by a fixed coprime stride instead
 *    (see `dailyStride`).
 * 3. The scripture reference is data, not interface. It is kept so the wording can be checked
 *    against its source, and `dailyThoughtView` — the only thing the screen reads — has no field
 *    to put it in. That makes "no book, chapter or verse on screen" a property of the shape,
 *    not a promise someone has to remember.
 */

/** What a person chose to see: scripture, a maxim, or nothing. */
export type DailyThoughtCategory = "kinh_thanh" | "danh_ngon" | "khong_chon";

export const DEFAULT_DAILY_THOUGHT_CATEGORY: DailyThoughtCategory = "khong_chon";

/** The three choices, in the order the settings screen offers them. */
export const DAILY_THOUGHT_OPTIONS: readonly { value: DailyThoughtCategory; label: string }[] = [
  { value: "khong_chon", label: "Không chọn" },
  { value: "kinh_thanh", label: "Kinh Thánh" },
  { value: "danh_ngon", label: "Danh ngôn" },
] as const;

export function isDailyThoughtCategory(value: string): value is DailyThoughtCategory {
  return value === "kinh_thanh" || value === "danh_ngon" || value === "khong_chon";
}

export type DailyThought = {
  /** The line shown on screen, exactly as written. */
  text: string;
  /** Who said it. Scripture carries a speaker; maxims are shown with no name at all. */
  speaker: string | null;
  /** Internal grouping, for keeping the lists balanced. Not shown. */
  theme: string;
  /** Book, chapter and verse. For checking the wording against its source. Never shown. */
  ref: string | null;
};

/** The 30 scripture lines, as given. */
export const KINH_THANH: readonly DailyThought[] = [
  {
    text: "Yêu Đức Chúa Trời hết lòng, hết linh hồn, hết trí khôn — và yêu người lân cận như chính mình.",
    speaker: "Chúa Giê-xu",
    theme: "Tình yêu",
    ref: "Matthew 22:37–39",
  },
  {
    text: "Các con hãy yêu thương nhau, như Ta đã yêu thương các con.",
    speaker: "Chúa Giê-xu",
    theme: "Tình yêu",
    ref: "John 13:34",
  },
  {
    text: "Điều gì con muốn người khác làm cho mình, hãy làm điều đó cho người khác trước.",
    speaker: "Chúa Giê-xu",
    theme: "Tôn trọng người",
    ref: "Matthew 7:12",
  },
  {
    text: "Ta đến để các con được sống, và sống một cách dư dật.",
    speaker: "Chúa Giê-xu",
    theme: "Cuộc sống",
    ref: "John 10:10",
  },
  {
    text: "Đừng lo lắng về ngày mai, vì ngày mai sẽ tự lo cho ngày mai; sự khó nhọc ngày nào đủ cho ngày ấy.",
    speaker: "Chúa Giê-xu",
    theme: "Cuộc sống",
    ref: "Matthew 6:34",
  },
  {
    text: "Hãy cho đi, rồi con sẽ được ban cho lại.",
    speaker: "Chúa Giê-xu",
    theme: "Sống đẹp",
    ref: "Luke 6:38",
  },
  {
    text: "Hỡi kẻ biếng nhác, hãy đi xem loài kiến, xem cách chúng làm việc mà học lấy sự khôn ngoan.",
    speaker: "Vua Sa-lô-môn",
    theme: "Làm việc siêng năng",
    ref: "Proverbs 6:6",
  },
  {
    text: "Tay biếng nhác làm cho nghèo khó, còn tay siêng năng làm nên giàu có.",
    speaker: "Vua Sa-lô-môn",
    theme: "Làm việc siêng năng",
    ref: "Proverbs 10:4",
  },
  {
    text: "Của cải có được cách vội vàng sẽ hao hụt dần; ai tích góp từng chút sẽ ngày càng thêm lên.",
    speaker: "Vua Sa-lô-môn",
    theme: "Tiết kiệm",
    ref: "Proverbs 13:11",
  },
  {
    text: "Trong nhà người khôn ngoan có của quý được cất giữ, còn kẻ dại thì tiêu xài hết.",
    speaker: "Vua Sa-lô-môn",
    theme: "Tiết kiệm",
    ref: "Proverbs 21:20",
  },
  {
    text: "Muôn vật đều có kỳ định của nó; mọi việc dưới bầu trời đều có thời điểm riêng.",
    speaker: "Vua Sa-lô-môn",
    theme: "Cuộc sống",
    ref: "Ecclesiastes 3:1",
  },
  {
    text: "Con có thấy người siêng năng trong công việc mình không? Người ấy sẽ đứng trước mặt các vua.",
    speaker: "Vua Sa-lô-môn",
    theme: "Làm việc siêng năng",
    ref: "Proverbs 22:29",
  },
  {
    text: "Lời đáp êm dịu làm nguôi cơn giận; lời nói cay nghiệt chỉ khơi thêm thịnh nộ.",
    speaker: "Vua Sa-lô-môn",
    theme: "Tôn trọng người",
    ref: "Proverbs 15:1",
  },
  {
    text: "Người tài đức thì quý hơn châu ngọc; đôi tay siêng năng, cần mẫn làm nên giá trị ấy.",
    speaker: "Vua Sa-lô-môn",
    theme: "Làm việc siêng năng",
    ref: "Proverbs 31:10–13",
  },
  {
    text: "Đức Giê-hô-va là Đấng chăn giữ tôi, tôi sẽ chẳng thiếu thốn gì.",
    speaker: "Vua Đa-vít",
    theme: "Cuộc sống",
    ref: "Psalm 23:1",
  },
  {
    text: "Xin Chúa dạy chúng con biết đếm các ngày của mình, để chúng con được lòng khôn ngoan.",
    speaker: "Vua Đa-vít",
    theme: "Cuộc sống",
    ref: "Psalm 90:12",
  },
  {
    text: "Đây là ngày Đức Chúa Trời đã tạo nên; chúng ta hãy vui mừng và hớn hở trong ngày ấy.",
    speaker: "Vua Đa-vít",
    theme: "Sống đẹp",
    ref: "Psalm 118:24",
  },
  {
    text: "Hãy vui thỏa nơi Đức Giê-hô-va, Ngài sẽ ban cho con điều lòng con ao ước.",
    speaker: "Vua Đa-vít",
    theme: "Cuộc sống",
    ref: "Psalm 37:4",
  },
  {
    text: "Anh em sống hòa thuận với nhau, thật tốt đẹp và êm dịu biết bao!",
    speaker: "Vua Đa-vít",
    theme: "Tôn trọng người",
    ref: "Psalm 133:1",
  },
  {
    text: "Tình yêu thương hay nhịn nhục, hay nhân từ; không ghen tị, không khoe khoang, không kiêu ngạo.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Tình yêu",
    ref: "1 Corinthians 13:4",
  },
  {
    text: "Bất cứ làm việc gì, hãy hết lòng mà làm, như làm cho Chúa chứ không phải cho người.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Làm việc siêng năng",
    ref: "Colossians 3:23",
  },
  {
    text: "Đừng lo lắng gì cả; trong mọi việc, hãy trình dâng những điều mình thỉnh cầu.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Cuộc sống",
    ref: "Philippians 4:6",
  },
  {
    text: "Hãy yêu thương nhau như anh em một nhà; hãy lấy lòng tôn trọng mà nhường nhịn nhau.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Tôn trọng người",
    ref: "Romans 12:10",
  },
  {
    text: "Hãy đối xử tử tế với nhau, dịu dàng và sẵn lòng tha thứ cho nhau.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Tôn trọng người",
    ref: "Ephesians 4:32",
  },
  {
    text: "Trong mọi hoàn cảnh, hãy biết tạ ơn.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Sống đẹp",
    ref: "1 Thessalonians 5:18",
  },
  {
    text: "Chớ mệt mỏi trong việc làm điều thiện, vì đến kỳ, chúng ta sẽ gặt nếu không nản lòng.",
    speaker: "Sứ đồ Phao-lô",
    theme: "Làm việc siêng năng",
    ref: "Galatians 6:9",
  },
  {
    text: "Mỗi người phải mau nghe, chậm nói, chậm giận.",
    speaker: "Gia-cơ",
    theme: "Tôn trọng người",
    ref: "James 1:19",
  },
  {
    text: "Kẻ nào yêu thương thì sinh bởi Đức Chúa Trời và nhận biết Đức Chúa Trời.",
    speaker: "Sứ đồ Giăng",
    theme: "Tình yêu",
    ref: "1 John 4:7",
  },
  {
    text: "Hãy hết lòng, hết linh hồn, hết sức mà kính mến Chúa.",
    speaker: "Môi-se",
    theme: "Tình yêu",
    ref: "Deuteronomy 6:5",
  },
  {
    text: "Đức Giê-hô-va đã ban cho, Đức Giê-hô-va lại cất đi; đáng chúc tụng danh Đức Giê-hô-va.",
    speaker: "Ông Gióp",
    theme: "Cuộc sống",
    ref: "Job 1:21",
  },
] as const;

/** The 20 maxims, as given. No speaker: these are shown unattributed, by design. */
export const DANH_NGON: readonly DailyThought[] = [
  { text: "Một ngày sống tử tế là một ngày không phí hoài.", speaker: null, theme: "Sống đẹp", ref: null },
  {
    text: "Siêng năng hôm nay là món quà cho chính mình ngày mai.",
    speaker: null,
    theme: "Làm việc siêng năng",
    ref: null,
  },
  {
    text: "Người biết ơn những gì mình có, sẽ luôn thấy mình đủ đầy.",
    speaker: null,
    theme: "Cuộc sống",
    ref: null,
  },
  {
    text: "Lời nói nhẹ nhàng có sức mạnh hơn cả tiếng quát tháo.",
    speaker: null,
    theme: "Tôn trọng người",
    ref: null,
  },
  {
    text: "Tiết kiệm không phải là keo kiệt, mà là biết quý trọng những gì mình đang có.",
    speaker: null,
    theme: "Tiết kiệm",
    ref: null,
  },
  {
    text: "Yêu thương không cần lời hoa mỹ, chỉ cần một hành động chân thành.",
    speaker: null,
    theme: "Tình yêu",
    ref: null,
  },
  { text: "Người gieo điều tốt, sớm muộn cũng gặt được điều lành.", speaker: null, theme: "Sống đẹp", ref: null },
  {
    text: "Một giờ làm việc chăm chỉ đáng giá hơn cả ngày than vãn.",
    speaker: null,
    theme: "Làm việc siêng năng",
    ref: null,
  },
  {
    text: "Tôn trọng người khác bắt đầu từ việc lắng nghe họ thật lòng.",
    speaker: null,
    theme: "Tôn trọng người",
    ref: null,
  },
  {
    text: "Của cải rồi cũng qua đi, nhưng cách sống tử tế thì còn mãi.",
    speaker: null,
    theme: "Cuộc sống",
    ref: null,
  },
  {
    text: "Người khôn ngoan biết dừng lại đúng lúc, không tham quá sức mình.",
    speaker: null,
    theme: "Tiết kiệm",
    ref: null,
  },
  {
    text: "Một lời cảm ơn đúng lúc có thể sưởi ấm cả một ngày dài.",
    speaker: null,
    theme: "Tôn trọng người",
    ref: null,
  },
  {
    text: "Gia đình là nơi ta được là chính mình, không cần giả vờ.",
    speaker: null,
    theme: "Tình yêu",
    ref: null,
  },
  { text: "Càng cho đi, lòng càng thấy nhẹ nhàng và giàu có.", speaker: null, theme: "Sống đẹp", ref: null },
  {
    text: "Sức khoẻ là quý giá, hãy trân trọng khi còn có và sống lành mạnh.",
    speaker: null,
    theme: "Cuộc sống",
    ref: null,
  },
  {
    text: "Kiên nhẫn với người khác, cũng là kiên nhẫn với chính mình.",
    speaker: null,
    theme: "Tôn trọng người",
    ref: null,
  },
  {
    text: "Một ngày mới là một trang giấy trắng, hãy viết nó bằng điều tử tế.",
    speaker: null,
    theme: "Cuộc sống",
    ref: null,
  },
  {
    text: "Người biết quý thời gian, sẽ có nhiều thời gian hơn cho điều thật sự quan trọng.",
    speaker: null,
    theme: "Tiết kiệm",
    ref: null,
  },
  {
    text: "Hãy dành thời gian cho người mình thương, dù công việc có bận rộn đến đâu.",
    speaker: null,
    theme: "Tình yêu",
    ref: null,
  },
  {
    text: "Thành thật với chính mình là bước đầu để sống một cuộc đời ngay thẳng.",
    speaker: null,
    theme: "Sống đẹp",
    ref: null,
  },
] as const;

/** The list a category reads from. "Không chọn" has no list, by design. */
export function thoughtPool(category: DailyThoughtCategory): readonly DailyThought[] {
  if (category === "kinh_thanh") return KINH_THANH;
  if (category === "danh_ngon") return DANH_NGON;
  return [];
}

/**
 * The reader's own calendar day as a whole number, counted from their device clock rather than
 * UTC — someone reading at 23:30 in Hồ Chí Minh is still on today's line, not tomorrow's.
 */
export function dayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = a;
  let right = b;
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

/**
 * How far to move along the list each day.
 *
 * Any stride that shares no factor with the list length walks the entire list before returning
 * to its starting point — so every line appears exactly once in ANY run of `length` days, not
 * merely in laps counted from some arbitrary epoch. A shuffled-lap scheme only guarantees the
 * weaker, aligned version of that, and can repeat a line across a lap boundary.
 *
 * The stride sits near the golden ratio of the length, which is what keeps consecutive days far
 * apart in the list: the sequence reads as picked rather than counted, even though it is exact.
 */
export function dailyStride(length: number): number {
  if (length < 3) return 1;
  const target = Math.round(length * 0.618);
  for (let delta = 0; delta < length; delta += 1) {
    for (const candidate of [target + delta, target - delta]) {
      if (candidate > 1 && candidate < length && greatestCommonDivisor(candidate, length) === 1) {
        return candidate;
      }
    }
  }
  return 1;
}

/**
 * The line for this day, or null when there is nothing to show — the reader chose "Không chọn",
 * or the list is empty. Returning null rather than a placeholder keeps the screen silent instead
 * of printing an apology where a thought should be.
 */
export function pickDailyThought(category: DailyThoughtCategory, date: Date): DailyThought | null {
  const pool = thoughtPool(category);
  if (pool.length === 0) return null;

  const step = dayNumber(date) * dailyStride(pool.length);
  return pool[((step % pool.length) + pool.length) % pool.length];
}

/**
 * Exactly what the screen may show — the line, and a name only when there is one.
 *
 * There is deliberately no introducing sentence. The block sits under the reader's own name,
 * where the app has already greeted them; a second voice saying "let us pause together" before
 * every quote turns one quiet line into a small performance.
 */
export type DailyThoughtView = {
  text: string;
  speaker: string | null;
};

/**
 * The whole block, ready to render. The screen calls only this, and `DailyThoughtView` has no
 * field for a reference, so a book-chapter-verse cannot reach the interface by accident.
 */
export function dailyThoughtView(
  category: DailyThoughtCategory,
  date: Date,
): DailyThoughtView | null {
  const thought = pickDailyThought(category, date);
  if (thought === null) return null;
  return { text: thought.text, speaker: thought.speaker };
}
