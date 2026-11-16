#if canImport(ARKit) && os(iOS)
import Combine
import Foundation
import PlacementCore
import RealityKit

public enum PlacementPhase: Equatable {
    case loading
    case loadFailed(String)
    /// The project is valid but this app cannot do it (wall pieces, for now).
    case unsupportedProject(String)
    /// Model ready; waiting for a floor to be scanned.
    case scanning
    /// A floor is known: tap to put the piece down.
    case ready
    /// The piece is shown at the last tap, with the checker's verdict. Drag to move, two fingers to turn.
    case previewing(PlacementVerdict)
    /// Confirmed: gestures off until "Move" is tapped.
    case placed
}

/// Loads the published project and its real-size USDZ, and asks `PlacementChecker` about each spot.
/// Downloads go to the app's temporary folder and nothing is uploaded or logged.
public final class PlacementViewModel: ObservableObject {
    @Published public private(set) var phase: PlacementPhase = .loading
    @Published public private(set) var project: ProjectDocument?
    @Published public private(set) var footprint: Footprint?
    /// The loaded model, with its bottom centre at the origin so a floor hit is where it stands.
    public private(set) var model: ModelEntity?
    public let scanner = RoomScanner()
    public let projectURL: URL
    private let checker = PlacementChecker()
    private var forwarding: AnyCancellable?

    public init(projectURL: URL) {
        self.projectURL = projectURL
        // The screen observes this object only; pass the scanner's changes (state, surfaces) through.
        forwarding = scanner.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    @MainActor
    public func load() async {
        phase = .loading
        do {
            let (projectData, projectResponse) = try await URLSession.shared.data(from: projectURL)
            try Self.require(projectResponse, "project file")
            let document = try ProjectDocument.parse(projectData)
            project = document
            guard document.surface == .floor else {
                phase = .unsupportedProject("\"\(document.name)\" is a wall piece. This app places floor furniture; open the web page for wall pieces.")
                return
            }
            let usdzURL = ProjectDocument.usdzURL(nextTo: projectURL)
            let (fileURL, usdzResponse) = try await URLSession.shared.download(from: usdzURL)
            try Self.require(usdzResponse, "AR model (quicklook.usdz)")
            // RealityKit loads by file extension, so the temp file needs the .usdz name.
            let localURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(document.id).usdz")
            try? FileManager.default.removeItem(at: localURL)
            try FileManager.default.moveItem(at: fileURL, to: localURL)
            let entity = try await ModelEntity(contentsOf: localURL)
            let bounds = entity.visualBounds(relativeTo: nil)
            let extents = bounds.extents
            // Stand it on its bottom centre: the pipeline already bakes real size (metres), so no scaling.
            entity.position = SIMD3<Float>(-bounds.center.x, -bounds.min.y, -bounds.center.z)
            model = entity
            footprint = Footprint(width: Double(extents.x), depth: Double(extents.z), height: Double(extents.y))
            phase = .scanning
        } catch {
            phase = .loadFailed(error.localizedDescription)
        }
    }

    private static func require(_ response: URLResponse, _ what: String) throws {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw NSError(domain: "RoomPlacement", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Could not fetch the \(what): HTTP \(http.statusCode)."])
        }
    }

    /// Called by the screen when the scanner's surfaces change: a floor appearing moves us past `scanning`.
    public func floorChanged(known: Bool) {
        if phase == .scanning, known { phase = .ready }
        if phase == .ready, !known { phase = .scanning }
    }

    public func verdict(for placement: Placement) -> PlacementVerdict {
        guard let footprint else { return .noFloor }
        return checker.check(footprint, at: placement, planes: Array(scanner.planes.values), meshes: Array(scanner.meshes.values))
    }

    public func preview(_ placement: Placement) {
        phase = .previewing(verdict(for: placement))
    }

    public func confirm() {
        if case .previewing(let verdict) = phase, verdict.isOK { phase = .placed }
    }

    public func unlock(_ placement: Placement) {
        if phase == .placed { preview(placement) }
    }

    public func clear() {
        switch phase {
        case .placed, .previewing: phase = scanner.hasFloor ? .ready : .scanning
        default: break
        }
    }

    /// One sentence for the status line, from the phase and the scanner's state. Recovery guidance first:
    /// a person cannot place anything while the camera is off or tracking is lost.
    public var statusText: String {
        switch scanner.state {
        case .cameraDenied: return "Camera access is off. Allow the camera in Settings, then come back."
        case .interrupted: return "Paused. Come back to the app to continue."
        case .relocalising: return "Finding your room again: point the phone where you were before, or tap Reset scan."
        case .failed(let why): return "AR stopped: \(why) Tap Reset scan."
        case .tracking(limited: let reason?): return reason
        case .idle, .starting, .tracking: break
        }
        if case .unsupported(let why) = scanner.capability { return why }
        switch phase {
        case .loading: return "Loading the model…"
        case .loadFailed(let why): return "Could not load: \(why)"
        case .unsupportedProject(let why): return why
        case .scanning: return "Move the phone slowly over the floor and along the walls so it can scan them."
        case .ready: return "Tap the floor where you want it. Keep scanning walls and furniture nearby for a better check."
        case .previewing(let verdict):
            switch verdict {
            case .ok: return "Fits here. Drag to move, two fingers to turn, then Confirm."
            case .noFloor: return "No floor scanned yet."
            case .notOnFloor: return "That spot isn't on the scanned floor. Try nearer the middle, or scan more floor."
            case .intersects(_, let kind): return "It would go through \(Self.name(kind)). Drag it clear, or turn it."
            }
        case .placed: return "Placed at real size. Walk around it; tap Move to reposition."
        }
    }

    private static func name(_ kind: SurfaceKind) -> String {
        switch kind {
        case .wall: return "a wall"
        case .table: return "a table"
        case .seat: return "a seat"
        case .door: return "a door"
        case .window: return "a window"
        case .floor: return "the floor"
        case .ceiling: return "the ceiling"
        case .unknown: return "something the scan found"
        }
    }
}
#endif
