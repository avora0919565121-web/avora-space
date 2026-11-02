import Foundation

// Mọi kiểu dữ liệu là `nonisolated` để giải mã được ngoài MainActor (Supabase client chạy nền).
// Thời gian giữ dạng chuỗi như PostgREST trả về; `AvDate.parse` đổi sang Date khi cần.

nonisolated struct Profile: Codable, Sendable, Identifiable {
    let id: UUID
    var display_name: String?
    var color_scheme: String?
    var daily_thought_category: String?
    var timezone: String?
}

nonisolated struct InboxRow: Codable, Sendable, Identifiable, Hashable {
    let conversation_id: UUID
    let peer_id: UUID?
    let peer_display_name: String?
    let peer_email: String?
    let last_message_content: String?
    let last_message_at: String?
    let last_message_sender_id: UUID?
    let unread_count: Int?
    let conversation_type: String?
    let group_name: String?
    let member_count: Int?

    var id: UUID { conversation_id }
    var isGroup: Bool { conversation_type == "group" }
    var title: String {
        if isGroup { return group_name?.isEmpty == false ? group_name! : "Nhóm" }
        return peer_display_name?.isEmpty == false ? peer_display_name! : (peer_email ?? "Người dùng")
    }
}

nonisolated struct ChatMessage: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let conversation_id: UUID
    let sender_id: UUID?
    let content: String?
    let created_at: String
    let deleted_at: String?
    let system_kind: String?
    let sticker_id: String?
    let attachment_count: Int?
    let expires_at: String?

    static let columns = "id, conversation_id, sender_id, content, created_at, deleted_at, system_kind, sticker_id, attachment_count, expires_at"

    var date: Date { AvDate.parse(created_at) ?? .distantPast }
    var isVisible: Bool {
        guard system_kind == nil else { return false }
        if let e = expires_at, let d = AvDate.parse(e), d < Date() { return false }
        return true
    }
}

nonisolated struct TaskItem: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let type: String
    let creator_id: UUID?
    let assignee_id: UUID?
    var title: String
    var status: String
    var description: String?
    var deadline_date: String?
    var deadline_time: String?
    var done_at: String?
    let created_at: String?
    let deleted_by_creator: Bool?
    let deleted_by_peer: Bool?
    let skipped_at: String?
    let is_important: Bool?

    static let columns = "id, type, creator_id, assignee_id, title, status, description, deadline_date, deadline_time, done_at, created_at, deleted_by_creator, deleted_by_peer, skipped_at, is_important"

    var isDone: Bool { status == "done" }
    var deadline: Date? { deadline_date.flatMap(AvDate.day) }
}

nonisolated struct NoteBlock: Codable, Sendable, Hashable {
    let id: String
    let text: String
    let level: Int?
}

nonisolated struct Note: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let folder_id: UUID?
    let title: String?
    let blocks: [NoteBlock]?
    let tags: [String]?
    let pinned_at: String?
    let book_title: String?
    let updated_at: String

    static let columns = "id, folder_id, title, blocks, tags, pinned_at, book_title, updated_at"

    var displayTitle: String {
        if let t = title?.trimmingCharacters(in: .whitespaces), !t.isEmpty { return t }
        return blocks?.first(where: { !$0.text.isEmpty })?.text ?? "Ghi chép không tên"
    }
    var preview: String {
        (blocks ?? []).map(\.text).filter { !$0.isEmpty }.prefix(3).joined(separator: " · ")
    }
}

nonisolated struct NoteFolder: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let is_system: Bool?
    let system_key: String?
    let position: Int?
}

nonisolated struct StatusOption: Codable, Sendable, Hashable {
    let key: String
    let label: String
    let done: Bool?
}

nonisolated struct ColumnDef: Codable, Sendable, Hashable {
    let key: String
    let label: String?
    let type: String?
}

nonisolated struct ThinkTable: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let purpose: String?
    let kind: String?
    let status_options: [StatusOption]?
    let column_defs: [ColumnDef]?
    let parent_record_id: UUID?
    let updated_at: String?

    static let columns = "id, name, purpose, kind, status_options, column_defs, parent_record_id, updated_at"

    var isBookshelf: Bool { kind == "bookshelf" }
    func statusLabel(_ key: String?) -> String? {
        guard let key else { return nil }
        return status_options?.first(where: { $0.key == key })?.label ?? key
    }
    func column(labelled label: String) -> String? {
        column_defs?.first(where: { $0.label?.localizedCaseInsensitiveCompare(label) == .orderedSame })?.key
    }
}

/// Giá trị JSON tự do trong `extension_fields`.
nonisolated enum JSONValue: Codable, Sendable, Hashable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .null }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }

    var text: String? {
        switch self {
        case .string(let s): return s.isEmpty ? nil : s
        case .number(let n): return n == n.rounded() ? String(Int(n)) : String(n)
        case .bool(let b): return b ? "Có" : "Không"
        case .array(let a):
            let parts = a.compactMap(\.text)
            return parts.isEmpty ? nil : parts.joined(separator: ", ")
        default: return nil
        }
    }
}

nonisolated struct ThinkRecord: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let table_id: UUID
    let title: String?
    let status: String?
    let priority: String?
    let next_action_date: String?
    let notes: String?
    let extension_fields: [String: JSONValue]?
    let updated_at: String

    static let columns = "id, table_id, title, status, priority, next_action_date, notes, extension_fields, updated_at"

    var displayTitle: String { (title?.isEmpty == false ? title : nil) ?? "Không tên" }
}

nonisolated struct ReadingState: Codable, Sendable, Hashable {
    let record_id: UUID
    let locator: String?
    let percent: Double?
    let updated_at: String
}

nonisolated struct Contact: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let contact_type: String
    let name: String
    let phone: String?
    let email: String?
    let note: String?
    let linked_user_id: UUID?
    let relationship_tag: String?
    let industry: String?

    static let columns = "id, contact_type, name, phone, email, note, linked_user_id, relationship_tag, industry"
    var isBusiness: Bool { contact_type == "business" }
}

nonisolated struct FinanceAccount: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let type: String
    let balance: Double?
    let currency: String?
    let account_number: String?
    let other_person_name: String?

    static let columns = "id, name, type, balance, currency, account_number, other_person_name"

    var typeLabel: String {
        switch type {
        case "cash": return "Tiền mặt"
        case "checking": return "Tài khoản ngân hàng"
        case "savings": return "Tiết kiệm"
        case "credit": return "Thẻ tín dụng"
        case "investment": return "Đầu tư"
        default: return "Khác"
        }
    }
    var icon: String {
        switch type {
        case "cash": return "banknote"
        case "checking": return "building.columns"
        case "savings": return "leaf"
        case "credit": return "creditcard"
        case "investment": return "chart.line.uptrend.xyaxis"
        default: return "wallet.pass"
        }
    }
}

nonisolated struct FinanceTxn: Codable, Sendable, Identifiable, Hashable {
    let id: UUID
    let account_id: UUID?
    let type: String
    let amount: Double
    let description: String?
    let transaction_date: String
    let currency: String?

    static let columns = "id, account_id, type, amount, description, transaction_date, currency"

    var isInflow: Bool { type == "income" || type == "vay" }
    var typeLabel: String {
        switch type {
        case "income": return "Thu"
        case "expense": return "Chi"
        case "vay": return "Vay"
        case "cho_vay": return "Cho vay"
        case "thue_ca_nhan": return "Thuế cá nhân"
        case "thue_kinh_doanh": return "Thuế kinh doanh"
        default: return type
        }
    }
}

nonisolated struct VaultStatus: Codable, Sendable {
    let has_code: Bool?
    let unlocked: Bool?
    let expires_at: String?
    let locked_until: String?
    let remaining: Int?
    let device_allowed: Bool?
}

nonisolated struct VaultAttempt: Codable, Sendable {
    let ok: Bool?
    let reason: String?
    let remaining: Int?
    let locked_until: String?
}

nonisolated struct GroupMember: Codable, Sendable, Identifiable, Hashable {
    let user_id: UUID
    let display_name: String?
    let role: String?
    var id: UUID { user_id }
}

nonisolated struct FoundUser: Codable, Sendable, Hashable {
    let user_id: UUID
    let display_name: String?
    let email: String?
}

// MARK: - Thời gian

nonisolated enum AvDate {
    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Đọc dấu thời gian Postgres (có/không phần thập phân, 0–6 chữ số).
    static func parse(_ s: String) -> Date? {
        if let d = isoFrac.date(from: s) ?? iso.date(from: s) { return d }
        // Bỏ phần thập phân rồi đọc lại (ISO8601DateFormatter kén số chữ số).
        if let dot = s.firstIndex(of: ".") {
            var rest = s[s.index(after: dot)...]
            while let c = rest.first, c.isNumber { rest = rest.dropFirst() }
            let trimmed = String(s[..<dot]) + rest
            return iso.date(from: trimmed.replacingOccurrences(of: " ", with: "T"))
        }
        return iso.date(from: s.replacingOccurrences(of: " ", with: "T"))
    }

    /// Ngày dạng `YYYY-MM-DD` theo lịch máy.
    static func day(_ s: String) -> Date? {
        let p = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    static func dayString(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func nowISO() -> String { isoFrac.string(from: Date()) }
}

enum AvFormat {
    static let vi = Locale(identifier: "vi_VN")

    /// "14:05" hôm nay, "Hôm qua", "Th 2", hoặc "12/10".
    static func short(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(vi)) }
        if cal.isDateInYesterday(date) { return "Hôm qua" }
        if let days = cal.dateComponents([.day], from: date, to: Date()).day, days < 7 {
            return date.formatted(.dateTime.weekday(.abbreviated).locale(vi))
        }
        return date.formatted(.dateTime.day().month(.twoDigits).locale(vi))
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(vi))
    }

    static func dayHeader(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Hôm nay" }
        if cal.isDateInYesterday(date) { return "Hôm qua" }
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(vi)).capitalized(with: vi)
    }

    static func money(_ v: Double, currency: String?) -> String {
        let code = (currency?.isEmpty == false ? currency! : "VND").uppercased()
        let digits = code == "VND" ? 0 : 2
        return v.formatted(.currency(code: code).precision(.fractionLength(digits)).locale(vi))
    }

    /// "17:00" từ "17:00:00".
    static func hhmm(_ t: String?) -> String? {
        guard let t, t.count >= 5 else { return nil }
        return String(t.prefix(5))
    }
}
