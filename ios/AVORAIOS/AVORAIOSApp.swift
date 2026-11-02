import SwiftUI

@main
struct AVORAIOSApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(app)
                .preferredColorScheme(app.preferredScheme)
                .tint(Av.accent)
                .task { app.start() }
        }
    }
}
