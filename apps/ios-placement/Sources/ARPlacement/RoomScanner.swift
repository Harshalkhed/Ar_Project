#if canImport(ARKit) && os(iOS)
import ARKit
import AVFoundation
import Combine
import Foundation
import PlacementCore

/// What this phone can scan. Decided once from ARKit's own support checks, never from the model name.
public enum ScanCapability: Equatable {
    /// LiDAR: ARKit scene reconstruction gives a classified mesh (walls, tables, seats, doors, windows)
    /// as well as planes. Objects the phone has looked at become obstacles.
    case lidarMesh
    /// No LiDAR: plane detection only. Floors and flat wall areas the phone has seen become surfaces;
    /// furniture and other objects are NOT detected, so nothing stops a placement from overlapping them.
    case planesOnly
    /// No ARKit world tracking at all.
    case unsupported(String)

    public var summary: String {
        switch self {
        case .lidarMesh: return "LiDAR scan: walls, tables and seats the phone has seen count as obstacles."
        case .planesOnly: return "No LiDAR on this phone: only floors and flat wall areas it has seen are known. Furniture and other objects are not detected."
        case .unsupported(let why): return why
        }
    }
}

public enum ScanState: Equatable {
    case idle
    case cameraDenied
    case starting
    /// Tracking; `limited` carries ARKit's reason while the pose is uncertain, nil when normal.
    case tracking(limited: String?)
    /// The session is paused (a call, another app, the camera taken away).
    case interrupted
    /// Back from an interruption, trying to recover its map of the room.
    case relocalising
    case failed(String)
}

/// The ARKit adapter: runs the world-tracking session and turns its anchors into `ScannedPlane`s and
/// `ScannedMesh`es. Apple types stop at this file. Everything stays on the phone: nothing here writes
/// or sends anything.
///
/// ARSession calls its delegate on the main queue when `delegateQueue` is nil (the default), so the
/// published properties are updated on the main thread without extra hops.
public final class RoomScanner: NSObject, ObservableObject, ARSessionDelegate {
    @Published public private(set) var planes: [String: ScannedPlane] = [:]
    @Published public private(set) var meshes: [String: ScannedMesh] = [:]
    @Published public private(set) var state: ScanState = .idle
    public let capability: ScanCapability

    /// Mesh anchors update many times a second; converting every update is wasted work for a check that
    /// runs on a tap. ponytail: fixed 0.5 s throttle per anchor; make it adaptive if a phone shows lag.
    private var lastMeshConversion: [UUID: TimeInterval] = [:]
    private let meshThrottle: TimeInterval = 0.5
    /// Every nth mesh face is sampled. Faces are a few centimetres across, so 4 keeps a point every
    /// ~10 cm, well under the smallest furniture dimension that matters.
    private let faceStep = 4

    public static func detectCapability() -> ScanCapability {
        guard ARWorldTrackingConfiguration.isSupported else {
            return .unsupported("This device cannot track its position in a room (ARKit world tracking is not available).")
        }
        // Apple: scene reconstruction requires a device with a LiDAR Scanner (supportsSceneReconstruction docs).
        return ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) ? .lidarMesh : .planesOnly
    }

    public override init() {
        capability = Self.detectCapability()
        super.init()
    }

    public func configuration() -> ARWorldTrackingConfiguration {
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        if capability == .lidarMesh { configuration.sceneReconstruction = .meshWithClassification }
        configuration.environmentTexturing = .none // not needed for placement; saves work
        return configuration
    }

    /// Asks for the camera first so a refusal is a clear state, not a black view. Main actor: the
    /// permission prompt resumes on an arbitrary thread, and the session and published state belong to main.
    @MainActor
    public func start(_ session: ARSession) async {
        if case .unsupported = capability { return }
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        let granted = status == .authorized || (status == .notDetermined && (await AVCaptureDevice.requestAccess(for: .video)))
        guard granted else {
            state = .cameraDenied
            return
        }
        session.delegate = self
        run(session)
    }

    /// Starts over: forgets every surface and re-initialises tracking (ARKit's advice when relocalisation
    /// never succeeds).
    public func reset(_ session: ARSession) {
        planes = [:]
        meshes = [:]
        lastMeshConversion = [:]
        run(session)
    }

    private func run(_ session: ARSession) {
        session.run(configuration(), options: [.resetTracking, .removeExistingAnchors])
        state = .starting
    }

    public var hasFloor: Bool { planes.values.contains(where: \.supportsFurniture) }

    // MARK: ARSessionDelegate

    public func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { absorb(anchors) }
    public func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { absorb(anchors) }

    public func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        for anchor in anchors {
            planes[anchor.identifier.uuidString] = nil
            for key in meshes.keys where key.hasPrefix(anchor.identifier.uuidString) { meshes[key] = nil }
            lastMeshConversion[anchor.identifier] = nil
        }
    }

    public func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
        switch camera.trackingState {
        case .normal:
            state = .tracking(limited: nil)
        case .notAvailable:
            state = .tracking(limited: "Tracking is not available yet.")
        case .limited(let reason):
            switch reason {
            case .initializing: state = .tracking(limited: "Starting up: move the phone slowly.")
            case .excessiveMotion: state = .tracking(limited: "Moving too fast: slow down.")
            case .insufficientFeatures: state = .tracking(limited: "Not enough detail in view: point at a more textured area, or turn on a light.")
            case .relocalizing: state = .relocalising
            @unknown default: state = .tracking(limited: "Tracking is limited.")
            }
        }
    }

    public func sessionWasInterrupted(_ session: ARSession) { state = .interrupted }

    public func sessionInterruptionEnded(_ session: ARSession) {
        // Relocalisation starts now; the camera tracking state reports when it finishes (or stays limited).
        state = .relocalising
    }

    /// Let ARKit try to line its old map up with the room again, so placed furniture keeps its spot.
    public func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    public func session(_ session: ARSession, didFailWithError error: Error) {
        state = .failed(error.localizedDescription)
    }

    // MARK: Conversion

    private func absorb(_ anchors: [ARAnchor]) {
        for anchor in anchors {
            if let plane = anchor as? ARPlaneAnchor {
                planes[plane.identifier.uuidString] = Self.scannedPlane(plane)
            } else if let mesh = anchor as? ARMeshAnchor {
                let now = ProcessInfo.processInfo.systemUptime
                if let last = lastMeshConversion[mesh.identifier], now - last < meshThrottle { continue }
                lastMeshConversion[mesh.identifier] = now
                let key = mesh.identifier.uuidString
                for stale in meshes.keys where stale.hasPrefix(key) { meshes[stale] = nil }
                for (kind, points) in Self.points(of: mesh, step: faceStep) {
                    meshes["\(key)/\(kind.rawValue)"] = ScannedMesh(id: "\(key)/\(kind.rawValue)", kind: kind, points: points)
                }
            }
        }
    }

    static func scannedPlane(_ plane: ARPlaneAnchor) -> ScannedPlane {
        let t = plane.transform
        // planeExtent.rotationOnYAxis turns the extent rectangle about the plane's normal (its local Y).
        let turn = simd_quatf(angle: plane.planeExtent.rotationOnYAxis, axis: SIMD3<Float>(0, 1, 0))
        let xLocal = turn.act(SIMD3<Float>(1, 0, 0))
        let centre = t * SIMD4<Float>(plane.center, 1)
        let normal = t * SIMD4<Float>(0, 1, 0, 0)
        let xAxis = t * SIMD4<Float>(xLocal, 0)
        let kind: SurfaceKind
        switch plane.classification {
        case .wall: kind = .wall
        case .floor: kind = .floor
        case .ceiling: kind = .ceiling
        case .table: kind = .table
        case .seat: kind = .seat
        case .door: kind = .door
        case .window: kind = .window
        // Not classified (older phones never classify; newer ones take a moment): the checker treats an
        // upright unknown plane as a wall and a flat one as floor.
        case .none: kind = .unknown
        @unknown default: kind = .unknown
        }
        return ScannedPlane(
            id: plane.identifier.uuidString,
            kind: kind,
            centre: Vec3(centre),
            normal: Vec3(normal),
            xAxis: Vec3(xAxis),
            width: Double(plane.planeExtent.width),
            depth: Double(plane.planeExtent.height)
        )
    }

    /// World-space vertices of every `step`th face, grouped by the face's classification. Floor and
    /// ceiling faces are skipped: they never block furniture, and they are most of the mesh.
    static func points(of anchor: ARMeshAnchor, step: Int) -> [SurfaceKind: [Vec3]] {
        let geometry = anchor.geometry
        let vertices = geometry.vertices
        let faces = geometry.faces
        let vertexBase = vertices.buffer.contents().advanced(by: vertices.offset)
        let faceBase = faces.buffer.contents()
        let classification = geometry.classification
        let classBase = classification.map { $0.buffer.contents().advanced(by: $0.offset) }
        var out: [SurfaceKind: [Vec3]] = [:]
        for face in stride(from: 0, to: faces.count, by: max(step, 1)) {
            var kind = SurfaceKind.unknown
            if let classBase, let classification {
                let raw = classBase.advanced(by: face * classification.stride).load(as: UInt8.self)
                kind = SurfaceKind(ARMeshClassification(rawValue: Int(raw)) ?? .none)
            }
            if kind == .floor || kind == .ceiling { continue }
            for corner in 0..<faces.indexCountPerPrimitive {
                let indexPointer = faceBase.advanced(by: (face * faces.indexCountPerPrimitive + corner) * faces.bytesPerIndex)
                let index = faces.bytesPerIndex == 4 ? Int(indexPointer.loadUnaligned(as: UInt32.self)) : Int(indexPointer.loadUnaligned(as: UInt16.self))
                // Vertices are packed float3 (12-byte stride), so read the three floats, not a 16-byte SIMD3.
                let v = vertexBase.advanced(by: index * vertices.stride)
                let local = SIMD4<Float>(v.loadUnaligned(as: Float.self), v.advanced(by: 4).loadUnaligned(as: Float.self), v.advanced(by: 8).loadUnaligned(as: Float.self), 1)
                out[kind, default: []].append(Vec3(anchor.transform * local))
            }
        }
        return out
    }
}

extension SurfaceKind {
    init(_ classification: ARMeshClassification) {
        switch classification {
        case .wall: self = .wall
        case .floor: self = .floor
        case .ceiling: self = .ceiling
        case .table: self = .table
        case .seat: self = .seat
        case .door: self = .door
        case .window: self = .window
        case .none: self = .unknown
        @unknown default: self = .unknown
        }
    }
}

extension Vec3 {
    init(_ v: SIMD4<Float>) { self.init(Double(v.x), Double(v.y), Double(v.z)) }
    init(_ v: SIMD3<Float>) { self.init(Double(v.x), Double(v.y), Double(v.z)) }
    var simd: SIMD3<Float> { SIMD3<Float>(Float(x), Float(y), Float(z)) }
}
#endif
