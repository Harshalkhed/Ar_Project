import Foundation

/// Minimal 3-vector maths so the placement geometry needs no Apple framework and runs wherever `swift test` does.
public struct Vec3: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var z: Double

    public init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    public static let zero = Vec3(0, 0, 0)
    public static let up = Vec3(0, 1, 0)

    public static func + (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x + b.x, a.y + b.y, a.z + b.z) }
    public static func - (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x - b.x, a.y - b.y, a.z - b.z) }
    public static func * (a: Vec3, s: Double) -> Vec3 { Vec3(a.x * s, a.y * s, a.z * s) }

    public func dot(_ b: Vec3) -> Double { x * b.x + y * b.y + z * b.z }
    public func cross(_ b: Vec3) -> Vec3 { Vec3(y * b.z - z * b.y, z * b.x - x * b.z, x * b.y - y * b.x) }
    public var length: Double { (x * x + y * y + z * z).squareRoot() }
    public var normalized: Vec3 {
        let l = length
        return l > 0 ? self * (1 / l) : self
    }

    /// Turned about the vertical axis by `yaw` radians (the same sense as a three.js Y rotation).
    public func rotatedAboutY(_ yaw: Double) -> Vec3 {
        let c = cos(yaw), s = sin(yaw)
        return Vec3(x * c + z * s, y, -x * s + z * c)
    }
}
