import Foundation

/// Cùng thuật toán với `web/src/lib/daily-thoughts.ts` để web và iOS hiện đúng một câu mỗi ngày.
enum DailyThought {
    struct Line: Equatable {
        let text: String
        let id: String // `category:YYYY-MM-DD` — khoá "Viết lời bình" gửi lên Nhật ký
    }

    private static let yearKey = 137

    static func today(category raw: String?, date: Date = Date()) -> Line? {
        let category = raw ?? "danh_ngon_luan_phien"
        if category == "khong_chon" { return nil }
        let cal = Calendar.current
        let year = cal.component(.year, from: date)
        let day = min(cal.ordinality(of: .day, in: .year, for: date) ?? 1, 365)
        let dayId = AvDate.dayString(date)

        if category == "danh_ngon" {
            let pool = Maxims.sections.flatMap(\.lines)
            guard !pool.isEmpty else { return nil }
            let offset = ((year % 365) * yearKey) % 365
            return Line(text: pool[(day - 1 + offset) % pool.count], id: "danh_ngon:\(dayId)")
        }

        // Mặc định & các lựa chọn cũ: danh ngôn luân phiên chủ đề.
        let days = rotatingYear(year)
        guard !days.isEmpty else { return nil }
        let text = days[min(day, days.count) - 1]
        return Line(text: text, id: "danh_ngon_luan_phien:\(dayId)")
    }

    private static func rotatingYear(_ year: Int) -> [String] {
        let sections = Maxims.sections
        let themes = sections.count
        guard themes > 0 else { return [] }
        let start = ((year % themes) + themes) % themes
        let order = (0..<themes).map { sections[(start + $0) % themes] }
        var read = Array(repeating: 0, count: themes)
        var days: [String] = []
        var progressed = true
        while progressed {
            progressed = false
            for (index, section) in order.enumerated() {
                let length = section.lines.count
                if read[index] >= length { continue }
                let offset = (((year * 7) % length) + length) % length
                days.append(section.lines[(read[index] + offset) % length])
                read[index] += 1
                progressed = true
            }
        }
        return days
    }
}
