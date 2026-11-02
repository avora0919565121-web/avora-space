import Foundation
import Supabase

/// Một client Supabase dùng chung với web (cùng dự án, cùng RLS, cùng RPC).
enum Backend {
    static let isConfigured = !Config.EXPO_PUBLIC_SUPABASE_URL.isEmpty && !Config.EXPO_PUBLIC_SUPABASE_ANON_KEY.isEmpty

    static let client: SupabaseClient = {
        let url = URL(string: Config.EXPO_PUBLIC_SUPABASE_URL) ?? URL(string: "https://invalid.supabase.co")!
        return SupabaseClient(
            supabaseURL: url,
            supabaseKey: Config.EXPO_PUBLIC_SUPABASE_ANON_KEY.isEmpty ? "missing" : Config.EXPO_PUBLIC_SUPABASE_ANON_KEY,
            options: SupabaseClientOptions(
                auth: .init(storageKey: "avora.ios.auth", emitLocalSessionAsInitialSession: true)
            )
        )
    }()

    static var db: SupabaseClient { client }
}

/// Lỗi diễn đạt cho người dùng — không lộ mã máy.
enum AvError {
    static func message(_ error: Error) -> String {
        let text = String(describing: error).lowercased()
        if text.contains("offline") || text.contains("network") || text.contains("timed out") || text.contains("-1009") {
            return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại."
        }
        if text.contains("invalid login") || text.contains("invalid_credentials") {
            return "Email hoặc mật khẩu chưa đúng."
        }
        if text.contains("rate") || text.contains("too many") {
            return "Bạn thao tác hơi nhanh. Thử lại sau ít phút nhé."
        }
        if text.contains("jwt") || text.contains("401") {
            return "Phiên đăng nhập đã hết. Đăng nhập lại nhé."
        }
        return "Có lỗi khi tải. Thử lại nhé."
    }
}

// MARK: - Kho dữ liệu (cùng truy vấn với web/src/lib/*)

enum Repo {
    private static var db: SupabaseClient { Backend.client }

    // Hồ sơ
    static func profile(_ id: UUID) async throws -> Profile? {
        let rows: [Profile] = try await db.from("profiles")
            .select("id, display_name, color_scheme, daily_thought_category, timezone")
            .eq("id", value: id.uuidString)
            .limit(1)
            .execute().value
        return rows.first
    }

    static func updateDisplayName(_ id: UUID, _ name: String) async throws {
        try await db.from("profiles")
            .update(["display_name": AnyJSON.string(name)])
            .eq("id", value: id.uuidString)
            .execute()
    }

    static func updateColorScheme(_ id: UUID, _ scheme: String) async throws {
        try await db.from("profiles")
            .update(["color_scheme": AnyJSON.string(scheme)])
            .eq("id", value: id.uuidString)
            .execute()
    }

    // Hội thoại
    static func inbox() async throws -> [InboxRow] {
        try await db.rpc("inbox_page", params: ["p_limit": AnyJSON.integer(100)]).execute().value
    }

    static func journalConversation() async throws -> UUID {
        try await db.rpc("get_my_journal_conversation").execute().value
    }

    static func messages(_ conversation: UUID, limit: Int = 80) async throws -> [ChatMessage] {
        let rows: [ChatMessage] = try await db.from("messages")
            .select(ChatMessage.columns)
            .eq("conversation_id", value: conversation.uuidString)
            .is("trashed_at", value: nil)
            .is("deleted_at", value: nil)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
        return rows.filter(\.isVisible).reversed()
    }

    @discardableResult
    static func send(_ conversation: UUID, text: String, id: UUID = UUID(), dailyThought: String? = nil) async throws -> ChatMessage {
        var params: [String: AnyJSON] = [
            "p_id": .string(id.uuidString.lowercased()),
            "p_conversation": .string(conversation.uuidString.lowercased()),
            "p_content": .string(text),
        ]
        if let dailyThought { params["p_daily_thought"] = .string(dailyThought) }
        return try await db.rpc("send_message", params: params).execute().value
    }

    static func markRead(_ conversation: UUID) async {
        _ = try? await db.rpc("mark_conversation_read", params: ["p_conversation_id": AnyJSON.string(conversation.uuidString.lowercased())]).execute()
    }

    static func groupMembers(_ conversation: UUID) async throws -> [GroupMember] {
        try await db.rpc("list_group_members", params: ["p_conversation_id": AnyJSON.string(conversation.uuidString.lowercased())]).execute().value
    }

    static func directConversation(with user: UUID) async throws -> UUID {
        try await db.rpc("create_direct_conversation", params: ["other_user_id": AnyJSON.string(user.uuidString.lowercased())]).execute().value
    }

    // Ghi chép
    static func notes() async throws -> [Note] {
        try await db.from("notes")
            .select(Note.columns)
            .is("deleted_at", value: nil)
            .order("updated_at", ascending: false)
            .limit(300)
            .execute().value
    }

    static func noteFolders() async throws -> [NoteFolder] {
        try await db.from("note_folders")
            .select("id, name, is_system, system_key, position")
            .order("position", ascending: true)
            .execute().value
    }

    static func createNote(owner: UUID, title: String, body: String) async throws -> Note {
        let blocks: [AnyJSON] = body
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line in
                .object([
                    "id": .string(String(UUID().uuidString.lowercased().prefix(12))),
                    "text": .string(String(line)),
                    "level": .integer(0),
                    "attachmentRefs": .array([]),
                ])
            }
        return try await db.from("notes")
            .insert([
                "owner_user_id": AnyJSON.string(owner.uuidString.lowercased()),
                "title": .string(title),
                "blocks": .array(blocks),
            ], returning: .representation)
            .select(Note.columns)
            .single()
            .execute().value
    }

    // Nhiệm vụ
    static func tasks(me: UUID) async throws -> [TaskItem] {
        let rows: [TaskItem] = try await db.from("tasks")
            .select(TaskItem.columns)
            .in("status", values: ["confirmed", "pending_confirmation", "done"])
            .is("skipped_at", value: nil)
            .order("deadline_date", ascending: true, nullsFirst: false)
            .limit(800)
            .execute().value
        return rows.filter { t in
            if t.creator_id == me { return t.deleted_by_creator != true }
            return t.deleted_by_peer != true
        }
    }

    /// `deadline_date` là bắt buộc trên bảng; không có giờ nghĩa là "Trong ngày".
    static func createPersonalTask(me: UUID, title: String, deadline: Date, time: Date?) async throws -> TaskItem {
        var row: [String: AnyJSON] = [
            "type": .string("personal"),
            "creator_id": .string(me.uuidString.lowercased()),
            "title": .string(title),
            "status": .string("confirmed"),
            "is_important": .bool(false),
            "recurrence": .string("none"),
            "deadline_tz": .string(TimeZone.current.identifier),
            "deadline_date": .string(AvDate.dayString(deadline)),
        ]
        if let time {
            let c = Calendar.current.dateComponents([.hour, .minute], from: time)
            row["deadline_time"] = .string(String(format: "%02d:%02d:00", c.hour ?? 0, c.minute ?? 0))
        }
        return try await db.from("tasks")
            .insert(row, returning: .representation)
            .select(TaskItem.columns)
            .single()
            .execute().value
    }

    static func setTaskDone(_ id: UUID, done: Bool) async throws {
        let patch: [String: AnyJSON] = done
            ? ["status": .string("done"), "done_at": .string(AvDate.nowISO())]
            : ["status": .string("confirmed"), "done_at": .null]
        try await db.from("tasks").update(patch).eq("id", value: id.uuidString).execute()
    }

    // Kế hoạch
    static func tables() async throws -> [ThinkTable] {
        try await db.from("think_hub_table")
            .select(ThinkTable.columns)
            .is("deleted_at", value: nil)
            .is("archived_at", value: nil)
            .is("parent_record_id", value: nil)
            .order("updated_at", ascending: false)
            .execute().value
    }

    static func ensureBookshelf() async throws -> ThinkTable {
        try await db.rpc("ensure_bookshelf").select(ThinkTable.columns).single().execute().value
    }

    static func records(_ table: UUID) async throws -> [ThinkRecord] {
        try await db.from("think_hub_record")
            .select(ThinkRecord.columns)
            .eq("table_id", value: table.uuidString)
            .is("deleted_at", value: nil)
            .is("archived_at", value: nil)
            .order("updated_at", ascending: false)
            .limit(500)
            .execute().value
    }

    static func readingStates() async throws -> [ReadingState] {
        try await db.from("book_reading_state")
            .select("record_id, locator, percent, updated_at")
            .execute().value
    }

    static func setRecordStatus(_ id: UUID, _ status: String) async throws {
        try await db.from("think_hub_record")
            .update(["status": AnyJSON.string(status)])
            .eq("id", value: id.uuidString)
            .execute()
    }

    static func createRecord(table: UUID, owner: UUID, title: String, status: String?) async throws -> ThinkRecord {
        var row: [String: AnyJSON] = [
            "table_id": .string(table.uuidString.lowercased()),
            "owner_user_id": .string(owner.uuidString.lowercased()),
            "title": .string(title),
        ]
        if let status { row["status"] = .string(status) }
        return try await db.from("think_hub_record")
            .insert(row, returning: .representation)
            .select(ThinkRecord.columns)
            .single()
            .execute().value
    }

    // Liên hệ
    static func contacts() async throws -> [Contact] {
        try await db.from("contact")
            .select(Contact.columns)
            .order("name", ascending: true)
            .limit(5000)
            .execute().value
    }

    static func createContact(name: String, phone: String?, email: String?, note: String?) async throws {
        _ = try await db.rpc("create_contact", params: [
            "p_contact_type": AnyJSON.string("individual"),
            "p_name": .string(name),
            "p_phone": phone.map(AnyJSON.string) ?? .null,
            "p_email": email.map(AnyJSON.string) ?? .null,
            "p_note": note.map(AnyJSON.string) ?? .null,
        ]).execute()
    }

    // Két sắt
    static func vaultStatus() async throws -> VaultStatus {
        try await db.rpc("vault_status").execute().value
    }

    static func vaultUnlock(_ code: String) async throws -> VaultAttempt {
        try await db.rpc("vault_unlock", params: ["p_code": AnyJSON.string(code)]).execute().value
    }

    static func vaultLock() async {
        _ = try? await db.rpc("vault_lock").execute()
    }

    static func accounts() async throws -> [FinanceAccount] {
        try await db.from("accounts")
            .select(FinanceAccount.columns)
            .is("deleted_at", value: nil)
            .is("removed_at", value: nil)
            .order("name", ascending: true)
            .execute().value
    }

    static func transactions(limit: Int = 60) async throws -> [FinanceTxn] {
        try await db.from("transactions")
            .select(FinanceTxn.columns)
            .is("deleted_at", value: nil)
            .is("removed_at", value: nil)
            .order("transaction_date", ascending: false)
            .order("created_at", ascending: false)
            .limit(limit)
            .execute().value
    }
}
