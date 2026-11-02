import SwiftUI

/// Kết nối: Nhật ký (dòng nhật ký + Ghi chép) · 1-1 · Nhóm. Liên hệ mở từ nút người.
struct ConnectView: View {
    enum Sub: Hashable { case journal, direct, group }

    @Binding var unread: Int
    @Environment(AppModel.self) private var app
    @State private var sub: Sub = .direct
    @State private var inbox: [InboxRow] = []
    @State private var loading = true
    @State private var error: String?
    @State private var journalId: UUID?
    @State private var showContacts = false
    @State private var path = NavigationPath()

    private var direct: [InboxRow] { inbox.filter { $0.conversation_type == "direct" } }
    private var groups: [InboxRow] { inbox.filter { $0.isGroup } }
    private func unreadCount(_ rows: [InboxRow]) -> Int { rows.reduce(0) { $0 + ($1.unread_count ?? 0) } }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                AvTabHeader(title: "Kết nối") {
                    Button { showContacts = true } label: { Image(systemName: "person") }
                        .buttonStyle(AvRoundButtonStyle())
                        .accessibilityLabel("Liên hệ")
                }
                UnderlineTabs(
                    tabs: [
                        (Sub.journal, "Nhật ký", nil),
                        (Sub.direct, "1-1", unreadCount(direct)),
                        (Sub.group, "Nhóm", unreadCount(groups)),
                    ],
                    selection: $sub
                )
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Av.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: InboxRow.self) { row in
                ChatThreadView(conversationId: row.conversation_id, title: row.title, isGroup: row.isGroup)
                    .toolbar(.visible, for: .navigationBar)
                    .toolbar(.hidden, for: .tabBar)
                    .onDisappear { Task { await load() } }
            }
            .navigationDestination(for: Note.self) { note in
                NoteDetailView(note: note).toolbar(.visible, for: .navigationBar)
            }
            .sheet(isPresented: $showContacts) {
                ContactsView { userId in
                    showContacts = false
                    Task { await openDirect(with: userId) }
                }
            }
        }
        .task { await load() }
        .onChange(of: app.selectedTab) { _, tab in
            if tab == .connect { Task { await load() } }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch sub {
        case .journal:
            JournalPane(journalId: journalId)
        case .direct:
            list(direct, empty: ("person.2", "Chưa có cuộc trò chuyện 1-1", "Mở Liên hệ để nhắn cho người đã kết nối."))
        case .group:
            list(groups, empty: ("person.3", "Chưa có nhóm", "Nhóm tạo trên web sẽ hiện ở đây."))
        }
    }

    private func list(_ rows: [InboxRow], empty: (String, String, String)) -> some View {
        List {
            if let error {
                AvErrorBanner(message: error) { Task { await load() } }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            if loading && rows.isEmpty {
                ForEach(0..<6, id: \.self) { _ in InboxSkeletonRow() }
                    .listRowBackground(Color.clear)
            } else if rows.isEmpty {
                AvEmpty(icon: empty.0, title: empty.1, message: empty.2)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            ForEach(rows) { row in
                NavigationLink(value: row) { InboxRowView(row: row, me: app.userId) }
                    .listRowBackground(Color.clear)
                    .listRowSeparatorTint(Av.border)
            }
        }
        .listStyle(.plain)
        .avScreen()
        .refreshable { await load() }
    }

    private func load() async {
        do {
            inbox = try await Repo.inbox()
            error = nil
        } catch {
            if inbox.isEmpty { self.error = AvError.message(error) }
        }
        unread = unreadCount(direct) + unreadCount(groups)
        if journalId == nil { journalId = try? await Repo.journalConversation() }
        loading = false
    }

    private func openDirect(with user: UUID) async {
        guard let id = try? await Repo.directConversation(with: user) else { return }
        await load()
        sub = .direct
        if let row = inbox.first(where: { $0.conversation_id == id }) {
            path.append(row)
        }
    }
}

struct InboxRowView: View {
    let row: InboxRow
    let me: UUID?

    var body: some View {
        HStack(spacing: 12) {
            AvAvatar(name: row.title, size: 46, isGroup: row.isGroup)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(row.title)
                        .font(.body.weight(.bold))
                        .foregroundStyle(Av.ink)
                        .lineLimit(1)
                    if row.isGroup, let n = row.member_count {
                        Text("\(n)").font(.caption).foregroundStyle(Av.muted)
                    }
                    Spacer(minLength: 6)
                    if let at = row.last_message_at.flatMap(AvDate.parse) {
                        Text(AvFormat.short(at))
                            .font(.caption)
                            .foregroundStyle(hasUnread ? Av.ink : Av.muted)
                    }
                }
                HStack {
                    Text(preview)
                        .font(.subheadline.weight(hasUnread ? .semibold : .regular))
                        .foregroundStyle(hasUnread ? Av.ink : Av.muted)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    if hasUnread {
                        Text("\(row.unread_count ?? 0)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Av.accent, in: .capsule)
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var hasUnread: Bool { (row.unread_count ?? 0) > 0 }
    private var preview: String {
        let text = row.last_message_content ?? ""
        let shown = text.isEmpty ? "Chưa có tin nhắn" : text
        return row.last_message_sender_id == me && !text.isEmpty ? "Bạn: \(shown)" : shown
    }
}

private struct InboxSkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Av.sand).frame(width: 46, height: 46)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Av.sand).frame(width: 140, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Av.sand.opacity(0.7)).frame(width: 220, height: 10)
            }
        }
        .padding(.vertical, 6)
        .redacted(reason: .placeholder)
    }
}

/// Nhật ký: hai mặt — dòng nhật ký (cuộc trò chuyện riêng) và Ghi chép.
private struct JournalPane: View {
    enum Face: Hashable { case lines, notes }
    let journalId: UUID?
    @State private var face: Face = .lines

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $face) {
                Text("Dòng nhật ký").tag(Face.lines)
                Text("Ghi chép").tag(Face.notes)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            switch face {
            case .lines:
                if let journalId {
                    ChatThreadView(conversationId: journalId, title: "Nhật ký", isJournal: true, embedded: true)
                        .id(journalId)
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            case .notes:
                NotesListView()
            }
        }
    }
}
