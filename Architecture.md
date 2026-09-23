# Technical Architecture

## Research record

The inspected upstream repository (`.reference/open-webar-sdk`, commit `d625e58`) is a small npm workspace with `packages/create-webar-app`, `packages/webar-sdk`, `templates/{ar-360,face-tracking,image-tracking,qr-tracking,webxr}`, and parallel `threejs/*` runnable examples. The root package requires Node 18+, has npm workspaces for `packages/*`, and delegates runtime capability to the external `@web-ar-studio/webar-engine-sdk` package. It provides scaffolding and examples, not an internal project model, publishing system, editor, asset service, or analytics platform.

The WebAR.Studio reference describes a broader product model: a no-code Design Studio, a lighter template editor, a 3D configurator, browser publication, multiple tracking options, scenes and transitions, animations, personalization/custom domains, analytics, and integrations. These are product capability signals, not implementation requirements to copy.

## Capability map

| Capability | Upstream evidence | Our strategy | Phase |
|---|---|---|---|
| Starter scaffolding | `create-webar-app` templates and mode flags | Reference workflow only; our platform emits versioned runtime builds | Later |
| Image tracking | image template and Three.js example | Isolate behind `TrackingProvider`; first real provider | MVP/V1 |
| QR tracking | QR template/example | New provider behind same contract | Later |
| Face tracking | face template/example | New provider; no schema coupling | Later |
| WebXR | WebXR template/example | New provider with feature detection | Later |
| AR360 | AR360 template/example | New orientation provider | Later |
| Scenes/interactions | Product reference, not upstream project model | Own serializable schema and runtime systems | MVP foundation |
| Assets/GLB | Product reference and example usage | Stable asset IDs plus validated loader boundary | V1 |
| Publishing/versions | Product reference | Own deployment model with stable experience ID | V1 |
| Analytics | Product reference | Own event contract first; backend later | Foundation/V1 |

## Reuse and provenance decisions

- **Reference-only:** upstream repository structure, CLI naming, templates, example wiring, and source-specific APIs. They help compare browser/runtime setup but are not our internal API.
- **Potentially wrapped:** a future ARSY image/QR/face implementation may be wrapped inside `packages/tracking-*` if its package license and runtime contract are verified.
- **Not copied now:** no upstream source code is in the product packages. This keeps the initial architecture independent and makes replacement possible.
- **License record:** upstream root `LICENSE` is Apache License 2.0. Apache redistribution requires retaining the license/attribution notices and marking modified files. The current npm templates depend on `@web-ar-studio/webar-engine-sdk`, `three`, `vite`, `normalize.css`, and `prompts`; each must be rechecked from its own published package metadata before any redistribution or source copy.

This is a preliminary technical licensing review and is not legal advice.

## Boundaries

```text
Internal editor → versioned project document → runtime core
                                      ↘ tracking provider adapter
                                      ↘ renderer adapter (Three.js later)
                                      ↘ asset loader
                                      ↘ analytics sink
```

The editor is an authoring client. The public runtime is independently deployable and only receives the public version of a validated project. Services for storage, publishing, hosting, and analytics are future boundaries; they must not be required by the pure schema/runtime packages.

## Repository proposal

```text
apps/preview/                 browser fixture for runtime contract
packages/project-schema/      versioned provider-neutral document and validation
packages/runtime-core/        lifecycle, provider selection, events, failure states
packages/tracking/            provider contract and capability types
packages/tracking-image/      image provider adapter seam
packages/renderer/            future Three.js boundary
packages/interaction/         future event/condition/action execution
packages/animation/           future controlled animation model
services/                     future API, publishing, storage, analytics
tests/                        cross-package fixtures and device/browser plans
.reference/open-webar-sdk/    local research checkout, never imported by product code
```

## Project model

The schema uses `schemaVersion`, stable IDs, a list of triggers, trigger-to-scene references, scene objects, asset references, and deployment metadata. A trigger can point to multiple scenes; a scene can contain provider-neutral object transforms and interaction definitions. Provider configuration is represented as a typed, serializable configuration object but provider execution remains outside the schema package.

## Runtime

Runtime startup validates the project, chooses a provider by `tracking.type`, emits structured events, and exposes a state machine: `created`, `initializing`, `ready`, `tracking`, `error`, `stopped`. It does not silently render a blank screen. The first implementation uses an injected provider and event sink, making browser/device integration testable without pretending that a desktop unit test proves camera tracking.

## Publishing and deployment

The future public route is `experienceId → active deployment → projectVersion + runtimeVersion`. Draft, test, production, and archived states are explicit. A new production version changes the deployment pointer, not the QR/experience ID. Our domain is the first deployment target; client domains, CDN, object storage, and edge routing remain open decisions.

## Security

Treat project JSON, asset metadata, asset bytes, URLs, and runtime query parameters as untrusted. Validate sizes/types and references, keep administration data out of public payloads, use signed/private asset URLs where needed, and never execute arbitrary authored JavaScript. Future services require organization/project isolation, access control, rate limits, deployment authorization, and audit logs.

## Performance and browser strategy

Use feature detection for camera, WebGL, WebXR, permission state, and provider availability. Runtime loading must be staged and observable. Proposed targets are documented in `PRD.md`; they are engineering targets, not universal browser claims. Real device tests are mandatory for the first image-tracking release.

## Testing and CI

Unit tests cover schema validation and lifecycle contracts. Integration tests cover provider/runtime wiring and project fixtures. Browser tests cover permission/error UI and preview loading. Device tests cover HTTPS camera access, Android/iPhone image recognition, target loss/recovery, and performance. CI should run typecheck, unit/integration tests, package builds, and provenance checks before publishing.

## Decisions and open questions

Decisions: npm workspaces initially, strict TypeScript, provider-neutral schema, injected runtime dependencies, image tracking first, and no upstream source copy. Open questions: pnpm vs npm at scale, editor framework, validation library, Three.js package boundary, WASM worker strategy, storage/database, hosting/CDN, CI, and the exact provider package to integrate.


## Decision log

### 2026-09-23 — Per-package builds with TypeScript project references

- **Existing:** one root `tsc` emitted everything to `dist/packages/*/src`; `@internal-webar/*` imports resolved only at typecheck time via `tsconfig` `paths`. The compiled runtime failed with `ERR_MODULE_NOT_FOUND`, and each package's `exports: ./dist/index.js` pointed at a file that was never built.
- **Change:** each package and `apps/preview` has its own `tsconfig.json` (`composite`, `rootDir: src`, `outDir: dist`). The root `tsconfig.json` only lists references, and `tsc -b` builds them in dependency order. Shared options live in `tsconfig.base.json`. Package `exports` declare `types` + `default`. `paths` was removed, so resolution now uses the workspace links the package manager already creates.
- **Alternatives:** a Node resolve hook or import map that maps specifiers to root `dist` (hides broken package wiring), or a bundler (a new dependency for a problem the compiler already solves).
- **Impact:** tests import `packages/<pkg>/dist/index.js`. `typecheck` runs `tsc -b`, because `--noEmit` is not allowed for referenced projects on a clean tree; output lands in the gitignored `dist/`. Invalid `version: "workspace:*"` values were corrected to `0.1.0`.

### 2026-09-23 — Image-tracking engine seam

- `TrackingProvider.initialize(targets)` now receives provider-neutral `TrackingTarget { id, type, sourceUri? }`. `id` is the project trigger ID. The runtime (`resolveTrackingTargets`) resolves `trigger.config.imageAssetId` to the asset URI, so providers never import the project schema.
- `packages/tracking-image` defines `ImageTrackingEngine` (`loadTargets(uris)`, `start(callbacks)`, `stop()`), with targets identified by index. A concrete engine (ARSY/`@web-ar-studio/webar-engine-sdk`, MindAR, or a custom WASM build) is added later as an adapter that implements this interface. Vendor types stay inside that adapter. `ImageTrackingProvider` owns capability detection (secure context + `getUserMedia`), index→trigger mapping, found/lost de-duplication, and mapping of `getUserMedia` `DOMException` names to structured codes.
- Failures carry a `TrackingErrorCode` (`unsupported`, `permission_denied`, `camera_unavailable`, `target_load_failed`, `provider_failed`) via `TrackingError` and `error` events. `RuntimeCore` adds `invalid_project`, `unsupported_tracking_type`, and `no_targets`, and emits every failure as a single `runtime_error { code, message }`, so the UI can render a specific recovery state.
- `RuntimeCore` now uses the documented state machine (`created → initializing → ready ⇄ tracking`, `error`, `stopped`). It rejects a provider whose `type` differs from `project.tracking.type`, refuses a second `start` while running, and unsubscribes on `stop`. `ImageTrackingProvider.stop()` no longer drops listeners, so a restart keeps working.
- **Not yet in the contract:** per-frame target pose. This belongs with the renderer boundary (next task) so its shape can be designed against Three.js needs.

### 2026-09-23 — Schema 1.0 validation rules (no document shape change)

`validateProject` now takes `unknown` and checks, in addition to the earlier rules: the document is an object, the collections are arrays, IDs are unique within each collection, scene `objectIds` and interaction `targetId`/`sceneId` references resolve, image triggers set `config.imageAssetId` to an `image` asset, `model` assets are `.glb`, and asset URIs are relative paths or `https:` URLs (blocking `javascript:`, `data:`, `http:`, and protocol-relative). `schemaVersion` stays `1.0` because no documents have been published. The reference fixture is `tests/fixtures/image-glb.project.json`.

### Open questions raised by this slice

- **Package manager:** the decision above says npm workspaces, but the repo has a pnpm lockfile, a `pnpm run build` test script, and the pnpm-only `workspace:*` protocol, which `npm install` rejects. The README now documents pnpm, the tooling actually in use. Confirm pnpm or migrate.
- **glTF (`.gltf` + external buffers):** currently rejected. Allowing it changes asset validation and loader packaging.
- **Asset URI policy:** whether absolute `https:` URLs to third-party hosts should be allowed, or only our CDN/object-storage origin (a security/hosting decision).
- **First concrete engine:** which engine implements `ImageTrackingEngine` depends on license and runtime verification of `@web-ar-studio/webar-engine-sdk` and alternatives (see Reuse and provenance decisions).
