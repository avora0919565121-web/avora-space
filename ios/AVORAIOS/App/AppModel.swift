import SwiftUI
import Supabase

/// Trạng thái toàn app: phiên đăng nhập, hồ sơ, giao diện, Avora Space.
@Observable
final class AppModel {
    enum Phase: Equatable { case loading, signedOut, signedIn(UUID) }

    var phase: Phase = .loading
    var profile: Profile?
    var email: String?
    var showSpace = false
    var selectedTab: MainTab = .connect

    /// "device" | "light" | "dark" — cùng giá trị cột `profiles.color_scheme` của web.
    var colorScheme: String = UserDefaults.standard.string(forKey: "avora.colorScheme") ?? "device" {
        didSet { UserDefaults.standard.set(colorScheme, forKey: "avora.colorScheme") }
    }

    var preferredScheme: ColorScheme? {
        switch colorScheme {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    var userId: UUID? {
        if case .signedIn(let id) = phase { return id }
        return nil
    }

    var displayName: String {
        if let n = profile?.display_name, !n.isEmpty { return n }
        return email?.components(separatedBy: "@").first ?? "bạn"
    }

    private var listenTask: Task<Void, Never>?

    func start() {
        guard listenTask == nil else { return }
        guard Backend.isConfigured else { phase = .signedOut; return }
        listenTask = Task { [weak self] in
            for await (event, session) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                switch event {
                case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                    if let session, !session.isExpired {
                        await self.enter(session)
                    } else if event == .initialSession {
                        // Phiên cũ hết hạn: thử làm mới một lần trước khi về màn đăng nhập.
                        if let fresh = try? await Backend.client.auth.refreshSession() {
                            await self.enter(fresh)
                        } else {
                            self.phase = .signedOut
                        }
                    }
                case .signedOut, .userDeleted:
                    self.profile = nil
                    self.phase = .signedOut
                default:
                    break
                }
            }
        }
    }

    private func enter(_ session: Session) async {
        let id = session.user.id
        email = session.user.email
        if phase != .signedIn(id) {
            phase = .signedIn(id)
            showSpace = true
        }
        if let p = try? await Repo.profile(id) {
            profile = p
            if let scheme = p.color_scheme, ["device", "light", "dark"].contains(scheme) {
                colorScheme = scheme
            }
        }
    }

    func reloadProfile() async {
        guard let id = userId, let p = try? await Repo.profile(id) else { return }
        profile = p
    }

    func signOut() async {
        await Repo.vaultLock()
        try? await Backend.client.auth.signOut(scope: .local)
        profile = nil
        selectedTab = .connect
        phase = .signedOut
    }
}

enum MainTab: Hashable {
    case connect, tasks, plan, vault, settings
}
