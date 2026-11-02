import SwiftUI

/// Két sắt — Tài chính mở bằng mã 6 số (`vault_unlock`); các ngăn mã hoá đầu-cuối mở trên web.
struct VaultView: View {
    enum Sub: Hashable { case finance, passwords, certificates, documents, assets }

    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase
    @State private var sub: Sub = .finance
    @State private var status: VaultStatus?
    @State private var unlocked = false
    @State private var checking = true

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                AvTabHeader(title: "Két sắt") {
                    if unlocked {
                        Button {
                            Task { await lock() }
                        } label: { Image(systemName: "lock") }
                            .buttonStyle(AvRoundButtonStyle())
                            .accessibilityLabel("Khoá Két sắt")
                    }
                }
                UnderlineTabs(
                    tabs: [(Sub.finance, "Tài chính", nil), (Sub.passwords, "Mật khẩu", nil), (Sub.certificates, "Chứng chỉ", nil),
                           (Sub.documents, "Tài liệu", nil), (Sub.assets, "Tài sản", nil)],
                    selection: $sub
                )
                Group {
                    if sub != .finance {
                        EncryptedOnWebCard(sub: sub)
                    } else if checking {
                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if status?.has_code == false {
                        NoCodeCard()
                    } else if unlocked {
                        FinanceView()
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    } else {
                        VaultKeypad(status: status) { await refresh() }
                            .transition(.opacity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(Av.paper.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
        .task { await refresh() }
        .onChange(of: scenePhase) { _, phase in
            // Rời app thì khoá lại — giống web khi đóng thẻ.
            if phase == .background, unlocked { Task { await lock() } }
        }
        .animation(.snappy, value: unlocked)
    }

    private func refresh() async {
        if let s = try? await Repo.vaultStatus() {
            status = s
            unlocked = s.unlocked == true
        }
        checking = false
    }

    private func lock() async {
        await Repo.vaultLock()
        unlocked = false
        await refresh()
    }
}

/// Bàn phím mã 6 số — giống màn "Két sắt đang khoá" của web.
private struct VaultKeypad: View {
    let status: VaultStatus?
    var onUnlocked: () async -> Void

    @State private var code = ""
    @State private var busy = false
    @State private var message: String?
    @State private var shake = 0
    @State private var waitUntil: Date?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Spacer(minLength: 24)
                Image(systemName: "lock")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Av.ink)
                    .frame(width: 56, height: 56)
                    .background(Av.card, in: .rect(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.06), radius: 8, y: 3)
                VStack(spacing: 6) {
                    Text("Két sắt đang khoá").font(.title2.weight(.heavy)).foregroundStyle(Av.ink)
                    Text(message ?? "Nhập mã Két sắt 6 số")
                        .font(.subheadline)
                        .foregroundStyle(message == nil ? Av.muted : Av.danger)
                        .multilineTextAlignment(.center)
                }
                HStack(spacing: 14) {
                    ForEach(0..<6, id: \.self) { i in
                        Circle()
                            .fill(i < code.count ? Av.ink : .clear)
                            .overlay(Circle().strokeBorder(i < code.count ? Av.ink : Av.muted.opacity(0.5), lineWidth: 1.2))
                            .frame(width: 13, height: 13)
                            .scaleEffect(i == code.count - 1 ? 1.15 : 1)
                            .animation(.snappy(duration: 0.15), value: code.count)
                    }
                }
                .modifier(Shake(trigger: shake))
                .padding(.vertical, 6)

                let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(74), spacing: 18), count: 3), spacing: 14) {
                    ForEach(keys.indices, id: \.self) { i in
                        key(keys[i])
                    }
                }
                .disabled(busy || isWaiting)
                .opacity(isWaiting ? 0.5 : 1)

                Link("Quên mã 6 số?", destination: WebLinks.origin.appending(path: "ket-sat"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Av.accent)
                    .padding(.top, 6)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 24)
        }
        .background {
            RadialGradient(colors: [Av.accentSoft.opacity(0.7), .clear], center: .top, startRadius: 10, endRadius: 320)
                .ignoresSafeArea()
        }
        .sensoryFeedback(.error, trigger: shake)
        .onAppear {
            if let lu = status?.locked_until.flatMap(AvDate.parse), lu > Date() { waitUntil = lu; message = waitText(lu) }
        }
    }

    private var isWaiting: Bool { (waitUntil ?? .distantPast) > Date() }

    @ViewBuilder
    private func key(_ k: String) -> some View {
        if k.isEmpty {
            Color.clear.frame(width: 74, height: 74)
        } else {
            Button {
                tap(k)
            } label: {
                Group {
                    if k == "⌫" {
                        Image(systemName: "delete.left").font(.title3).foregroundStyle(Av.muted)
                    } else {
                        Text(k).font(.system(size: 28, weight: .regular)).foregroundStyle(Av.ink)
                    }
                }
                .frame(width: 74, height: 74)
                .background(k == "⌫" ? Color.clear : Av.sand, in: .circle)
            }
            .buttonStyle(KeyStyle())
            .sensoryFeedback(.impact(weight: .light), trigger: code)
        }
    }

    private func tap(_ k: String) {
        if k == "⌫" {
            if !code.isEmpty { code.removeLast() }
            return
        }
        guard code.count < 6 else { return }
        code.append(k)
        if code.count == 6 { submit() }
    }

    private func submit() {
        busy = true
        let attempt = code
        Task {
            defer { busy = false }
            do {
                let r = try await Repo.vaultUnlock(attempt)
                if r.ok == true {
                    message = nil
                    await onUnlocked()
                    return
                }
                code = ""
                withAnimation(.linear(duration: 0.4)) { shake += 1 }
                switch r.reason {
                case "wait":
                    let until = r.locked_until.flatMap(AvDate.parse) ?? Date().addingTimeInterval(60)
                    waitUntil = until
                    message = waitText(until)
                case "expired":
                    message = "Mã đã hết hạn. Đặt lại mã trên web."
                default:
                    let left = r.remaining ?? 0
                    message = left > 0 ? "Sai mã. Còn \(left) lần thử." : "Sai mã."
                }
            } catch {
                code = ""
                withAnimation(.linear(duration: 0.4)) { shake += 1 }
                let text = String(describing: error)
                message = text.contains("device_not_allowed")
                    ? "Thiết bị này chưa được phép mở Két sắt. Cho phép trong Cài đặt trên web."
                    : AvError.message(error)
            }
        }
    }

    private func waitText(_ until: Date) -> String {
        "Thử sai nhiều lần. Thử lại sau \(AvFormat.time(until))."
    }
}

private struct KeyStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(.snappy(duration: 0.12), value: configuration.isPressed)
    }
}

private struct Shake: GeometryEffect {
    var trigger: Int
    var animatableData: CGFloat
    init(trigger: Int) {
        self.trigger = trigger
        self.animatableData = CGFloat(trigger)
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: 9 * sin(animatableData * .pi * 4), y: 0))
    }
}

private struct NoCodeCard: View {
    var body: some View {
        VStack(spacing: 14) {
            AvEmpty(icon: "lock.open", title: "Chưa đặt mã Két sắt", message: "Đặt mã 6 số trên web một lần, rồi mở Tài chính ở đây bằng mã đó.")
            Link("Mở Két sắt trên web", destination: WebLinks.origin.appending(path: "ket-sat"))
                .buttonStyle(AvPrimaryButtonStyle())
                .padding(.horizontal, 32)
        }
        .frame(maxHeight: .infinity)
    }
}

/// Ngăn mã hoá đầu-cuối: khoá giải mã chỉ có trên thiết bị đã gắn, nên nói rõ thay vì giả.
private struct EncryptedOnWebCard: View {
    let sub: VaultView.Sub

    private var info: (String, String, String) {
        switch sub {
        case .passwords: return ("key", "Mật khẩu", "tài khoản và mật khẩu")
        case .certificates: return ("rosette", "Chứng chỉ", "bằng cấp, chứng chỉ")
        case .documents: return ("doc.text", "Tài liệu", "giấy tờ và tệp quan trọng")
        default: return ("shippingbox", "Tài sản", "tài sản và giấy tờ sở hữu")
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: info.0)
                    .font(.title2)
                    .foregroundStyle(Av.accentInk)
                    .frame(width: 52, height: 52)
                    .background(Av.accentSoft, in: .rect(cornerRadius: 14))
                Text("\(info.1) được mã hoá đầu-cuối")
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(Av.ink)
                Text("Ngăn này giữ \(info.2). Khoá giải mã chỉ nằm trên thiết bị bạn đã gắn — máy chủ AVORA không đọc được. Bản iOS đầu tiên chưa mang khoá này, nên ngăn chỉ mở trên web.")
                    .font(.subheadline)
                    .foregroundStyle(Av.muted)
                Link(destination: WebLinks.origin.appending(path: "ket-sat")) {
                    Label("Mở trên avorachat.com", systemImage: "safari")
                }
                .buttonStyle(AvPrimaryButtonStyle())
                .padding(.top, 4)
            }
            .avCard(padding: 20)
            .padding(16)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
    }
}
