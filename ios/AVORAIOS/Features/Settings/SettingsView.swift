import SwiftUI

/// Cài đặt: hồ sơ, giao diện (đồng bộ với web qua `profiles.color_scheme`), thông tin, đăng xuất.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var editingName = false
    @State private var confirmSignOut = false
    @State private var error: String?

    private let schemes: [(String, String, String)] = [
        ("device", "Theo máy", "circle.lefthalf.filled"),
        ("light", "Sáng", "sun.max"),
        ("dark", "Tối", "moon"),
    ]

    private var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "\(v) (\(b))"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                AvTabHeader(title: "Cài đặt") { EmptyView() }
                List {
                    if let error {
                        AvErrorBanner(message: error) { self.error = nil }
                            .listRowBackground(Color.clear)
                    }
                    Section {
                        Button { editingName = true } label: {
                            HStack(spacing: 14) {
                                AvAvatar(name: app.displayName, size: 56)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(app.displayName).font(.title3.weight(.bold)).foregroundStyle(Av.ink)
                                    if let email = app.email {
                                        Text(email).font(.subheadline).foregroundStyle(Av.muted)
                                    }
                                }
                                Spacer()
                                Image(systemName: "pencil").foregroundStyle(Av.muted)
                            }
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Sửa tên hiển thị")
                    }
                    .listRowBackground(Av.card)

                    Section {
                        HStack(spacing: 10) {
                            ForEach(schemes, id: \.0) { s in
                                schemeTile(s)
                            }
                        }
                        .padding(.vertical, 6)
                    } header: {
                        AvSectionLabel(title: "Giao diện")
                    } footer: {
                        Text("Đổi ở đây thì web cũng đổi theo.").foregroundStyle(Av.muted)
                    }
                    .listRowBackground(Av.card)

                    Section {
                        Link(destination: WebLinks.settings) {
                            row("Cài đặt nâng cao trên web", icon: "safari")
                        }
                        Link(destination: WebLinks.policy) {
                            row("Chính sách & quyền riêng tư", icon: "hand.raised")
                        }
                        LabeledContent {
                            Text(version).foregroundStyle(Av.muted)
                        } label: {
                            row("Phiên bản", icon: "info.circle", chevron: false)
                        }
                    } header: {
                        AvSectionLabel(title: "Thông tin")
                    }
                    .listRowBackground(Av.card)

                    Section {
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            Text("Đăng xuất").frame(maxWidth: .infinity).fontWeight(.semibold)
                        }
                    }
                    .listRowBackground(Av.card)
                }
                .listStyle(.insetGrouped)
                .avScreen()
            }
            .background(Av.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog("Đăng xuất khỏi AVORA trên máy này?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Đăng xuất", role: .destructive) { Task { await app.signOut() } }
                Button("Huỷ", role: .cancel) {}
            }
            .sheet(isPresented: $editingName) {
                EditNameSheet(initial: app.profile?.display_name ?? "")
                    .presentationDetents([.height(240)])
            }
        }
    }

    private func schemeTile(_ s: (String, String, String)) -> some View {
        let selected = app.colorScheme == s.0
        return Button {
            select(s.0)
        } label: {
            VStack(spacing: 8) {
                Image(systemName: s.2).font(.title3)
                Text(s.1).font(.footnote.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(selected ? Av.accentInk : Av.ink)
            .background(selected ? Av.accentSoft : Av.sand, in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Av.accent : .clear, lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func row(_ title: String, icon: String, chevron: Bool = true) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(Av.accent).frame(width: 24)
            Text(title).foregroundStyle(Av.ink)
            if chevron {
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Av.muted)
            }
        }
    }

    private func select(_ scheme: String) {
        let previous = app.colorScheme
        withAnimation(.snappy) { app.colorScheme = scheme }
        guard let id = app.userId else { return }
        Task {
            do {
                try await Repo.updateColorScheme(id, scheme)
                app.profile?.color_scheme = scheme
            } catch {
                app.colorScheme = previous
                self.error = AvError.message(error)
            }
        }
    }
}

private struct EditNameSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var name: String
    @State private var saving = false
    @State private var error: String?

    init(initial: String) { _name = State(initialValue: initial) }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Tên hiển thị", text: $name)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .onSubmit(save)
                    .padding(14)
                    .background(Av.sand, in: .rect(cornerRadius: 12))
                if let error {
                    Text(error).font(.footnote).foregroundStyle(Av.danger)
                }
                Text("Mọi người trong Kết nối sẽ thấy tên này.").font(.footnote).foregroundStyle(Av.muted)
                Spacer(minLength: 0)
            }
            .padding(20)
            .background(Av.paper.ignoresSafeArea())
            .navigationTitle("Sửa tên")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Huỷ") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lưu", action: save).disabled(trimmed.isEmpty || trimmed.count > 60 || saving)
                }
            }
        }
    }

    private func save() {
        guard let id = app.userId, !trimmed.isEmpty, trimmed.count <= 60 else { return }
        saving = true
        Task {
            defer { saving = false }
            do {
                try await Repo.updateDisplayName(id, trimmed)
                app.profile?.display_name = trimmed
                dismiss()
            } catch {
                self.error = AvError.message(error)
            }
        }
    }
}
