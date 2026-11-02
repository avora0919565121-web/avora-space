import SwiftUI

/// Ghi chép — danh sách, lọc theo thư mục, tìm, tạo mới.
struct NotesListView: View {
    @Environment(AppModel.self) private var app
    @State private var notes: [Note] = []
    @State private var folders: [NoteFolder] = []
    @State private var folder: UUID?
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?
    @State private var showNew = false

    private var shown: [Note] {
        notes.filter { n in
            (folder == nil || n.folder_id == folder)
                && (query.isEmpty || n.displayTitle.localizedCaseInsensitiveContains(query) || n.preview.localizedCaseInsensitiveContains(query))
        }
        .sorted { a, b in
            if (a.pinned_at != nil) != (b.pinned_at != nil) { return a.pinned_at != nil }
            return a.updated_at > b.updated_at
        }
    }

    var body: some View {
        List {
            Section {
                AvSearchField(text: $query, prompt: "Tìm ghi chép")
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                if !folders.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            chip("Tất cả", selected: folder == nil) { folder = nil }
                            ForEach(folders) { f in
                                chip(f.name, selected: folder == f.id) { folder = f.id }
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
                if let error {
                    AvErrorBanner(message: error) { Task { await load() } }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                if loading && notes.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                } else if shown.isEmpty {
                    AvEmpty(icon: "note.text", title: query.isEmpty ? "Chưa có ghi chép" : "Không tìm thấy", message: query.isEmpty ? "Chạm + để viết ghi chép đầu tiên." : nil)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                ForEach(shown) { note in
                    NavigationLink(value: note) { NoteRow(note: note) }
                        .listRowBackground(Color.clear)
                        .listRowSeparatorTint(Av.border)
                }
            }
        }
        .listStyle(.plain)
        .avScreen()
        .overlay(alignment: .bottomTrailing) {
            Button { showNew = true } label: { Image(systemName: "plus").font(.title3.weight(.bold)) }
                .buttonStyle(AvRoundButtonStyle(filled: true))
                .scaleEffect(1.25)
                .shadow(color: Av.accent.opacity(0.3), radius: 10, y: 4)
                .padding(20)
                .accessibilityLabel("Ghi chép mới")
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showNew) {
            NewNoteSheet { note in notes.insert(note, at: 0) }
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.snappy) { action() } }) {
            Text(title)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? Av.accentInk : Av.ink)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(selected ? Av.accentSoft : Av.card, in: .capsule)
                .overlay(Capsule().strokeBorder(selected ? .clear : Av.border))
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        do {
            async let n = Repo.notes()
            async let f = Repo.noteFolders()
            notes = try await n
            folders = (try? await f) ?? []
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}

private struct NoteRow: View {
    let note: Note
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if note.pinned_at != nil {
                    Image(systemName: "pin.fill").font(.caption2).foregroundStyle(Av.accent)
                }
                Text(note.displayTitle).font(.body.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(1)
            }
            if !note.preview.isEmpty {
                Text(note.preview).font(.subheadline).foregroundStyle(Av.muted).lineLimit(2)
            }
            HStack(spacing: 6) {
                if let book = note.book_title, !book.isEmpty {
                    Label(book, systemImage: "book").font(.caption).foregroundStyle(Av.accentInk).lineLimit(1)
                }
                if let d = AvDate.parse(note.updated_at) {
                    Text(AvFormat.short(d)).font(.caption).foregroundStyle(Av.muted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Đọc một ghi chép (khối theo cấp thụt lề như web).
struct NoteDetailView: View {
    let note: Note
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(note.displayTitle)
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundStyle(Av.ink)
                if let book = note.book_title, !book.isEmpty {
                    Label(book, systemImage: "book").font(.subheadline).foregroundStyle(Av.accentInk)
                }
                if let tags = note.tags, !tags.isEmpty {
                    Text(tags.map { "#\($0)" }.joined(separator: "  ")).font(.caption).foregroundStyle(Av.muted)
                }
                Divider().overlay(Av.border).padding(.vertical, 4)
                ForEach(note.blocks ?? [], id: \.id) { b in
                    if !b.text.isEmpty {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if (b.level ?? 0) > 0 { Text("•").foregroundStyle(Av.muted) }
                            Text(b.text).font(.body).foregroundStyle(Av.ink).lineSpacing(4).textSelection(.enabled)
                        }
                        .padding(.leading, CGFloat(b.level ?? 0) * 18)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .avScreen()
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NewNoteSheet: View {
    var onCreated: (Note) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var body_ = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Tiêu đề", text: $title)
                    .font(.title2.weight(.bold))
                    .focused($focus)
                TextField("Viết điều bạn muốn giữ lại…", text: $body_, axis: .vertical)
                    .lineLimit(6...30)
                if let error { Text(error).font(.footnote).foregroundStyle(Av.danger) }
                Spacer()
            }
            .padding(20)
            .avScreen()
            .navigationTitle("Ghi chép mới")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lưu") { save() }
                        .fontWeight(.semibold)
                        .disabled(busy || (title.trimmingCharacters(in: .whitespaces).isEmpty && body_.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
            .onAppear { focus = true }
        }
    }

    private func save() {
        guard let me = app.userId else { return }
        busy = true
        Task {
            do {
                let note = try await Repo.createNote(owner: me, title: title.trimmingCharacters(in: .whitespaces), body: body_)
                onCreated(note)
                dismiss()
            } catch {
                self.error = AvError.message(error)
            }
            busy = false
        }
    }
}
