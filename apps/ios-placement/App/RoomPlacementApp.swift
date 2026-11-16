// The app target's only file. Create an iOS App in Xcode (SwiftUI, iOS 16+), add this package as a local
// package dependency, link ARPlacement, replace the generated App file with this one, and add
// NSCameraUsageDescription to the target's Info (see README.md).
import ARPlacement
import SwiftUI

@main
struct RoomPlacementApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

/// Picks which published project to place. The default is the office chair on the deployed site; any
/// `.../projects/<name>/project.json` with a pre-baked `quicklook.usdz` beside it works.
struct RootView: View {
    @State private var projectURL = "https://ar-project-roan.vercel.app/projects/office-chair/project.json"
    @State private var open = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Project") {
                    TextField("https://…/project.json", text: $projectURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Button("Place in your room") { open = true }
                        .disabled(URL(string: projectURL) == nil)
                } footer: {
                    Text("Nothing leaves your phone: the app downloads the model and scans the room on the device only.")
                }
            }
            .navigationTitle("Room placement")
            .navigationDestination(isPresented: $open) {
                if let url = URL(string: projectURL) { PlacementScreen(projectURL: url).navigationBarTitleDisplayMode(.inline) }
            }
        }
    }
}
