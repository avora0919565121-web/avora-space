import SwiftUI
import Supabase

/// Đăng nhập — mật khẩu hoặc mã 6 số gửi qua email (giống web, không tạo tài khoản mới ở đây).
struct SignInView: View {
    private enum Mode { case password, code }
    private enum Field { case email, password, code }

    @State private var mode: Mode = .password
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?
    @FocusState private var focus: Field?

    var body: some View {
        ZStack {
            Av.paper.ignoresSafeArea()
            // Một quầng đất nung rất nhạt để màn có chiều sâu.
            RadialGradient(colors: [Av.accent.opacity(0.16), .clear], center: .topTrailing, startRadius: 10, endRadius: 420)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    form
                    footer
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 32)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear { focus = .email }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            AvoraMarkImage(size: 60)
                .shadow(color: Av.accent.opacity(0.25), radius: 14, y: 6)
            Text("Đăng nhập")
                .font(.system(size: 34, weight: .heavy))
                .foregroundStyle(Av.ink)
            Text("Cùng một tài khoản với AVORA trên web — tin nhắn, nhiệm vụ và kế hoạch đi theo bạn.")
                .font(.subheadline)
                .foregroundStyle(Av.muted)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            field("Email") {
                TextField("minhanh@avora.vn", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(mode == .password ? .next : .send)
                    .onSubmit { mode == .password ? (focus = .password) : sendCode() }
                    .disabled(codeSent)
            }

            if mode == .password {
                field("Mật khẩu") {
                    SecureField("••••••••", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(signIn)
                }
            } else if codeSent {
                field("Mã 6 số trong email") {
                    TextField("000000", text: $code)
                        .textContentType(.oneTimeCode)
                        .keyboardType(.numberPad)
                        .font(.title3.monospacedDigit().weight(.semibold))
                        .focused($focus, equals: .code)
                        .onChange(of: code) { _, v in
                            code = String(v.filter(\.isNumber).prefix(6))
                            if code.count == 6 { verifyCode() }
                        }
                }
            }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(Av.danger)
                    .transition(.opacity)
            }
            if let info {
                Text(info).font(.footnote).foregroundStyle(Av.muted)
            }

            Button(action: primary) {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) }
                    Text(primaryTitle)
                }
            }
            .buttonStyle(AvPrimaryButtonStyle(enabled: canSubmit))
            .disabled(!canSubmit || busy)
            .padding(.top, 4)

            Button {
                withAnimation(.snappy) {
                    mode = mode == .password ? .code : .password
                    error = nil; info = nil; codeSent = false; code = ""
                }
            } label: {
                Text(mode == .password ? "Đăng nhập bằng mã gửi qua email" : "Đăng nhập bằng mật khẩu")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Av.accent)
                    .frame(maxWidth: .infinity)
            }
            .padding(.top, 2)
        }
        .avCard(padding: 18)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Chưa có tài khoản?").font(.footnote).foregroundStyle(Av.muted)
            Link("Đăng ký trên avorachat.com", destination: WebLinks.origin.appending(path: "dang-ky"))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Av.ink)
        }
        .padding(.horizontal, 4)
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Av.ink)
            content()
                .padding(.horizontal, 14)
                .padding(.vertical, 13)
                .background(Av.paper, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Av.border))
        }
    }

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespaces) }

    private var canSubmit: Bool {
        guard trimmedEmail.contains("@") else { return false }
        switch mode {
        case .password: return !password.isEmpty
        case .code: return !codeSent || code.count == 6
        }
    }

    private var primaryTitle: String {
        switch mode {
        case .password: return "Đăng nhập"
        case .code: return codeSent ? "Xác nhận mã" : "Gửi mã"
        }
    }

    private func primary() {
        switch mode {
        case .password: signIn()
        case .code: codeSent ? verifyCode() : sendCode()
        }
    }

    private func signIn() {
        guard canSubmit, !busy else { return }
        run {
            _ = try await Backend.client.auth.signIn(email: trimmedEmail, password: password)
        }
    }

    private func sendCode() {
        guard trimmedEmail.contains("@"), !busy else { return }
        run {
            try await Backend.client.auth.signInWithOTP(email: trimmedEmail, shouldCreateUser: false)
            codeSent = true
            info = "Nếu email có tài khoản AVORA, mã sẽ đến trong ít phút."
            focus = .code
        }
    }

    private func verifyCode() {
        guard code.count == 6, !busy else { return }
        run(failure: "Mã chưa đúng hoặc đã hết hạn.") {
            _ = try await Backend.client.auth.verifyOTP(email: trimmedEmail, token: code, type: .email)
        }
    }

    private func run(failure: String? = nil, _ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do {
                try await work()
            } catch {
                let msg = AvError.message(error)
                withAnimation { self.error = failure ?? msg }
            }
            busy = false
        }
    }
}
