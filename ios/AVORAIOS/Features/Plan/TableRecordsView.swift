import SwiftUI

/// Một bàn: các bản ghi xếp theo trạng thái, đổi trạng thái bằng menu, thêm nhanh.
struct TableRecordsView: View {
    let table: ThinkTable
    @Environment(AppModel.self) private var app
    @State private var records: [ThinkRecord] = []
    @State private var loading = true
    @State private var error: String?
    @State private var newTitle = ""
    @State private var adding = false
    @FocusState private var addFocused: Bool

    private var groups: [(key: String, label: String, items: [ThinkRecord])] {
        let options = table.status_options ?? []
        var out: [(key: String, label: String, items: [ThinkRecord])] = options.compactMap { o in
            let items = records.filter { $0.status == o.key }
            return items.isEmpty ? nil : (key: o.key, label: o.label, items: items)
        }
        let known = Set(options.map(\.key))
        let rest = records.filter { !known.contains($0.status ?? "") }
        if !rest.isEmpty { out.append((key: "_", label: options.isEmpty ? "Tất cả" : "Chưa xếp", items: rest)) }
        return out
    }

    var body: some View {
        List {
            if let p = table.purpose, !p.isEmpty {
                Text(p).font(.subheadline).foregroundStyle(Av.muted).listRowBackground(Color.clear)
            }
            Section {
                HStack(spacing: 10) {
                    Image(systemName: "plus.circle.fill").foregroundStyle(Av.accent)
                    TextField("Thêm một dòng…", text: $newTitle)
                        .focused($addFocused)
                        .submitLabel(.done)
                        .onSubmit(add)
                        .disabled(adding)
                }
            }
            .listRowBackground(Av.card)

            if let error { Text(error).foregroundStyle(Av.danger).listRowBackground(Color.clear) }
            if loading && records.isEmpty {
                ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
            } else if records.isEmpty {
                AvEmpty(icon: "tray", title: "Bàn đang trống").listRowBackground(Color.clear)
            }

            ForEach(groups, id: \.key) { g in
                Section {
                    ForEach(g.items) { r in row(r) }
                } header: {
                    AvSectionLabel(title: g.label, count: g.items.count)
                }
                .listRowBackground(Av.card)
            }
        }
        .listStyle(.insetGrouped)
        .avScreen()
        .navigationTitle(table.name)
        .navigationBarTitleDisplayMode(.large)
        .task { await load() }
        .refreshable { await load() }
    }

    private func row(_ r: ThinkRecord) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(r.displayTitle).font(.body).foregroundStyle(Av.ink)
                let extra = [r.next_action_date.flatMap(AvDate.day).map { "Bước tiếp: " + $0.formatted(.dateTime.day().month(.twoDigits).locale(AvFormat.vi)) },
                             r.notes?.split(separator: "\n").first.map(String.init)].compactMap { $0 }
                if !extra.isEmpty {
                    Text(extra.joined(separator: " · ")).font(.caption).foregroundStyle(Av.muted).lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            if let options = table.status_options, !options.isEmpty {
                Menu {
                    ForEach(options, id: \.key) { o in
                        Button {
                            Task { await setStatus(r, o.key) }
                        } label: {
                            if r.status == o.key { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                        }
                    }
                } label: {
                    Text(table.statusLabel(r.status) ?? "Trạng thái")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Av.accentInk)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Av.accentSoft, in: .capsule)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func setStatus(_ r: ThinkRecord, _ key: String) async {
        guard let i = records.firstIndex(where: { $0.id == r.id }) else { return }
        let updated = ThinkRecord(id: r.id, table_id: r.table_id, title: r.title, status: key, priority: r.priority,
                                  next_action_date: r.next_action_date, notes: r.notes, extension_fields: r.extension_fields, updated_at: r.updated_at)
        withAnimation(.snappy) { records[i] = updated }
        do {
            try await Repo.setRecordStatus(r.id, key)
        } catch {
            if let j = records.firstIndex(where: { $0.id == r.id }) { records[j] = r }
            self.error = AvError.message(error)
        }
    }

    private func add() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let me = app.userId else { return }
        adding = true
        Task {
            do {
                let rec = try await Repo.createRecord(table: table.id, owner: me, title: title, status: table.status_options?.first?.key)
                withAnimation(.snappy) { records.insert(rec, at: 0) }
                newTitle = ""
                addFocused = true
            } catch {
                self.error = AvError.message(error)
            }
            adding = false
        }
    }

    private func load() async {
        do {
            records = try await Repo.records(table.id)
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}
