#if canImport(ARKit) && os(iOS)
import ARKit
import Combine
import PlacementCore
import RealityKit
import SwiftUI

/// The native room-placement screen: camera view, scanned surfaces, the piece as a ghost with a green or
/// red footprint, and tap / drag / two-finger turn to position it. Mirrors the web page's rules: real
/// size, move and turn only, never resize.
public struct PlacementScreen: View {
    @StateObject private var model: PlacementViewModel
    @State private var placement: Placement?

    public init(projectURL: URL) {
        _model = StateObject(wrappedValue: PlacementViewModel(projectURL: projectURL))
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            if case .unsupported = model.scanner.capability {
                Color.black.ignoresSafeArea()
            } else {
                ARViewContainer(model: model, placement: $placement).ignoresSafeArea()
            }
            VStack(spacing: 10) {
                Text(model.scanner.capability.summary)
                    .font(.footnote)
                    .padding(8)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                Text(model.statusText)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                buttons
            }
            .foregroundStyle(.white)
            .padding()
        }
        .task { await model.load() }
        .onReceive(model.scanner.$planes) { planes in model.floorChanged(known: planes.values.contains(where: \.supportsFurniture)) }
    }

    @ViewBuilder private var buttons: some View {
        HStack(spacing: 12) {
            switch model.phase {
            case .previewing(let verdict):
                Button("Confirm") { model.confirm() }.buttonStyle(.borderedProminent).disabled(!verdict.isOK)
                Button("Remove") { placement = nil; model.clear() }.buttonStyle(.bordered)
            case .placed:
                Button("Move") { if let placement { model.unlock(placement) } }.buttonStyle(.borderedProminent)
                Button("Remove") { placement = nil; model.clear() }.buttonStyle(.bordered)
            case .loadFailed:
                Button("Try again") { Task { await model.load() } }.buttonStyle(.borderedProminent)
            default:
                EmptyView()
            }
            if case .cameraDenied = model.scanner.state, let settings = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: settings).buttonStyle(.bordered)
            }
            if model.scanner.state != .idle, model.scanner.state != .cameraDenied {
                Button("Reset scan") { placement = nil; model.clear(); ResetRequest.shared.fire() }.buttonStyle(.bordered)
            }
        }
        .controlSize(.large)
    }
}

/// A tiny signal from the SwiftUI buttons to the AR view, which owns the session.
final class ResetRequest: ObservableObject {
    static let shared = ResetRequest()
    @Published var count = 0
    func fire() { count += 1 }
}

struct ARViewContainer: UIViewRepresentable {
    @ObservedObject var model: PlacementViewModel
    @Binding var placement: Placement?

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        context.coordinator.view = view
        if model.scanner.capability == .lidarMesh {
            // Show the scanned mesh so people see what has (and has not) been scanned, and let real
            // objects hide the piece: honest feedback about what the checker knows.
            view.debugOptions.insert(.showSceneUnderstanding)
            view.environment.sceneUnderstanding.options.insert(.occlusion)
        }
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap)))
        view.addGestureRecognizer(UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan)))
        view.addGestureRecognizer(UIRotationGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.rotate)))
        Task { await model.scanner.start(view.session) }
        return view
    }

    func updateUIView(_ view: ARView, context: Context) {
        context.coordinator.parent = self // fresh bindings for this render
        context.coordinator.sync()
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: ARViewContainer
        weak var view: ARView?
        private var anchor: AnchorEntity?
        private var ghost: ModelEntity?
        private var footprintMarker: ModelEntity?
        private var yawAtGestureStart: Double = 0
        private var resetObserver: AnyObject?

        init(_ parent: ARViewContainer) {
            self.parent = parent
            super.init()
            resetObserver = ResetRequest.shared.$count.dropFirst().sink { [weak self] _ in self?.reset() }
        }

        private var locked: Bool { parent.model.phase == .placed }

        /// Keeps the scene in step with the view model: builds the ghost once the model loads, removes it on
        /// Remove, and colours the footprint by the verdict.
        func sync() {
            guard let view else { return }
            if ghost == nil, let loaded = parent.model.model, let footprint = parent.model.footprint {
                let ghost = loaded.clone(recursive: true)
                let marker = ModelEntity(
                    mesh: .generatePlane(width: Float(footprint.width) + 0.04, depth: Float(footprint.depth) + 0.04),
                    materials: [UnlitMaterial(color: .green.withAlphaComponent(0.35))]
                )
                marker.position.y = 0.005
                let anchor = AnchorEntity(world: .zero)
                anchor.addChild(ghost)
                anchor.addChild(marker)
                anchor.isEnabled = false
                view.scene.addAnchor(anchor)
                self.anchor = anchor
                self.ghost = ghost
                footprintMarker = marker
            }
            guard let anchor else { return }
            switch parent.model.phase {
            case .previewing(let verdict):
                anchor.isEnabled = true
                footprintMarker?.model?.materials = [UnlitMaterial(color: (verdict.isOK ? UIColor.green : UIColor.red).withAlphaComponent(0.35))]
            case .placed:
                anchor.isEnabled = true
                footprintMarker?.isEnabled = false
            default:
                anchor.isEnabled = false
            }
            if case .previewing = parent.model.phase { footprintMarker?.isEnabled = true }
        }

        private func reset() {
            guard let view else { return }
            parent.model.scanner.reset(view.session)
        }

        /// The floor point under a screen location: a detected plane's actual extent first, then ARKit's
        /// estimate (useful before the floor plane has grown to the spot). Nil off the floor.
        private func floorPoint(at point: CGPoint) -> Vec3? {
            guard let view else { return nil }
            let hit = view.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .horizontal).first
                ?? view.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal).first
            guard let hit else { return nil }
            let t = hit.worldTransform.columns.3
            return Vec3(Double(t.x), Double(t.y), Double(t.z))
        }

        /// Turn about the vertical so the piece's front (+Z) faces the camera.
        private func yawFacingCamera(from position: Vec3) -> Double {
            guard let camera = view?.cameraTransform.translation else { return 0 }
            return atan2(Double(camera.x) - position.x, Double(camera.z) - position.z)
        }

        private func move(to position: Vec3, yaw: Double) {
            let placement = Placement(position: position, yaw: yaw)
            parent.placement = placement
            anchor?.transform = Transform(
                scale: .one,
                rotation: simd_quatf(angle: Float(yaw), axis: SIMD3<Float>(0, 1, 0)),
                translation: position.simd
            )
            parent.model.preview(placement)
        }

        @objc func tap(_ gesture: UITapGestureRecognizer) {
            guard !locked, ghost != nil, let view, parent.model.scanner.hasFloor || parent.placement != nil else { return }
            guard let point = floorPoint(at: gesture.location(in: view)) else { return }
            move(to: point, yaw: parent.placement?.yaw ?? yawFacingCamera(from: point))
        }

        @objc func pan(_ gesture: UIPanGestureRecognizer) {
            guard !locked, let view, let current = parent.placement else { return }
            guard let point = floorPoint(at: gesture.location(in: view)) else { return }
            move(to: point, yaw: current.yaw)
        }

        @objc func rotate(_ gesture: UIRotationGestureRecognizer) {
            guard !locked, let current = parent.placement else { return }
            if gesture.state == .began { yawAtGestureStart = current.yaw }
            // Screen rotation is clockwise-positive; a turn about +Y is counter-clockwise from above.
            move(to: current.position, yaw: yawAtGestureStart - Double(gesture.rotation))
        }
    }
}
#endif
