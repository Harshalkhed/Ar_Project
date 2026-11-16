/// What the scanner thinks a surface is. Maps from ARKit's plane and mesh classifications in the adapter;
/// nothing here depends on ARKit.
public enum SurfaceKind: String, Sendable {
    case floor, wall, ceiling, table, seat, door, window
    /// A surface the scanner found but could not name.
    case unknown
}

/// A flat, bounded surface the scanner has found: a rectangle `width` across `xAxis` and `depth` across
/// `zAxis` (= `normal × xAxis`), centred at `centre`, with `normal` pointing out of it into the room.
/// On iPhone this is an `ARPlaneAnchor`. A wall plane is only as big as the part of the wall the phone
/// has seen; the checker treats everything outside it as unknown, not as free space.
public struct ScannedPlane: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: SurfaceKind
    public let centre: Vec3
    public let normal: Vec3
    public let xAxis: Vec3
    public let width: Double
    public let depth: Double

    public init(id: String, kind: SurfaceKind, centre: Vec3, normal: Vec3, xAxis: Vec3, width: Double, depth: Double) {
        self.id = id
        self.kind = kind
        self.centre = centre
        self.normal = normal.normalized
        self.xAxis = xAxis.normalized
        self.width = width
        self.depth = depth
    }

    public var zAxis: Vec3 { normal.cross(xAxis) }

    /// Vertical enough to be stood on. Unnamed horizontal planes count too (a phone without plane
    /// classification reports every horizontal plane as unknown).
    public var supportsFurniture: Bool {
        (kind == .floor || kind == .unknown) && normal.y > 0.8
    }

    /// A wall, or an unnamed plane standing upright.
    public var blocksLikeWall: Bool {
        kind == .wall || (kind == .unknown && abs(normal.y) < 0.3)
    }

    /// Signed distance from the plane: positive on the side the normal points to.
    public func distance(to p: Vec3) -> Double { (p - centre).dot(normal) }

    /// Whether `p`, projected onto the plane, falls inside the rectangle (grown by `margin` on each side).
    public func covers(_ p: Vec3, margin: Double = 0) -> Bool {
        let d = p - centre
        return abs(d.dot(xAxis)) <= width / 2 + margin && abs(d.dot(zAxis)) <= depth / 2 + margin
    }
}

/// Points from a reconstructed mesh (LiDAR scene reconstruction), in world space, with the classification
/// of the faces they came from. The adapter leaves out floor and ceiling faces, which never block furniture.
public struct ScannedMesh: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: SurfaceKind
    public let points: [Vec3]

    public init(id: String, kind: SurfaceKind, points: [Vec3]) {
        self.id = id
        self.kind = kind
        self.points = points
    }
}

/// The space a piece of furniture takes up: its bounding box, `width` (x) by `depth` (z) on the floor,
/// `height` up, with the origin at the bottom centre.
public struct Footprint: Equatable, Sendable {
    public let width: Double
    public let depth: Double
    public let height: Double

    public init(width: Double, depth: Double, height: Double) {
        self.width = width
        self.depth = depth
        self.height = height
    }
}

/// Where a piece stands: `position` is its bottom centre, `yaw` its turn about the vertical in radians.
public struct Placement: Equatable, Sendable {
    public var position: Vec3
    public var yaw: Double

    public init(position: Vec3, yaw: Double) {
        self.position = position
        self.yaw = yaw
    }

    /// The footprint's four floor corners in world space.
    public func corners(of footprint: Footprint) -> [Vec3] {
        let hw = footprint.width / 2, hd = footprint.depth / 2
        return [Vec3(-hw, 0, -hd), Vec3(hw, 0, -hd), Vec3(hw, 0, hd), Vec3(-hw, 0, hd)].map { position + $0.rotatedAboutY(yaw) }
    }
}

public enum PlacementVerdict: Equatable, Sendable {
    case ok
    /// The scanner has found no floor yet.
    case noFloor
    /// There is a floor, but not under this spot (off its scanned edge, or at a different height: a table, a step).
    case notOnFloor
    /// The footprint would pass through a scanned surface.
    case intersects(surfaceID: String, kind: SurfaceKind)

    public var isOK: Bool { self == .ok }
}

/// Decides whether a footprint can stand at a placement given what has been scanned. It only knows what
/// the scanner reported: a wall the phone has not looked at, or an object that plane detection cannot see,
/// is not an obstacle here. The screen must say so.
public struct PlacementChecker: Sendable {
    /// How close to a wall (metres) still counts as touching it.
    public var clearance: Double
    /// How far (metres) the spot may be above or below the floor plane and still be "on" it.
    public var floorTolerance: Double
    /// Mesh points this close to the floor (metres) are the floor itself (or skirting), not an obstacle.
    public var ignoreBelow: Double

    public init(clearance: Double = 0.02, floorTolerance: Double = 0.05, ignoreBelow: Double = 0.03) {
        self.clearance = clearance
        self.floorTolerance = floorTolerance
        self.ignoreBelow = ignoreBelow
    }

    public func check(_ footprint: Footprint, at placement: Placement, planes: [ScannedPlane], meshes: [ScannedMesh] = []) -> PlacementVerdict {
        let floors = planes.filter(\.supportsFurniture)
        if floors.isEmpty { return .noFloor }
        let p = placement.position
        // The scanned floor may stop short of the real one; 10 cm of grace at its edge.
        let onFloor = floors.contains { abs($0.distance(to: p)) <= floorTolerance && $0.covers(p, margin: 0.1) }
        if !onFloor { return .notOnFloor }

        let corners = placement.corners(of: footprint)
        for wall in planes where wall.blocksLikeWall {
            // A corner on or behind the wall's plane, within the scanned part of the wall, is in the wall.
            // The wall's vertical extent is checked too (a plane only covers the height the phone has seen).
            for corner in corners where wall.distance(to: corner) < clearance {
                // Check the footprint's full height against the wall rectangle, not just the floor corner.
                let mid = corner + Vec3(0, footprint.height / 2, 0)
                if wall.covers(mid, margin: clearance) || wall.covers(corner, margin: clearance) {
                    return .intersects(surfaceID: wall.id, kind: wall.kind)
                }
            }
            // ponytail: corners only; a footprint wider than a short wall segment could straddle it unseen.
            // Add edge-vs-rectangle intersection if a device test ever shows it.
        }

        for mesh in meshes where mesh.kind != .floor && mesh.kind != .ceiling {
            let hw = footprint.width / 2 + clearance, hd = footprint.depth / 2 + clearance
            for point in mesh.points {
                let local = (point - p).rotatedAboutY(-placement.yaw)
                if local.y > ignoreBelow && local.y < footprint.height + clearance && abs(local.x) <= hw && abs(local.z) <= hd {
                    return .intersects(surfaceID: mesh.id, kind: mesh.kind)
                }
            }
        }
        return .ok
    }
}
