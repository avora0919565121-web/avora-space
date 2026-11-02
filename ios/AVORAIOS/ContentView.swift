import SwiftUI

/// Điểm vào: chờ phiên → đăng nhập hoặc vào app.
struct ContentView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .loading:
                LaunchView()
            case .signedOut:
                SignInView()
                    .transition(.opacity)
            case .signedIn:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: app.phase)
    }
}

private struct LaunchView: View {
    var body: some View {
        ZStack {
            Av.paper.ignoresSafeArea()
            VStack(spacing: 14) {
                AvoraMarkImage(size: 80)
                ProgressView().tint(Av.muted)
            }
        }
    }
}
