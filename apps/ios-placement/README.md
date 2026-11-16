# iPhone room placement (native, ARKit)

A Swift package that places a project's furniture at real size on an iPhone, using ARKit to scan the room so a placement that would run through a scanned wall, table or seat is refused. It exists because the web path on iPhone (AR Quick Look) gives a web page no room geometry at all; see `Architecture.md` (2026-11-16, "Native iPhone room scanning").

It reads what the web platform already publishes, unchanged: `projects/<name>/project.json` and the pre-baked real-size `quicklook.usdz` next to it (`pnpm run build:assets`). No new schema field and no new publish format.

## What it can and cannot know

| Phone | Scan | Obstacles the checker knows | Not known |
|---|---|---|---|
| iPhone with LiDAR (Pro models; Apple: scene reconstruction "requires a device with a LiDAR Scanner") | `ARWorldTrackingConfiguration.sceneReconstruction = .meshWithClassification`, plus plane detection | Mesh faces classified wall, table, seat, door, window (and unclassified ones) that the phone has looked at; floor and wall planes | Anything the camera has not seen; objects ARKit meshes poorly (thin, glass, dark) |
| iPhone without LiDAR (iOS 16+) | Plane detection (`.horizontal`, `.vertical`) only | Floor planes and the flat wall areas the phone has seen (classified where the phone supports it, else "unknown upright plane") | **Furniture and other objects are not detected at all.** The screen says so. |
| No ARKit world tracking | — | — | The screen explains and offers nothing else; use the web page's 3D view. |

This is not a complete room scan and it is not physics: the checker tests the piece's bounding box against scanned planes and sampled mesh points only (`PlacementCore/Placement.swift`). A wall the phone has not pointed at is unknown, not clear.

## Layout

- `Sources/PlacementCore`: pure Swift, no Apple framework types. `PlacementChecker` (footprint vs scanned planes and mesh points), `ScannedPlane` / `ScannedMesh` / `Footprint` / `Placement`, and `ProjectDocument` (reads and validates the published project file).
- `Sources/ARPlacement` (iOS only): `RoomScanner` (the ARKit adapter: session, capability check, camera permission, plane and mesh conversion, tracking / interruption / failure states), `PlacementViewModel` (loads the project and USDZ, asks the checker, status text), `PlacementScreen` (RealityKit view, ghost with a green/red footprint, tap to place, drag to move, two-finger turn, Confirm / Move / Remove / Reset scan).
- `App/RoomPlacementApp.swift`: the app target's entry point with a project-URL field.
- `Tests/PlacementCoreTests`: known-answer tests for the geometry and the project reader.

## Build and run (needs a Mac)

Requires Xcode 15+ and an iPhone on iOS 16 or later (LiDAR for the mesh; any ARKit iPhone for planes). There is no simulator support for ARKit.

1. `swift test` in this folder runs the PlacementCore tests on the Mac.
2. In Xcode: File → New → Project → iOS App, SwiftUI, name it `RoomPlacement`, minimum iOS 16.
3. File → Add Package Dependencies → Add Local → this folder; add the `ARPlacement` library to the app target.
4. Replace the generated `RoomPlacementApp.swift` with `App/RoomPlacementApp.swift`.
5. Target → Info: add `NSCameraUsageDescription` ("Scans your room to place furniture at real size. Nothing is uploaded.").
6. Run on the iPhone. Enter a project URL (the office chair on the deployed site is the default) and tap **Place in your room**.

## Privacy

The app downloads `project.json` and `quicklook.usdz` and nothing else leaves the phone. Room geometry stays in memory for the session; there is no upload, log, analytics or persistence of it.

## Status

Written on 2026-11-16 without a Mac or an iPhone to hand: it has not been compiled or run. The first job on a Mac is `swift test`, then a build in Xcode, then the device checks listed in `Architecture.md`.
