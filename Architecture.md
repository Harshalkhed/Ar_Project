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
- **`three@0.186.0`** (MIT, Copyright © 2010-2026 three.js authors, https://github.com/mrdoob/three.js). Added as a runtime dependency of `packages/renderer` only. The published npm package is consumed as-is; no three.js source is copied into this repository, and nothing is taken from `.reference/open-webar-sdk`. `GLTFLoader` is imported from the package's own `three/addons/loaders/GLTFLoader.js` entry (`examples/jsm`). The `three@0.186.0` tarball contains no `.d.ts` files.
- **`@types/three@0.186.0`** (MIT, Copyright (c) Microsoft Corporation, DefinitelyTyped). Compile-time types for `three@0.186.0` only. Not shipped in the runtime bundle beyond what the compiler erases.

This is a preliminary technical licensing review and is not legal advice.

## Boundaries

```text
Internal editor → versioned project document → runtime core
                                      ↘ tracking provider adapter
                                      ↘ renderer adapter (Three.js GLB loader)
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
packages/renderer/            Three.js GLB loader behind RendererAdapter
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

Decisions: npm workspaces initially, strict TypeScript, provider-neutral schema, injected runtime dependencies, image tracking first, no upstream source copy, and a Three.js renderer isolated in `packages/renderer`. Open questions: pnpm vs npm at scale, editor framework, validation library, WASM worker strategy, storage/database, hosting/CDN, CI, and the exact provider package to integrate.


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
- **Not yet in the contract (superseded the same day):** per-frame target pose. Added in the renderer-boundary decision below.

### 2026-09-23 — Schema 1.0 validation rules (no document shape change)

`validateProject` now takes `unknown` and checks, in addition to the earlier rules: the document is an object, the collections are arrays, IDs are unique within each collection, scene `objectIds` and interaction `targetId`/`sceneId` references resolve, image triggers set `config.imageAssetId` to an `image` asset, `model` assets are `.glb`, and asset URIs are relative paths or `https:` URLs (blocking `javascript:`, `data:`, `http:`, and protocol-relative). `schemaVersion` stays `1.0` because no documents have been published. The reference fixture is `tests/fixtures/image-glb.project.json`.

### 2026-09-23 — Renderer boundary and target pose

- **Existing:** `TrackingEvent` had no pose. `packages/renderer` was only a proposed future boundary, and “Three.js package boundary” was an open question. Nothing loaded a GLB.
- **Change:** `TargetPose` is a column-major 4×4 matrix of 16 finite numbers, the same layout as Three.js `Matrix4.elements` (translation in elements 12, 13, and 14). It is optional on `target_found`. `pose_updated` carries a pose and does not change the found/lost set or the runtime state. A pose that is not 16 finite numbers is dropped. `ImageTrackingEngineCallbacks.targetFound` accepts an optional pose, and `poseUpdated` forwards later frames. No camera engine is included.
- **Renderer:** `RendererAdapter` loads one scene from an untrusted project (`validateProject` again at the boundary), applies each object's `Transform`, sets visibility, and disposes. `ThreeRenderer` is the only implementation. Model assets are read through an injected `AssetReader` (the renderer does not fetch URLs), rejected unless the bytes start with the GLB magic `glTF`, then parsed with `GLTFLoader`. `packages/renderer` does not import `tracking` or `tracking-image`. Those packages do not import the renderer. `RuntimeCore` forwards pose and does not construct a renderer.
- **Transform:** rotation is Euler XYZ in radians, matching `Object3D.rotation`. The document shape is unchanged, so `schemaVersion` stays `1.0`. The reference model is a self-authored one-triangle GLB at `tests/fixtures/assets/placeholder.glb` (`assets/placeholder.glb` on `asset-model`).
- **Alternatives:** fold Three.js into `runtime-core` (couples lifecycle to one renderer); allow `.gltf` plus external buffers (rejected in the schema slice); copy a sample GLB or loader from three.js examples or `.reference/open-webar-sdk` (license and boundary); store rotation in degrees (an extra conversion at the adapter).
- **Impact:** `three@0.186.0` and `@types/three@0.186.0` belong to `packages/renderer` only. `@types/three` is required because that three tarball ships no `.d.ts`. Tests cover pose forwarding, GLB load, a bad magic header (`asset_load_failed`), and the import boundary.
- **Migration:** published documents do not change. A host that wants pixels must pass an `AssetReader`, call `loadScene`, and apply `pose_updated` itself. That host is not in this slice.

### Open questions raised by this slice

- **Package manager:** the decision above says npm workspaces, but the repo has a pnpm lockfile, a `pnpm run build` test script, and the pnpm-only `workspace:*` protocol, which `npm install` rejects. The README now documents pnpm, the tooling actually in use. Confirm pnpm or migrate.
- **glTF (`.gltf` + external buffers):** currently rejected. Allowing it changes asset validation and loader packaging.
- **Asset URI policy:** whether absolute `https:` URLs to third-party hosts should be allowed, or only our CDN/object-storage origin (a security/hosting decision).
- **First concrete engine:** which engine implements `ImageTrackingEngine` depends on license and runtime verification of `@web-ar-studio/webar-engine-sdk` and alternatives (see Reuse and provenance decisions).
- **Pose application:** `TargetPose` is forwarded by the runtime and is not applied to a rendered object. The renderer must not import tracking, so a host (preview or runtime compositor) should copy `pose_updated` onto the loaded object's matrix.
- **Asset bytes:** the renderer receives bytes from `AssetReader`. Which host resolves `assets/placeholder.glb` and `https:` URIs (preview, CDN, object storage) is still the asset-URI policy question above.

### 2026-09-23 — Hosted preview on Vercel (built with Vite)

- **Decision:** `apps/preview` is a workspace package and a 3D viewer. It validates a project, loads a scene through `ThreeRenderer`, reveals the scene's objects (there is no tracking yet), and draws them on its own stage (lights, `PerspectiveCamera`, `OrbitControls`, framing that works in portrait). `ThreeRenderer.scene` is public so a Three.js host can draw it; the `RendererAdapter` contract is unchanged.
- **Build:** Vite 8.3.0 (MIT, dev dependency of `apps/preview` only) bundles the viewer into `apps/preview/site/` with `base: './'`. Preview projects and their assets live in `apps/preview/public/projects/<name>/` and are copied as-is. `tests/schema.test.mjs` validates every published project and checks its model files exist.
- **Hosting:** Vercel (`vercel.json`) runs `pnpm install` and `pnpm run build:site` and serves `apps/preview/site`, giving an HTTPS URL a phone can open from a QR code. pnpm is pinned through `npx pnpm@12.5.1` rather than relying on Vercel's pnpm detection. `.vercelignore` excludes `.reference`, build output and `node_modules`.
- **Alternatives:** GitHub Pages (requires a public repo on the free tier, a CI workflow, and a subpath base URL); a zero-dependency Node static server with an import map (tried first; not deployable, since it served `node_modules` from the repository root, and it was removed); exposing the dev server on the LAN (no HTTPS, so it cannot be used for camera tracking).
- **Security:** the viewer only accepts same-origin `?project=` URLs; asset URIs are validated by the schema and resolved relative to the project file. The site is public, so only publishable assets may be placed in `public/projects`.
- **Asset:** `office_chair.glb` (Sketchfab export, ~11.4 MB, ~167k triangles, PNG textures). The owner confirmed it may be published without attribution (2026-09-23).
- **Open questions:** a mobile asset budget (triangle count, texture size and format such as KTX2/WebP, file size); the stable experience ID → deployment URL mapping and the stable QR code from the PRD (a Vercel URL is not yet that stable ID); and whether Vercel remains the MVP host (compared with object storage plus a CDN).

### 2026-09-23 — In-house image-tracking engine (no vendor SDK)

**Context.** The ARSY/`@web-ar-studio/webar-engine-sdk` reference (see Reuse and provenance decisions) is a closed, API-key-metered commercial service with usage limits and remote licensing checks. An alternative commercial engine (8th Wall) was also evaluated and rejected for the same reason. Decision: image tracking is our own code, top to bottom. No third-party or vendor AR SDK is used anywhere in this slice.

**New package: `packages/tracking-image-engine`.** A pure computation library (no DOM dependency, runs and is unit-tested in plain Node) implementing:

- `image.ts` — grayscale conversion, separable Gaussian blur, bilinear resize (image pyramid support).
- `features.ts` — FAST-9 corner detection with 3×3 non-maximum suppression and sub-pixel localisation (quadratic fit on the corner-score surface); intensity-centroid keypoint orientation; a steered 256-bit binary descriptor sampled over a fixed, seeded random point-pair pattern (our own pattern, not a published learned one — versioned together with the compiled-target format, since changing it invalidates existing compiled targets).
- `matching.ts` — Hamming-distance nearest-neighbour matching with Lowe's ratio test.
- `homography.ts` — normalised direct linear transform (Hartley normalisation) for the 4-point minimal solve and the least-squares refit, RANSAC for outlier rejection.
- `pose.ts` — closed-form camera pose from a plane-to-image homography (standard decomposition: normalise by the camera intrinsics, recover translation and two rotation columns from the homography's first two columns, complete the rotation via cross product, then find the nearest proper rotation by Newton polar iteration); `poseFromHomography`/`projectionFromIntrinsics` produce column-major OpenGL/Three.js matrices directly.
- `refine.ts` — 6-DOF Gauss-Newton refinement of the closed-form pose against the raw matched pixel correspondences (not the homography's own reprojection), i.e. it directly minimises what we actually care about. This is necessary: the closed-form pose from an unconstrained 8-DOF homography fit was measurably biased at oblique viewing angles (a rotation-column error up to ~0.07, ~4°, in a deterministic test at a 35°/-25°/60° synthetic tilt) even though the fitted homography reprojected target corners to within 2-3 px. Refinement brought the same case's worst rotation-column error down to 0.009 (5x inside the 0.05 test tolerance) with translation error under 0.01. Both the closed-form estimate and the refinement are exported separately (`cvPoseFromHomography`, `refinePose`) so either can be tested and used independently.
- `target.ts` — the compiled-target format (`compileImageTarget`/`serializeCompiledTarget`/`parseCompiledTarget`), versioned (`COMPILED_TARGET_VERSION`) and validated when parsed from untrusted JSON (the asset pipeline's "validate untrusted project and asset metadata at boundaries" rule).
- `detector.ts` (`ImageTargetDetector`) — full-frame detection: extract frame features, match against each compiled target, RANSAC + refine, pick the best-supported target.
- `live-tracker.ts` (`LiveImageTracker`) — turns independent per-frame detections into a found/pose/lost event sequence with hysteresis (`lostAfterMisses`, default 3): a target is reported found on the first successful detection, but a miss only clears it after several consecutive missed frames, so single dropped frames do not flicker the target away. This is deliberately decoupled from any camera or timing API, so it is unit-tested with synthetic frames; only the browser adapter below drives it from a real camera.

**Correctness testing** (`tests/image-engine.test.mjs`, `tests/live-tracker.test.mjs`, `tests/support/synthetic-images.mjs`). Every stage is tested against a known answer computed independently in the test file (not by asserting the algorithm agrees with itself): an exact analytic homography solve, RANSAC recovery under 40% synthetic outliers, closed-form pose against hand-derived expected matrices, and end-to-end detection recovering a known pose from a synthetically rendered frame (texture warped through a known homography into a plausible camera image) at two viewing angles. 65/65 tests pass.

**New adapter: `BrowserImageTrackingEngine`** (`packages/tracking-image/src/browser-engine.ts`). Implements the existing `ImageTrackingEngine` seam (unchanged contract) using `getUserMedia`, a hidden `<video>`/`OffscreenCanvas` capture loop, and the engine above. `packages/tracking-image`'s `tsconfig.json` now includes the `DOM` lib (this package's non-browser tests were already structured as duck-typed interfaces, e.g. `BrowserScope`, so this only affects type-checking, not what is testable in Node). Camera errors (`getUserMedia` `DOMException`s) propagate unchanged so `ImageTrackingProvider`'s existing `cameraErrorCode` mapping classifies them.

**New page: `apps/preview/ar.html` / `src/ar.ts`**, a real camera device-test page. Wires `RuntimeCore` + `ImageTrackingProvider(new BrowserImageTrackingEngine())` + `ThreeRenderer` together: on `target_found`/`pose_updated` it calls `renderer.setAnchor(pose)` and sets the Three.js camera's `projectionMatrix` directly from the event's `projection` (the camera itself stays at the identity transform, since the tracker's pose is already camera-relative — the standard "model-view matrix from tracker, camera at origin" pattern used by comparable AR SDKs). On `target_lost` or any `runtime_error` it hides the anchor and shows a visible, coded status message (never a blank screen, per `Architecture-Essentials.md` rule 9). `vite.config.mjs` now builds both pages (`rolldownOptions.input`).

**Camera passthrough is a second, independent stream.** The page's own `<video>` (background, for the person to see what they are pointing at) opens its own `getUserMedia` call, separate from `BrowserImageTrackingEngine`'s internal capture used for detection. This keeps the tracking/rendering boundary clean (the tracking engine does not expose its internal video element, and the renderer/host does not reach into tracking internals) at the cost of two simultaneous camera opens. **Open question:** whether to share a single stream between passthrough display and detection once real-device battery/performance data justifies the added coupling.

**Target image for device testing.** `apps/preview/public/projects/office-chair/project.json` referenced `assets/poster.jpg`, which did not exist (the "published preview projects... ship their model files" test only checked model-kind assets, so this went uncaught). The test now checks every relative-URI asset, not just models, and a real, printable target (`assets/target.png`) was generated deterministically by `scripts/generate-target-image.mjs` (high-contrast, asymmetric shapes plus corner marks, so orientation is unambiguous; a valid PNG built with only Node's built-in `zlib`, no new dependency, since this is a build-time script, not shipped runtime code).

**Known limitations, stated plainly:**

- **No real-device verification yet.** This environment has no physical Android/iPhone, and the automated browser pane sandboxes camera access (verified: the page correctly reaches the camera prompt and shows a visible, coded error when permission is denied — `Failed to start: [permission_denied] ...` — but a granted-permission, real-camera, real-target run has not been observed yet). This is the required next step and needs a person with a device.
- **Camera intrinsics are an assumed constant** (62° horizontal field of view), not read from the device or calibrated, because `getUserMedia` does not expose camera calibration. This affects the *absolute scale* of the recovered pose (a wrong assumed focal length biases recovered distance) though not detection or orientation. A calibration step is future work.
- **No inter-frame tracking (optical flow).** Every frame is detected independently from scratch; `LiveImageTracker`'s hysteresis only absorbs isolated missed frames, not sustained fast motion or motion blur. Real trackers typically add a much cheaper frame-to-frame tracker (e.g. Lucas-Kanade optical flow) between full re-detections for both smoothness and frame rate; this is the most impactful next performance step.
- **Pure JavaScript on the main thread**, not yet in a Web Worker, no WASM/SIMD. Achievable frame rate on real mobile hardware is unmeasured. The PRD's "tracking initialization feedback under 5 seconds" and general mobile performance targets are unverified for this engine and likely need a Worker (keeps the main thread responsive) before a WASM rewrite is justified.
- **One target set per detector instance**, matched by brute-force per target; this is fine for the PRD's "one or more triggers" MVP scope but will need a shared vocabulary/index before it scales to many simultaneous targets.
- Target compilation (`compileImageTarget`) runs synchronously when a project loads; a very large or high-resolution target image would briefly block the main thread. Not an issue for the current single-target test project.

**Provenance.** Every algorithm in `packages/tracking-image-engine` (FAST corners, the descriptor and its sampling pattern, homography DLT/RANSAC, pose recovery, Gauss-Newton refinement) is our own implementation written from the published mathematical description, not copied or adapted from any third-party source code, including `.reference/open-webar-sdk`. No new runtime dependency was added for it. `scripts/generate-target-image.mjs` uses only Node's built-in `zlib`.

### 2026-09-23 — First real-device test result, and a two-tier room-placement decision

**Real-device result.** The image-tracking engine was tested on a real iPhone (Safari) for the first time: camera passthrough, permissions, the full runtime pipeline, and target detection all worked. Two real issues came back: (1) the recovered pose jitters frame to frame (expected — see "no inter-frame tracking" limitation above; every frame is detected independently with no smoothing), and (2) the content disappears the moment `target_lost` fires, which is correct per the current runtime contract but not what a "place an object" experience should do.

**Decision: room-scale "walk around it" placement needs a second tracking provider, not an image-tracking feature.** Our image-tracking engine recovers the target's pose relative to the camera *only while the target is visible*; it has no model of where the phone itself is once the target leaves the frame. Making content stay fixed in physical space as the person walks around requires the device to track its own 6-DOF motion through the room — this is what `WebXR`/SLAM is for, and it is already an anticipated `TrackingType` in the schema (`'webxr'`), listed in `PRD.md`'s roadmap as a later phase.

**Platform split (a hard constraint, not a choice):** the WebXR Device API (`navigator.xr`, hit-test, anchors) is supported by Chrome/Edge on Android (backed by ARCore) but has never been implemented by Safari on iOS, and there is no sign of that changing. A website cannot reach ARKit's world tracking on iOS by any other means. This is exactly why commercial engines like 8th Wall and WebAR Studio/ARSY (both already rejected in this project, see the reuse/provenance and in-house-engine decisions above) built their own proprietary sensor-fusion SLAM: it is a multi-month computer-vision effort, not an incremental slice, and out of scope here.

**Decision (confirmed with the product owner, 2026-09-23):** ship two honest tiers rather than one imperfect one:

1. **Image-anchored placement (this slice, all platforms, including iOS).** Smooth the pose (reduces jitter), and once a target is found, keep the content visible and stable even after `target_lost` (a "lock" the person can reset), plus a scale control. This does **not** keep content fixed in the room if the phone moves away from the target — it is explicitly an image-anchored/screen-relative placement, not world placement. See `apps/preview/src/pose-smoother.ts` and the updated `ar.ts` lock/scale/reset behaviour.
2. **WebXR world placement (Android Chrome only, separately scoped next milestone, not yet built).** A new `TrackingProvider` implementing WebXR hit-test and anchors, behind the same provider-neutral contract used by `ImageTrackingProvider` — `runtime-core` and `project-schema` need no changes beyond what already exists (`'webxr'` is already a valid `tracking.type`). This has not been started: it needs its own design pass (session lifecycle, a "tap to place" UI, hit-test surface visualization) and, unlike the image-tracking engine, cannot be verified at all without a physical Android device, which was not available when this decision was made.

**Open question:** whether iOS should eventually get a licensed vendor SLAM specifically for room placement (reopening the vendor-SDK question rejected twice already, see the reuse/provenance and in-house-engine decisions above) — deferred, not decided.
