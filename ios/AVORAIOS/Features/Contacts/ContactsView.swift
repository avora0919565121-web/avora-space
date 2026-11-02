import SwiftUI

/// Liên hệ — danh bạ chung với web: tìm, xem, gọi, nhắn (nếu đã kết nối AVORA), thêm mới.
struct ContactsView: View {
    var onMessage: (UUID) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var contacts: [Contact] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?
    @State private var showNew = false

    private var shown: [Contact] {
        guard !query.isEmpty else { return contacts }
        return contacts.filter {
            $0.name.localizedCaseInsensitiveContains(query)
                || ($0.phone ?? "").contains(query)
                || ($0.email ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    private var sections: [(letter: String, items: [Contact])] {
        let dict = Dictionary(grouping: shown) { c -> String in
            let f = c.name.trimmingCharacters(in: .whitespaces).folding(options: .diacriticInsensitive, locale: AvFormat.vi).prefix(1).uppercased()
            return f.isEmpty || !f.first!.isLetter ? "#" : f
        }
        return dict.keys.sorted().map { ($0, dict[$0]!) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    AvErrorBanner(message: error) { Task { await load() } }
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                if loading && contacts.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                } else if shown.isEmpty {
                    AvEmpty(icon: "person.crop.circle", title: query.isEmpty ? "Chưa có liên hệ" : "Không tìm thấy")
                        .listRowBackground(Color.clear)
                }
                ForEach(sections, id: \.letter) { section in
                    Section {
                        ForEach(section.items) { c in
                            NavigationLink(value: c) { ContactRow(contact: c) }
                                .listRowBackground(Av.card)
                        }
                    } header: {
                        Text(section.letter).font(.caption.weight(.bold)).foregroundStyle(Av.muted)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .avScreen()
            .searchable(text: $query, prompt: "Tìm tên, số điện thoại, email")
            .navigationTitle("Liên hệ")
            .navigationDestination(for: Contact.self) { c in
                ContactDetailView(contact: c, onMessage: onMessage)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { showNew = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Thêm liên hệ")
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .sheet(isPresented: $showNew) {
                NewContactSheet { Task { await load() } }
            }
        }
    }

    private func load() async {
        do {
            contacts = try await Repo.contacts()
            error = nil
        } catch {
            self.error = AvError.message(error)
        }
        loading = false
    }
}

private struct ContactRow: View {
    let contact: Contact
    var body: some View {
        HStack(spacing: 12) {
            AvAvatar(name: contact.name, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(contact.name).font(.body.weight(.semibold)).foregroundStyle(Av.ink).lineLimit(1)
                    if contact.linked_user_id != nil {
                        Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(Av.accent)
                    }
                }
                if let sub = contact.phone ?? contact.email {
                    Text(sub).font(.caption).foregroundStyle(Av.muted).lineLimit(1)
                }
            }
        }
    }
}

private struct ContactDetailView: View {
    let contact: Contact
    var onMessage: (UUID) -> Void

    var body: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    AvAvatar(name: contact.name, size: 76)
                    Text(contact.name).font(.title2.weight(.heavy)).foregroundStyle(Av.ink).multilineTextAlignment(.center)
                    if let tag = contact.relationship_tag ?? contact.industry {
                        Text(tag).font(.subheadline).foregroundStyle(Av.muted)
                    }
                    HStack(spacing: 12) {
                        if let linked = contact.linked_user_id {
                            action("Nhắn tin", "bubble.left.fill") { onMessage(linked) }
                        }
                        if let phone = contact.phone, let url = URL(string: "tel:\(phone.filter { $0.isNumber || $0 == "+" })") {
                            Link(destination: url) { actionLabel("Gọi", "phone.fill") }
                        }
                        if let email = contact.email, let url = URL(string: "mailto:\(email)") {
                            Link(destination: url) { actionLabel("Email", "envelope.fill") }
                        }
                    }
                    .padding(.top, 6)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Section {
                if let phone = contact.phone { LabeledContent("Điện thoại", value: phone) }
                if let email = contact.email { LabeledContent("Email", value: email) }
                LabeledContent("Loại", value: contact.isBusiness ? "Doanh nghiệp" : "Cá nhân")
                if contact.linked_user_id != nil { LabeledContent("AVORA", value: "Đã kết nối") }
            }
            .listRowBackground(Av.card)
            if let note = contact.note, !note.isEmpty {
                Section("Ghi chú") { Text(note).foregroundStyle(Av.ink) }
                    .listRowBackground(Av.card)
            }
        }
        .listStyle(.insetGrouped)
        .avScreen()
        .navigationBarTitleDisplayMode(.inline)
    }

    private func action(_ title: String, _ icon: String, run: @escaping () -> Void) -> some View {
        Button(action: run) { actionLabel(title, icon) }.buttonStyle(.plain)
    }

    private func actionLabel(_ title: String, _ icon: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.body).foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Av.accent, in: .circle)
            Text(title).font(.caption).foregroundStyle(Av.ink)
        }
        .frame(minWidth: 64)
    }
}

private struct NewContactSheet: View {
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Họ và tên", text: $name).textContentType(.name)
                    TextField("Số điện thoại", text: $phone).keyboardType(.phonePad).textContentType(.telephoneNumber)
                    TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                }
                .listRowBackground(Av.card)
                Section("Ghi chú") {
                    TextField("Gặp ở đâu, cần nhớ điều gì…", text: $note, axis: .vertical).lineLimit(2...6)
                }
                .listRowBackground(Av.card)
                if let error {
                    Text(error).foregroundStyle(Av.danger).listRowBackground(Color.clear)
                }
            }
            .avScreen()
            .navigationTitle("Liên hệ mới")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lưu", action: save).fontWeight(.semibold)
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func save() {
        busy = true
        func clean(_ s: String) -> String? {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        Task {
            do {
                try await Repo.createContact(name: name.trimmingCharacters(in: .whitespaces), phone: clean(phone), email: clean(email), note: clean(note))
                onSaved()
                dismiss()
            } catch {
                self.error = AvError.message(error)
            }
            busy = false
        }
    }
}
