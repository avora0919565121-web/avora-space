import SwiftUI

/// Năm tab như thanh đáy của web; Avora Space mở từ chữ "A" ở góc mỗi tab.
struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @State private var unread = 0

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            Tab("Kết nối", systemImage: "bubble.left.and.bubble.right", value: MainTab.connect) {
                ConnectView(unread: $unread)
            }
            .badge(unread)

            Tab("Nhiệm vụ", systemImage: "checkmark.circle", value: MainTab.tasks) {
                TasksView()
            }

            Tab("Kế hoạch", systemImage: "square.grid.2x2", value: MainTab.plan) {
                PlanView()
            }

            Tab("Két sắt", systemImage: "lock.shield", value: MainTab.vault) {
                VaultView()
            }

            Tab("Cài đặt", systemImage: "gearshape", value: MainTab.settings) {
                SettingsView()
            }
        }
        .sensoryFeedback(.selection, trigger: app.selectedTab)
        .sheet(isPresented: $app.showSpace) {
            SpaceView()
                .presentationDragIndicator(.visible)
        }
    }
}
