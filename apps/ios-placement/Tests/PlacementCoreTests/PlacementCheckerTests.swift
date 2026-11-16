import XCTest
@testable import PlacementCore

/// Known-answer tests for the placement geometry. Run with `swift test` on a Mac (or in Xcode).
final class PlacementCheckerTests: XCTestCase {
    // A 4 × 4 m floor at y = 0 and a wall at z = -2 facing +Z (into the room), 4 m wide, 2.6 m high,
    // centred 1.3 m up. Normal × xAxis = +Z × +X = +Y, so the wall's depth runs up the wall.
    let floor = ScannedPlane(id: "floor", kind: .floor, centre: .zero, normal: .up, xAxis: Vec3(1, 0, 0), width: 4, depth: 4)
    let wall = ScannedPlane(id: "wall", kind: .wall, centre: Vec3(0, 1.3, -2), normal: Vec3(0, 0, 1), xAxis: Vec3(1, 0, 0), width: 4, depth: 2.6)
    // The office chair, roughly: 0.68 wide, 0.66 deep, 1.16 tall.
    let chair = Footprint(width: 0.68, depth: 0.66, height: 1.16)
    let checker = PlacementChecker()

    func testPlacesInOpenFloor() {
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0, -0.5), yaw: 0), planes: [floor, wall]), .ok)
    }

    func testNoFloorScannedYet() {
        XCTAssertEqual(checker.check(chair, at: Placement(position: .zero, yaw: 0), planes: [wall]), .noFloor)
    }

    func testSpotOffTheScannedFloorOrAtAnotherHeight() {
        // 3 m past the floor's edge (2 m + 0.1 m grace).
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(3, 0, 0), yaw: 0), planes: [floor]), .notOnFloor)
        // A table top 0.75 m up is not the floor.
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0.75, 0), yaw: 0), planes: [floor]), .notOnFloor)
        // But an unnamed horizontal plane at floor height (no classification on this phone) supports it.
        let unnamed = ScannedPlane(id: "h", kind: .unknown, centre: .zero, normal: .up, xAxis: Vec3(1, 0, 0), width: 4, depth: 4)
        XCTAssertEqual(checker.check(chair, at: Placement(position: .zero, yaw: 0), planes: [unnamed]), .ok)
    }

    func testBackOfChairThroughTheWallIsRejected() {
        // Centre 0.2 m from the wall: the back corners (0.33 m behind the centre) are inside the wall.
        let verdict = checker.check(chair, at: Placement(position: Vec3(0, 0, -1.8), yaw: 0), planes: [floor, wall])
        XCTAssertEqual(verdict, .intersects(surfaceID: "wall", kind: .wall))
        // 0.36 m away clears it (0.33 m + 2 cm clearance).
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0, -1.64), yaw: 0), planes: [floor, wall]), .ok)
    }

    func testTurningTheChairCanPushACornerIntoTheWall() {
        // At 45° the diagonal half-extent is ~0.47 m: fine at 0.5 m from the wall, through it at 0.4 m.
        let yaw = Double.pi / 4
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0, -1.5), yaw: yaw), planes: [floor, wall]), .ok)
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0, -1.6), yaw: yaw), planes: [floor, wall]), .intersects(surfaceID: "wall", kind: .wall))
    }

    func testOnlyTheScannedPartOfAWallBlocks() {
        // 2.5 m to the side, past the 4 m wide scanned stretch: the checker cannot know what is there.
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(2.5, 0, -1.9), yaw: 0), planes: [floor, wall]), .notOnFloor)
        let bigFloor = ScannedPlane(id: "floor", kind: .floor, centre: .zero, normal: .up, xAxis: Vec3(1, 0, 0), width: 10, depth: 10)
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(2.5, 0, -1.9), yaw: 0), planes: [bigFloor, wall]), .ok)
    }

    func testUnnamedUprightPlaneBlocksLikeAWall() {
        let upright = ScannedPlane(id: "v", kind: .unknown, centre: Vec3(0, 1.3, -2), normal: Vec3(0, 0, 1), xAxis: Vec3(1, 0, 0), width: 4, depth: 2.6)
        XCTAssertEqual(checker.check(chair, at: Placement(position: Vec3(0, 0, -1.8), yaw: 0), planes: [floor, upright]), .intersects(surfaceID: "v", kind: .unknown))
    }

    func testMeshPointsInsideTheFootprintBlock() {
        // A scanned table leg 0.1 m in front of the chair's centre, 0.5 m up.
        let leg = ScannedMesh(id: "table", kind: .table, points: [Vec3(0.1, 0.5, 0.1)])
        XCTAssertEqual(checker.check(chair, at: Placement(position: .zero, yaw: 0), planes: [floor], meshes: [leg]), .intersects(surfaceID: "table", kind: .table))
        // The same point above the chair's height, or at floor level (skirting), does not.
        let above = ScannedMesh(id: "lamp", kind: .unknown, points: [Vec3(0.1, 1.5, 0.1)])
        let skirting = ScannedMesh(id: "wallbase", kind: .wall, points: [Vec3(0.1, 0.01, 0.1)])
        XCTAssertEqual(checker.check(chair, at: Placement(position: .zero, yaw: 0), planes: [floor], meshes: [above, skirting]), .ok)
        // Mesh points are tested in the piece's own frame: a sofa 1.8 wide × 0.9 deep turned 90° has its
        // width along Z, so a point 0.7 m along Z is clear when straight and inside when turned.
        let sofa = Footprint(width: 1.8, depth: 0.9, height: 0.8)
        let side = ScannedMesh(id: "side", kind: .seat, points: [Vec3(0, 0.3, 0.7)])
        XCTAssertEqual(checker.check(sofa, at: Placement(position: .zero, yaw: 0), planes: [floor], meshes: [side]), .ok)
        XCTAssertEqual(checker.check(sofa, at: Placement(position: .zero, yaw: .pi / 2), planes: [floor], meshes: [side]), .intersects(surfaceID: "side", kind: .seat))
    }

    func testFloorAndCeilingMeshesNeverBlock() {
        let floorMesh = ScannedMesh(id: "f", kind: .floor, points: [Vec3(0, 0.5, 0)])
        let ceilingMesh = ScannedMesh(id: "c", kind: .ceiling, points: [Vec3(0, 0.5, 0)])
        XCTAssertEqual(checker.check(chair, at: Placement(position: .zero, yaw: 0), planes: [floor], meshes: [floorMesh, ceilingMesh]), .ok)
    }

    func testCornersTurnWithYaw() {
        let corners = Placement(position: Vec3(1, 0, 1), yaw: .pi / 2).corners(of: Footprint(width: 2, depth: 1, height: 1))
        // Width (x) now runs along -z / +z, depth (z) along x.
        let expected = [Vec3(0.5, 0, 2), Vec3(0.5, 0, 0), Vec3(1.5, 0, 0), Vec3(1.5, 0, 2)]
        for (c, e) in zip(corners, expected) {
            XCTAssertEqual(c.x, e.x, accuracy: 1e-9)
            XCTAssertEqual(c.z, e.z, accuracy: 1e-9)
        }
    }

    func testProjectDocumentParsesAndValidates() throws {
        let json = #"{"schemaVersion":"1.0","id":"demo","name":"Chair","tracking":{"type":"webxr"},"placement":{"surface":"wall"},"objects":[]}"#
        let doc = try ProjectDocument.parse(Data(json.utf8))
        XCTAssertEqual(doc.id, "demo")
        XCTAssertEqual(doc.surface, .wall)
        XCTAssertEqual(try ProjectDocument.parse(Data(#"{"schemaVersion":"1.0","id":"x","name":"y"}"#.utf8)).surface, .floor)
        XCTAssertThrowsError(try ProjectDocument.parse(Data(#"{"schemaVersion":"2.0","id":"x","name":"y"}"#.utf8))) {
            XCTAssertEqual($0 as? ProjectDocument.ValidationError, .unsupportedSchemaVersion("2.0"))
        }
        XCTAssertThrowsError(try ProjectDocument.parse(Data(#"{"schemaVersion":"1.0","id":"x","name":"y","placement":{"surface":"ceiling"}}"#.utf8)))
        XCTAssertEqual(ProjectDocument.usdzURL(nextTo: URL(string: "https://example.test/projects/chair/project.json")!).absoluteString, "https://example.test/projects/chair/quicklook.usdz")
    }
}
