import SwiftUI
import Supabase

/// Một cuộc trò chuyện: tải tin, nghe tin mới (Realtime), gửi qua `send_message`.
@Observable
final class ChatThreadModel {
    let conversationId: UUID
    var messages: [ChatMessage] = []
    var names: [UUID: String] = [:]
    var loading = true
    var error: String?
    var sending = false

    private var channel: RealtimeChannelV2?
    private var listenTask: Task<Void, Never>?

    init(conversationId: UUID) {
        self.conversationId = conversationId
    }

    func load(isGroup: Bool) async {
        do {
            let rows = try await Repo.messages(conversationId)
            messages = rows
            error = nil
            if isGroup, names.isEmpty, let members = try? await Repo.groupMembers(conversationId) {
                names = Dictionary(uniqueKeysWithValues: members.map { ($0.user_id, $0.display_name ?? "Thành viên") })
            }
            await Repo.markRead(conversationId)
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }

    func listen() async {
        guard channel == nil else { return }
        let ch = Backend.client.channel("ios-thread-\(conversationId.uuidString.lowercased())")
        channel = ch
        let inserts = ch.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "messages",
            filter: .eq("conversation_id", value: conversationId.uuidString.lowercased())
        )
        try? await ch.subscribeWithError()
        listenTask = Task { [weak self] in
            for await action in inserts {
                guard let self else { return }
                if let m = try? action.decodeRecord(as: ChatMessage.self, decoder: JSONDecoder()), m.isVisible, m.deleted_at == nil {
                    self.insert(m)
                    await Repo.markRead(self.conversationId)
                }
            }
        }
    }

    func stop() async {
        listenTask?.cancel()
        listenTask = nil
        if let channel { await Backend.client.removeChannel(channel) }
        channel = nil
    }

    private func insert(_ m: ChatMessage) {
        if let i = messages.firstIndex(where: { $0.id == m.id }) {
            messages[i] = m
        } else {
            messages.append(m)
            messages.sort { $0.date < $1.date }
        }
    }

    /// Gửi lạc quan: hiện ngay, cùng id với máy chủ để không nhân đôi khi Realtime trả về.
    func send(_ text: String, me: UUID) async -> Bool {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return false }
        let id = UUID()
        let pending = ChatMessage(
            id: id, conversation_id: conversationId, sender_id: me, content: body,
            created_at: AvDate.nowISO(), deleted_at: nil, system_kind: nil, sticker_id: nil,
            attachment_count: 0, expires_at: nil
        )
        insert(pending)
        sending = true
        defer { sending = false }
        do {
            let saved = try await Repo.send(conversationId, text: body, id: id)
            insert(saved)
            return true
        } catch {
            messages.removeAll { $0.id == id }
            self.error = "Chưa gửi được. Kiểm tra mạng và thử lại."
            return false
        }
    }
}

/// Màn trò chuyện. `journal` = Nhật ký: các dòng của riêng mình, xếp như sổ tay.
struct ChatThreadView: View {
    let conversationId: UUID
    let title: String
    var isGroup = false
    var isJournal = false
    var embedded = false

    @Environment(AppModel.self) private var app
    @State private var model: ChatThreadModel
    @State private var draft = ""
    @State private var sentTick = 0
    @FocusState private var composerFocused: Bool

    init(conversationId: UUID, title: String, isGroup: Bool = false, isJournal: Bool = false, embedded: Bool = false) {
        self.conversationId = conversationId
        self.title = title
        self.isGroup = isGroup
        self.isJournal = isJournal
        self.embedded = embedded
        _model = State(initialValue: ChatThreadModel(conversationId: conversationId))
    }

    var body: some View {
        VStack(spacing: 0) {
            messagesList
            composer
        }
        .background(Av.paper.ignoresSafeArea())
        .navigationTitle(embedded ? "" : title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load(isGroup: isGroup)
            await model.listen()
        }
        .onDisappear { Task { await model.stop() } }
        .sensoryFeedback(.impact(weight: .light), trigger: sentTick)
    }

    private var grouped: [(day: Date, items: [ChatMessage])] {
        let cal = Calendar.current
        let dict = Dictionary(grouping: model.messages) { cal.startOfDay(for: $0.date) }
        return dict.keys.sorted().map { ($0, dict[$0]!) }
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if model.loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    } else if model.messages.isEmpty {
                        AvEmpty(
                            icon: isJournal ? "book.closed" : "bubble.left",
                            title: isJournal ? "Viết dòng đầu tiên" : "Chưa có tin nhắn",
                            message: isJournal ? "Nhật ký chỉ mình bạn đọc được." : "Gửi lời chào để bắt đầu."
                        )
                        .padding(.top, 40)
                    }
                    ForEach(grouped, id: \.day) { group in
                        Text(AvFormat.dayHeader(group.day))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Av.muted)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Av.sand.opacity(0.7), in: .capsule)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                        ForEach(group.items) { m in
                            if isJournal {
                                JournalLine(message: m)
                            } else {
                                bubble(m, previous: group.items.previous(of: m))
                            }
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.messages.count) {
                withAnimation(.snappy) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .refreshable { await model.load(isGroup: isGroup) }
        }
    }

    @ViewBuilder
    private func bubble(_ m: ChatMessage, previous: ChatMessage?) -> some View {
        let mine = m.sender_id == app.userId
        let showName = isGroup && !mine && previous?.sender_id != m.sender_id
        VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
            if showName, let sid = m.sender_id {
                Text(model.names[sid] ?? "Thành viên")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Av.accentInk)
                    .padding(.horizontal, 6)
                    .padding(.top, 6)
            }
            HStack(alignment: .bottom, spacing: 6) {
                if mine { Spacer(minLength: 48) }
                VStack(alignment: .leading, spacing: 3) {
                    Text(messageText(m))
                        .font(.body)
                        .foregroundStyle(mine ? .white : Av.ink)
                        .textSelection(.enabled)
                    Text(AvFormat.time(m.date))
                        .font(.caption2)
                        .foregroundStyle(mine ? .white.opacity(0.75) : Av.muted)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(mine ? Av.accent : Av.card, in: .rect(cornerRadius: 16))
                .overlay {
                    if !mine { RoundedRectangle(cornerRadius: 16).strokeBorder(Av.border) }
                }
                if !mine { Spacer(minLength: 48) }
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
    }

    private func messageText(_ m: ChatMessage) -> String {
        if let c = m.content, !c.isEmpty { return c }
        if m.sticker_id != nil { return "Nhãn dán" }
        if (m.attachment_count ?? 0) > 0 { return "Tệp đính kèm — xem trên web" }
        return " "
    }

    private var composer: some View {
        VStack(spacing: 6) {
            if let e = model.error {
                Text(e).font(.caption).foregroundStyle(Av.danger).frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(isJournal ? "Viết vào Nhật ký…" : "Nhắn tin…", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($composerFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Av.card, in: .rect(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Av.border))
                Button {
                    guard let me = app.userId else { return }
                    let text = draft
                    draft = ""
                    Task {
                        if await model.send(text, me: me) { sentTick += 1 } else { draft = text }
                    }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.body.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(canSend ? Av.accent : Av.muted.opacity(0.35), in: .circle)
                }
                .disabled(!canSend)
                .animation(.snappy(duration: 0.15), value: canSend)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .background(Av.paper)
        .overlay(alignment: .top) { Rectangle().fill(Av.border).frame(height: 1) }
    }

    private var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// Một dòng Nhật ký: giờ bên trái, chữ bên phải, như sổ tay.
private struct JournalLine: View {
    let message: ChatMessage
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(AvFormat.time(message.date))
                .font(.caption.monospacedDigit())
                .foregroundStyle(Av.muted)
                .frame(width: 40, alignment: .leading)
            Text(message.content ?? "")
                .font(.body)
                .foregroundStyle(Av.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(Av.card, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Av.border.opacity(0.7)))
    }
}

extension Array where Element: Identifiable {
    func previous(of element: Element) -> Element? {
        guard let i = firstIndex(where: { $0.id == element.id }), i > 0 else { return nil }
        return self[i - 1]
    }
}
