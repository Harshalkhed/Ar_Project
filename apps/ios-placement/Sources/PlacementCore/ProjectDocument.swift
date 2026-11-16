import Foundation

/// The part of a published `project.json` (schema 1.0, `packages/project-schema`) the native app needs.
/// Read-only: the schema is owned by the web platform and is not changed or extended here. Unknown fields
/// are ignored; the few that matter are validated, matching `validateProject`'s rules for them.
public struct ProjectDocument: Decodable, Equatable, Sendable {
    public enum Surface: String, Decodable, Sendable { case floor, wall }

    /// Named apart from `PlacementCore.Placement` (a pose) to avoid confusion.
    public struct PlacementRule: Decodable, Equatable, Sendable {
        public let surface: Surface
    }

    public let schemaVersion: String
    public let id: String
    public let name: String
    public let placement: PlacementRule?

    /// Missing means floor, as `placementSurfaceOf` does.
    public var surface: Surface { placement?.surface ?? .floor }

    public enum ValidationError: Error, Equatable, CustomStringConvertible {
        case unsupportedSchemaVersion(String)
        case emptyID
        case invalidJSON(String)

        public var description: String {
            switch self {
            case .unsupportedSchemaVersion(let v): return "Project schema \(v) is not supported (expected 1.0)."
            case .emptyID: return "Project has no id."
            case .invalidJSON(let why): return "Project file is not valid: \(why)"
            }
        }
    }

    /// Decodes and validates. Unlike a cast, a bad document is an error the screen can show.
    public static func parse(_ data: Data) throws -> ProjectDocument {
        let document: ProjectDocument
        do {
            document = try JSONDecoder().decode(ProjectDocument.self, from: data)
        } catch {
            throw ValidationError.invalidJSON(String(describing: error))
        }
        guard document.schemaVersion == "1.0" else { throw ValidationError.unsupportedSchemaVersion(document.schemaVersion) }
        guard !document.id.isEmpty else { throw ValidationError.emptyID }
        return document
    }

    /// The pre-baked real-size USDZ the asset pipeline writes next to every project (`quicklook.usdz`),
    /// the same file iPhones open in Quick Look. The native app loads it with RealityKit, so no new publish
    /// format is needed.
    public static func usdzURL(nextTo projectURL: URL) -> URL {
        projectURL.deletingLastPathComponent().appendingPathComponent("quicklook.usdz")
    }
}
