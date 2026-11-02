import SwiftUI

/// Kế hoạch — Kệ sách (đọc tiếp, theo trạng thái) và các Bàn (bảng suy nghĩ → bản ghi).
struct PlanView: View {
    enum Face: Hashable { case shelf, tables }

    @Environment(AppModel.self) private var app
    @State private var face: Face = .shelf
    @State private var shelf: ThinkTable?
    @State private var books: [ThinkRecord] = []
    @State private var reading: [UUID: ReadingState] = [:]
    @State private var tables: [ThinkTable] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                AvTabHeader(title: "Kế hoạch")
                HStack {
                    FacePills(selection: $face)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .overlay(alignment: .bottom) { Rectangle().fill(Av.border).frame(height: 1) }

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if let error {
                            AvErrorBanner(message: error) { Task { await load() } }.padding(.horizontal, -16)
                        }
                        if loading && books.isEmpty && tables.isEmpty {
                            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                        } else if face == .shelf {
                            shelfContent
                        } else {
                            tablesContent
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 820)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await load() }
            }
            .background(Av.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: ThinkRecord.self) { book in
                if let shelf {
                    BookDetailView(book: book, shelf: shelf, state: reading[book.id]) { updated in
                        if let i = books.firstIndex(where: { $0.id == updated.id }) { books[i] = updated }
                    }
                    .toolbar(.visible, for: .navigationBar)
                }
            }
            .navigationDestination(for: ThinkTable.self) { table in
                TableRecordsView(table: table).toolbar(.visible, for: .navigationBar)
            }
        }
        .task { await load() }
    }

    // MARK: Kệ sách

    private var continueBook: ThinkRecord? {
        guard let latest = reading.values.max(by: { $0.updated_at < $1.updated_at }) else { return nil }
        return books.first { $0.id == latest.record_id }
    }

    @ViewBuilder
    private var shelfContent: some View {
        if let book = continueBook {
            NavigationLink(value: book) {
                ContinueReadingCard(book: book, state: reading[book.id], author: author(book))
            }
            .buttonStyle(.plain)
        }
        if books.isEmpty {
            AvEmpty(icon: "books.vertical", title: "Kệ sách đang trống", message: "Thêm sách trên web, rồi đọc tiếp ở đây.")
        }
        ForEach(statusGroups, id: \.key) { group in
            VStack(alignment: .leading, spacing: 10) {
                AvSectionLabel(title: group.label, count: group.items.count)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 140), spacing: 14, alignment: .top)], alignment: .leading, spacing: 18) {
                    ForEach(group.items) { book in
                        NavigationLink(value: book) {
                            VStack(alignment: .leading, spacing: 6) {
                                BookCover(title: book.displayTitle, size: CGSize(width: 104, height: 150))
                                if let p = reading[book.id]?.percent, p > 0 {
                                    ProgressView(value: min(p / 100, 1)).tint(Av.accent)
                                }
                                Text(book.displayTitle).font(.footnote.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(2)
                                if let a = author(book) {
                                    Text(a).font(.caption2).foregroundStyle(Av.muted).lineLimit(1)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var statusGroups: [(key: String, label: String, items: [ThinkRecord])] {
        let options = shelf?.status_options ?? []
        var result: [(String, String, [ThinkRecord])] = []
        // Đang đọc lên đầu, rồi theo thứ tự trạng thái của kệ.
        let ordered = options.sorted { a, b in (a.key == "dang_doc" ? 0 : 1) < (b.key == "dang_doc" ? 0 : 1) }
        for o in ordered {
            let items = books.filter { $0.status == o.key }
            if !items.isEmpty { result.append((o.key, o.label, items)) }
        }
        let known = Set(options.map(\.key))
        let other = books.filter { !known.contains($0.status ?? "") }
        if !other.isEmpty { result.append(("_", "Khác", other)) }
        return result.map { (key: $0.0, label: $0.1, items: $0.2) }
    }

    private func author(_ book: ThinkRecord) -> String? {
        guard let key = shelf?.column(labelled: "Tác giả") else { return nil }
        return book.extension_fields?[key]?.text
    }

    // MARK: Bàn

    private var userTables: [ThinkTable] { tables.filter { !$0.isBookshelf } }

    @ViewBuilder
    private var tablesContent: some View {
        Text("Điều gì còn chưa thông suốt?").font(.subheadline).foregroundStyle(Av.muted)
        if userTables.isEmpty {
            AvEmpty(icon: "square.grid.2x2", title: "Chưa có bàn nào", message: "Tạo bàn trên web để theo dõi điều bạn đang nghĩ.")
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
            ForEach(userTables) { t in
                NavigationLink(value: t) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "tablecells")
                            .foregroundStyle(Av.accentInk)
                            .frame(width: 36, height: 36)
                            .background(Av.accentSoft, in: .rect(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(t.name).font(.body.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(2)
                            if let p = t.purpose, !p.isEmpty {
                                Text(p).font(.caption).foregroundStyle(Av.muted).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Av.muted)
                    }
                    .avCard(padding: 14)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Tải

    private func load() async {
        do {
            async let s = Repo.ensureBookshelf()
            async let t = Repo.tables()
            async let r = Repo.readingStates()
            let shelfTable = try await s
            shelf = shelfTable
            tables = (try? await t) ?? tables
            let states = (try? await r) ?? []
            reading = Dictionary(states.map { ($0.record_id, $0) }, uniquingKeysWith: { a, b in a.updated_at > b.updated_at ? a : b })
            books = try await Repo.records(shelfTable.id)
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}

private struct FacePills: View {
    @Binding var selection: PlanView.Face
    @Namespace private var ns
    var body: some View {
        HStack(spacing: 2) {
            pill("Kệ sách", .shelf)
            pill("Bàn", .tables)
        }
        .padding(3)
        .background(Av.sand, in: .capsule)
    }

    private func pill(_ title: String, _ face: PlanView.Face) -> some View {
        Button {
            withAnimation(.snappy(duration: 0.25)) { selection = face }
        } label: {
            Text(title)
                .font(.subheadline.weight(selection == face ? .bold : .medium))
                .foregroundStyle(selection == face ? Av.ink : Av.muted)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background {
                    if selection == face {
                        Capsule().fill(Av.card).shadow(color: .black.opacity(0.06), radius: 2, y: 1)
                            .matchedGeometryEffect(id: "pill", in: ns)
                    }
                }
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Bìa chữ — màu ổn định theo tên sách, chữ serif như gáy sách in.
struct BookCover: View {
    let title: String
    var size: CGSize

    private static let palettes: [(Color, Color)] = [
        (Color(red: 0.55, green: 0.24, blue: 0.16), Color(red: 0.78, green: 0.40, blue: 0.24)),
        (Color(red: 0.16, green: 0.27, blue: 0.30), Color(red: 0.29, green: 0.45, blue: 0.47)),
        (Color(red: 0.30, green: 0.26, blue: 0.20), Color(red: 0.55, green: 0.47, blue: 0.34)),
        (Color(red: 0.22, green: 0.20, blue: 0.33), Color(red: 0.42, green: 0.36, blue: 0.55)),
        (Color(red: 0.20, green: 0.32, blue: 0.22), Color(red: 0.38, green: 0.52, blue: 0.36)),
    ]

    var body: some View {
        let p = Self.palettes[abs(title.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }) % Self.palettes.count]
        ZStack(alignment: .bottomLeading) {
            LinearGradient(colors: [p.1, p.0], startPoint: .topLeading, endPoint: .bottomTrailing)
            Rectangle().fill(.black.opacity(0.18)).frame(width: 5).frame(maxHeight: .infinity, alignment: .leading)
            Text(title)
                .font(.system(size: max(10, size.width * 0.12), weight: .semibold, design: .serif))
                .foregroundStyle(.white.opacity(0.95))
                .lineLimit(4)
                .padding(size.width * 0.1)
                .padding(.leading, 4)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(.rect(cornerRadius: 6))
        .shadow(color: .black.opacity(0.18), radius: 6, x: 2, y: 4)
    }
}

private struct ContinueReadingCard: View {
    let book: ThinkRecord
    let state: ReadingState?
    let author: String?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            BookCover(title: book.displayTitle, size: CGSize(width: 84, height: 122))
            VStack(alignment: .leading, spacing: 6) {
                Text("ĐỌC TIẾP").font(.caption2.weight(.bold)).tracking(1).foregroundStyle(Av.muted)
                Text(book.displayTitle).font(.headline).foregroundStyle(Av.ink).lineLimit(2)
                Text([author, state?.percent.map { "\(Int($0))%" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Av.muted)
                if let p = state?.percent {
                    ProgressView(value: min(p / 100, 1)).tint(Av.accent)
                }
                Label("Đọc tiếp", systemImage: "book")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Av.accent, in: .rect(cornerRadius: 10))
                    .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .avCard()
    }
}

/// Một cuốn sách: trạng thái, tiến độ, các cột của kệ.
private struct BookDetailView: View {
    let shelf: ThinkTable
    let state: ReadingState?
    var onChange: (ThinkRecord) -> Void
    @State private var book: ThinkRecord
    @State private var error: String?

    init(book: ThinkRecord, shelf: ThinkTable, state: ReadingState?, onChange: @escaping (ThinkRecord) -> Void) {
        self.shelf = shelf
        self.state = state
        self.onChange = onChange
        _book = State(initialValue: book)
    }

    var body: some View {
        List {
            Section {
                HStack(alignment: .top, spacing: 16) {
                    BookCover(title: book.displayTitle, size: CGSize(width: 96, height: 140))
                    VStack(alignment: .leading, spacing: 8) {
                        Text(book.displayTitle).font(.title3.weight(.heavy)).foregroundStyle(Av.ink)
                        if let p = state?.percent {
                            ProgressView(value: min(p / 100, 1)).tint(Av.accent)
                            Text("Đã đọc \(Int(p))%" + (state?.locator.map { " · \($0)" } ?? ""))
                                .font(.caption).foregroundStyle(Av.muted).lineLimit(2)
                        }
                    }
                }
                .listRowBackground(Color.clear)
            }
            Section("Trạng thái") {
                Picker("Trạng thái", selection: Binding(get: { book.status ?? "" }, set: { setStatus($0) })) {
                    ForEach(shelf.status_options ?? [], id: \.key) { o in Text(o.label).tag(o.key) }
                }
                .pickerStyle(.menu)
                .tint(Av.accent)
            }
            .listRowBackground(Av.card)
            let fields = (shelf.column_defs ?? []).compactMap { def -> (String, String)? in
                guard let v = book.extension_fields?[def.key]?.text else { return nil }
                return (def.label ?? def.key, v)
            }
            if !fields.isEmpty {
                Section("Thông tin") {
                    ForEach(fields, id: \.0) { f in
                        if f.1.hasPrefix("http"), let url = URL(string: f.1) {
                            LabeledContent(f.0) { Link("Mở", destination: url).foregroundStyle(Av.accent) }
                        } else {
                            LabeledContent(f.0, value: f.1)
                        }
                    }
                }
                .listRowBackground(Av.card)
            }
            if let notes = book.notes, !notes.isEmpty {
                Section("Ghi chú") { Text(notes) }.listRowBackground(Av.card)
            }
            Section {
                Link(destination: WebLinks.origin.appending(path: "ke-hoach")) {
                    Label("Đọc trong trình đọc AVORA trên web", systemImage: "safari")
                }
                .foregroundStyle(Av.accent)
            } footer: {
                Text("Trình đọc sách và Ghi chép sách đồng bộ tiến độ với iOS.")
            }
            .listRowBackground(Av.card)
            if let error { Text(error).foregroundStyle(Av.danger).listRowBackground(Color.clear) }
        }
        .listStyle(.insetGrouped)
        .avScreen()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func setStatus(_ key: String) {
        let old = book
        book = ThinkRecord(id: book.id, table_id: book.table_id, title: book.title, status: key, priority: book.priority,
                           next_action_date: book.next_action_date, notes: book.notes, extension_fields: book.extension_fields, updated_at: book.updated_at)
        Task {
            do {
                try await Repo.setRecordStatus(book.id, key)
                onChange(book)
            } catch {
                book = old
                self.error = AvError.message(error)
            }
        }
    }
}
