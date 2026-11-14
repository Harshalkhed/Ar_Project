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

- **Verified on a real device (2026-09-23, iPhone Safari):** detection, tracking, pose smoothing, pinch-to-scale, and Reset all confirmed working against the office-chair target photo. Not yet verified: Android/Chrome, other target images, low light, distance/angle extremes.
- **Camera intrinsics are an assumed constant** (62° horizontal field of view), not read from the device or calibrated, because `getUserMedia` does not expose camera calibration. This affects the *absolute scale* of the recovered pose (a wrong assumed focal length biases recovered distance) though not detection or orientation. A calibration step is future work.
- *(Resolved 2026-11-14: pyramidal Lucas-Kanade optical flow now runs between detections; see that entry below.)* **No inter-frame tracking (optical flow).** Every frame is detected independently from scratch; `LiveImageTracker`'s hysteresis only absorbs isolated missed frames, not sustained fast motion or motion blur. Real trackers typically add a much cheaper frame-to-frame tracker (e.g. Lucas-Kanade optical flow) between full re-detections for both smoothness and frame rate; this is the most impactful next performance step.
- *(Resolved 2026-11-14: detection and target compilation now run in a Web Worker; see that entry below.)* **Pure JavaScript on the main thread**, not yet in a Web Worker, no WASM/SIMD. Achievable frame rate on real mobile hardware is unmeasured. The PRD's "tracking initialization feedback under 5 seconds" and general mobile performance targets are unverified for this engine and likely need a Worker (keeps the main thread responsive) before a WASM rewrite is justified.
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

### 2026-09-23 — WebXR room placement: scoping (design only, nothing built yet)

**Goal.** Content placed once (a tap on a real surface) stays visually fixed at that point in the room as the phone moves around, on Android Chrome. This is a different problem from image tracking: the target is "wherever the person taps," not a known image, and the phone's own 6-DOF motion (from ARCore, via WebXR) does the tracking, not our CV pipeline.

**What already fits, unchanged:**
- `tracking.type: 'webxr'` is already a valid schema value (`packages/project-schema`).
- A `TrackingProvider` (`initialize`/`start`/`stop`/`onEvent`) is the right shape for a WebXR provider too: `initialize` starts the WebXR session and hit-test source, `start` begins the per-frame loop, `onEvent` fires the same `initialized` / `target_found` / `pose_updated` / `target_lost` / `error` vocabulary already defined in `packages/tracking`. No new `TrackingEvent` variants are needed for the *confirmed, placed* anchor's lifecycle: `target_found` = the moment the person taps to place, `pose_updated` = each frame's updated anchor pose, `target_lost` = the session or anchor tracking becomes unrecoverable (rarer than in image tracking, but WebXR sessions can end unexpectedly, e.g. a permissions change or `visibilitychange`).
- `RuntimeCore`'s state machine and `RendererAdapter.setAnchor` are already tracking-type-agnostic; a WebXR provider's `pose_updated` should be able to drive `renderer.setAnchor(pose)` exactly as `ImageTrackingProvider`'s does now.

**What is genuinely new and needs a decision, not a guess:**
- **The "where would this place if I tapped now" reticle.** Before the first tap, the person needs live feedback on the surface under their crosshair (`XRHitTestSource` results, every frame). This does not fit the `target_found`/`pose_updated` vocabulary, which is about a *confirmed* target — using it for a live, unconfirmed reticle would conflate "placed" and "previewing," which existing image-tracking hosts (and any future host) would then have to special-case. **Proposal:** keep reticle hit-testing entirely inside a WebXR-specific engine interface (analogous to `ImageTrackingEngine`, e.g. `WebXRPlacementEngine`) that a WebXR-specific host (a new `apps/preview/ar-webxr.html`) talks to directly for the reticle, and only calls into the generic `TrackingProvider`/`RuntimeCore` path once a tap confirms a placement. This mirrors how `ImageTrackingEngine`'s richer callback shape (`targetFound`/`targetLost`/`poseUpdated`/`failed`) already sits *underneath* the generic `TrackingProvider`, not inside it.
- **Schema validation for a `'webxr'` trigger's `config`.** Unlike `'image'` triggers (which must set `config.imageAssetId`), a WebXR trigger has no target asset — `config` would likely be empty or hold placement constraints (e.g. `surfaceType: 'horizontal' | 'vertical' | 'any'`). `packages/project-schema/src/validation.ts` currently validates nothing for non-image trigger types; this needs an explicit, deliberate rule (even if the rule is "no fields required") rather than silently staying unchecked.
- **Session lifecycle and permission UX.** `navigator.xr.isSessionSupported('immersive-ar')` must be checked before offering the mode at all (unsupported devices/browsers need a visible, specific message, per `Architecture-Essentials.md` rule 9 — not a silent fallback). `requiredFeatures: ['hit-test']`, `optionalFeatures: ['dom-overlay', 'anchors']` and a DOM overlay for the tap-to-place UI need their own design; a full immersive-ar session also takes over the page's rendering loop differently from the current `getUserMedia` + `<canvas>` approach used by `ar.html`, so `apps/preview/ar-webxr.html` will need its own render loop (`session.requestAnimationFrame`, `XRWebGLLayer`), not a copy of `ar.ts`'s.
- **Anchors vs raw reference-space math.** WebXR `anchors` (`frame.createAnchor`) let the underlying system re-correct a placement's pose as its own tracking refines over time (more stable over a longer session than computing the placement's pose once and assuming the reference space never drifts). `anchors` is an optional feature — needs a documented fallback for devices that support hit-test but not anchors.

**Testability, honestly.** The image-tracking engine's core (65 tests) is pure math, verifiable offline against known answers with zero device dependency. A WebXR provider has no equivalent: `navigator.xr`, session lifecycle, hit-test results, and anchors are all live, device- and ARCore-version-dependent browser APIs with no meaningful way to fake them in Node, and this environment has no Android device to test against at all. The honest testing plan is: (1) keep whatever pure logic exists (e.g. deciding when to show/hide the reticle, mapping a hit-test pose to our column-major pose format) in small, unit-tested functions, exactly like `LiveImageTracker`'s hysteresis logic; (2) accept that the WebXR session/hit-test/anchor glue itself can only be verified by a person with an Android Chrome device running it, the same way the image-tracking engine's `BrowserImageTrackingEngine` glue could only be confirmed once tested on the product owner's iPhone.

**Update, 2026-09-28: built and confirmed working**, not via `TrackingProvider` (`apps/preview/webxr.html`/`src/webxr.ts`, still a standalone page per the plan above): hit-test placement, pinch/scroll resize, and a two-axis orbit gesture (drag to spin/tilt, with momentum) all verified on a real Android/Chrome device. Two real bugs surfaced and were fixed along the way — both the same root cause: the recenter `position` offset baked into a project is only valid for the rotation/scale it was computed for, so scaling or rotating the object without correspondingly transforming that offset swings the model away from its anchor instead of resizing/turning in place. Fixed by scaling and rotating `position` together with `scale`/`rotation` (`apps/preview/src/scale-control.ts`, `transform-utils.ts`).

**Device support is per-device, not per-Android-version.** WebXR `immersive-ar` needs Google Play Services for AR (ARCore) installed, updated, and certified for that specific hardware — Chrome exposes `navigator.xr.isSessionSupported('immersive-ar')` accordingly, and `webxr.ts` already surfaces a specific, visible message when it returns false (per `Architecture-Essentials.md` rule 9), which is what a person saw on an Android 15 device with no ARCore support. This is not fixable in our code; there is no substitute for ARCore short of the vendor-SLAM option already rejected twice. The practical diagnostic (not yet formalized into a support matrix) is: check whether "Google Play Services for AR" is installable from the Play Store on the device, and whether the public reference demo (https://immersive-web.github.io/webxr-samples/) also fails there — if it does, the device itself cannot run WebXR, regardless of what we ship.

### 2026-10-02 — iOS room placement via AR Quick Look (refines the two-tier decision)

The earlier tier-2 note said iOS room placement was unreachable without a paid SDK. That was too strong: iOS cannot do *WebXR*, but Apple's own **AR Quick Look** is reachable from a web page and gives native surface placement, pinch-scale and rotate — it is a platform feature, not a vendor SDK, so it does not reopen the rejected-SDK question.

- **Decision:** when WebXR is unavailable and `relList.supports('ar')` is true (Apple's documented check, not UA sniffing), `webxr.html` shows the same drag/pinch preview and exports the currently-scaled scene to USDZ in the browser with three's bundled `USDZExporter` (`quickLookCompatible`, textures capped at 1024 px, horizontal-plane anchoring), then hands off via a real `<a rel="ar">`. Export and launch are separate taps because Safari will not honour a programmatic click after a multi-second async export.
- **Alternatives:** pre-generating USDZ at build time (the exporter needs a browser canvas for textures; a headless-browser build step is a bigger dependency), or a vendor SLAM engine (rejected twice).
- **Trade-offs:** we lose our own UI in the AR view (Quick Look owns it), and what is placed is the *exported snapshot* (size baked in, upright); the floorplan's orbit/momentum gestures exist only in the preview. Quick Look materials are basic PBR; it does not run our scene graph.
- **Measured (desktop browser, 2026-10-02):** office chair → 21 MB USDZ in ~1 s; floorplan → 50 MB USDZ in ~30 s (cost is texture re-encoding, not geometry). Phone timings and memory are unmeasured.
- **Verified on an iPhone (2026-10-03):** the floorplan opened in Quick Look from the blob-URL `<a rel="ar">` two-tap flow, so the blob URL is accepted and the 50 MB export did not crash Safari; it also felt smoother than our image tracking (native ARKit vs. camera-only JS detection). Still unchecked on a device: return-from-AR preview state, exact placed size, pinch-vs-page-zoom, and export time/memory on older phones.

### 2026-11-14 — Image detection moves into a Web Worker

**Existing decision:** `BrowserImageTrackingEngine` captured, compiled targets and ran full detection on the main thread inside `requestAnimationFrame`, so every detection (tens of ms on desktop, more on phones) blocked rendering and touch gestures.

- **Decision:** the main thread now only captures. Each frame it draws the camera into a ≤480 px canvas, reads back RGBA, and *transfers* the buffer (zero-copy) to a module Worker (`packages/tracking-image/src/detection-worker.ts`). The Worker converts to grayscale and runs `LiveImageTracker`. Target fetch, decode (`OffscreenCanvas`) and compilation also run in the Worker. At most one frame is in flight: while the Worker is busy, frames are skipped rather than queued, so detection latency never builds up. Replies carry a `session` number so results from before a stop/start are dropped.
- **Seam unchanged:** `ImageTrackingEngine` and `ImageTrackingProvider` are untouched; the Worker is internal to the adapter. The message handling (`detection-protocol.ts`, `createDetectionHandler`) has no Worker globals, so `tests/detection-protocol.test.mjs` runs it in Node against synthetic frames. Only the Worker entry and postMessage glue are browser-only.
- **Alternatives:** transferring an `ImageBitmap` (`createImageBitmap(video)`) moves the readback off the main thread too, but its resize options are not reliable on older Safari; at 480 px the main-thread readback is small, so it stays for now. A WASM/SIMD detector is a separate, later step if Worker throughput is not enough.
- **Trade-offs:** the rendered pose now lags the camera image by one detection (the frame was captured before detection finished). This is the reason optical flow (backlog item 2, part two) matters: a cheap per-frame tracker in the Worker can update the pose between full detections.
- **Measured (desktop Chrome, built site, 2026-11-14):** office-chair target loads in the Worker; a synthetic 480×360 frame is detected in ~35 ms per frame (found, then pose updates). Phone numbers are not measured yet: compare `ar.html?debug` fps before and after this change on the same Android phone.
- **Requirements:** module Workers and `OffscreenCanvas` 2D in a Worker (Chrome 80+/69+, Safari 15+/16.4+). Older Safari would fail at target load with a visible `target_load_failed` error, not a blank screen.

### 2026-11-14 — Optical-flow tracking between detections

**Existing decision:** `LiveImageTracker` ran full detection (features, matching, RANSAC, pose refinement) on every frame, so frame rate was bounded by detection cost.

- **Decision:** after a successful detection, the tracker keeps its RANSAC inliers (target-plane point ↔ frame pixel, now exposed on `Detection.correspondences`) and the frame's image pyramid. On the next frame, `trackPoints` (`packages/tracking-image-engine/src/flow.ts`) follows those points with pyramidal Lucas-Kanade (Bouguet's coarse-to-fine form: 3 levels, ±7 px window, so motion of 20+ px per frame is reachable). Each point must also track back to within 1 px of where it started (forward-backward check), and points on flat patches are rejected by a minimum-eigenvalue test. A homography is re-fitted with RANSAC from the surviving points, and the pose comes from it plus 5 Gauss-Newton refinement steps. The refinement starts from whichever is closer: last frame's pose or the new closed-form fit.
- **When full detection still runs:** when fewer than 12 points survive flow, when the homography fit fails, and every 15 flow frames regardless (`redetectEvery`), which corrects slow drift and lets a different target take over. A miss is counted only when both flow and detection fail, so the `lostAfterMisses` behaviour is unchanged. `flow: false` restores detection on every frame.
- **Seam unchanged:** `LiveTrackerEvent` gains a `source: 'detection' | 'flow'` field; `ImageTrackingEngine`, the provider and `ar.ts` are untouched.
- **Alternatives:** tracking a template patch around each corner with normalised cross-correlation (simpler, but no sub-pixel accuracy and weak under rotation), or tracking the whole target with direct image alignment (more accurate, but a much larger solver). Lucas-Kanade on the detector's own inliers reuses the existing homography and pose code.
- **Testing** (`tests/optical-flow.test.mjs`, known answers, not self-agreement): a known 11/−6 px image shift (beyond the ±7 px window, so the pyramid is needed) is recovered within 0.1 px for every kept point. Of the grid points rejected, 19 of 23 would have tracked to the wrong place. A flow frame's pose matches the true synthetic pose within the detector's own tolerance. Also tested: the redetection schedule, `flow: false`, and fallback to detection when flow loses the target.
- **Measured (desktop Chrome, built site worker, 480×360, 2026-11-14):** flow frames ~12 ms against ~45 ms for full detection, about 3.7× faster. Over a 20-frame drift sequence, 18 frames used flow and the depth estimate moved by 0.003 across the redetection. Phone timings are not measured yet; the `ar.html?debug` poses/s figure is the number to compare on Android.
- **Known limitations:** tracked points only ever decrease between detections (no new corners are added mid-track), so fast or large motion relies on the 15-frame refresh or a fallback detection. Motion blur and sudden lighting changes break Lucas-Kanade's brightness-constancy assumption; those frames fall back to detection. The thresholds (12 points, 15 frames, 1 px forward-backward) are tuned on synthetic frames, not on a phone.

**Provenance (optical flow).** `flow.ts` is our own implementation from the published description of pyramidal Lucas-Kanade (Lucas & Kanade 1981; Bouguet's pyramidal formulation) and the forward-backward error check (Kalal et al. 2010). No third-party source was copied, and no dependency was added.

### 2026-11-14 — Asset pipeline: compressed GLBs and pre-baked Quick Look USDZ

**Existing decision:** projects published their master GLBs as-is (office chair 10.9 MB, floorplan 18.5 MB, against the 2–5 MB budget in `PROJECT.md`), and iPhones exported a USDZ on the device every time (the 2026-10-02 entry: up to ~30 s and ~50 MB for the floorplan).

- **Decision: masters out of the published folder.** Masters now live in `assets-src/projects/` (not deployed); only derivatives are published, following `PROJECT.md`'s "source files never ship" rule.
- **Decision: `scripts/build-assets.mjs` (`pnpm run build:assets`), run locally, outputs committed.** (1) glTF-Transform `optimize`: Meshopt geometry, KTX2 textures (ETC1S for colour, UASTC for normal/data maps), 2048 px cap, plus its default light mesh simplification (0.01% error), written to the same relative path so `project.json` is unchanged. (2) For every project with a model, a pre-baked `quicklook.usdz` exported in headless Chromium (Playwright driving a Vite dev server) by `apps/preview/src/bake.ts`, which calls the same `buildUsdzBytes` iPhones use. It reads the masters (by intercepting the model requests), never the KTX2 derivatives, because the exporter needs canvas-readable textures and should not inherit KTX2 loss. The baked size is the page's default auto-fit size, upright.
- **Runtime:** `ThreeRenderer` always registers the Meshopt decoder and takes an optional `KTX2Loader` from the host (`new ThreeRenderer({ ktx2Loader })`), because KTX2 format support must be detected against the page's own WebGL context; pages now create their `WebGLRenderer` before loading models (`apps/preview/src/ktx2.ts`). three 0.186's `KTX2Loader` locates its Basis transcoder via `import.meta.url`, which Vite bundles; it is fetched only when a KTX2 texture loads. `webxr.html` on iPhone HEAD-checks `quicklook.usdz` next to `project.json`: if present, the Quick Look button is ready at once (one tap); otherwise the old on-device export remains as fallback. A dev server's HTML fallback page does not count as the file.
- **USDZ textures:** `buildUsdzBytes` now tags every texture without alpha as JPEG (three's exporter otherwise writes PNG), for pre-baked and on-device exports alike.
- **Measured (2026-11-14):** chair GLB 10.91 → 2.65 MB (167k → 48k triangles), floorplan GLB 18.54 → 3.32 MB (206k → 201k triangles); model bounds unchanged (worst difference 0.011 model units ≈ 0.1 mm), so the recentre offsets in `project.json` stay valid. Both render correctly in the built site, transcoder included. USDZ: chair 15.5 MB, floorplan 47.4 MB, of which textures are only 0.8–2.4 MB; the rest is three's plain-text USDA geometry (USDZ itself must be stored uncompressed).
- **Alternatives:** WebP textures (no system install, but decoded to full size on the GPU); `?url`-copied or checked-in transcoder files (unnecessary given three's own lookup); a manual "bake page" instead of Playwright; Blender or Apple's `usdzconvert` for USDZ (not installed here / macOS-only, and would diverge from the iPhone export path).
- **Tools and licences (build-time only, nothing ships):** `@gltf-transform/cli` (MIT) and `playwright` (Apache-2.0) as root dev dependencies; KTX-Software 4.4.2 (Apache-2.0, official signed Khronos installer). The Basis transcoder that does ship comes from three (MIT; Basis Universal, Apache-2.0).
- **Known limitations / open question:** USDZ size. Committing the current files adds ~110 MB to git per bake (two identical 47 MB floorplan files, since `floorplan-image` uses the same model), and an iPhone downloads 47 MB on tapping AR for the floorplan. Converting the USDA geometry to binary USDC with Pixar's `usd-core` (Python, TOST-1.0 licence) is the likely fix; not yet decided. Also: the 2048 px cap has no 1024 px low-end variant yet; the baked file ignores the person's preview pinch size (Quick Look has its own pinch); `ar.html` still makes asset URIs absolute for its tracking engine, which fails the schema's relative-or-https rule on plain `http://localhost` (`webxr.ts` and `bake.ts` no longer do this).

### 2026-11-14 — Wall pieces on walls the phone cannot detect

**Problem (testers, 2026-11-14, on non-Pro iPhones, Pro iPhones and Android):** wall art would not place on white or light-coloured walls, or in low light. Camera-based plane detection (ARKit without LiDAR, ARCore) tracks visible detail, and a plain wall gives it almost none; Quick Look's detection is not ours to change.

- **Decision (product owner): tips plus a floor fallback.** Wall pieces get a second way in that only needs the floor, which usually has texture: anchored to the floor, lifted so the piece's centre (its origin, by the wall convention) hangs at 1.45 m (57 in, the usual gallery height), and the person drags it back until it touches the wall.
- **iPhone:** wall projects get a second pre-baked file, `quicklook-floor.usdz` (`forQuickLook(scene, 'wall-from-floor')`: upright, lifted 1.45 m, horizontal anchoring; the asset pipeline bakes it for every `placement.surface: "wall"` project), offered as an outlined second button, "Can't find the wall? Place from the floor". The status gives tips: good light, 1–2 m away, a sticky note or tape on a plain wall.
- **Android:** if no wall hit arrives 8 s into a session, floor hits are accepted for wall pieces too: `floorMountedWallAnchor` lifts the piece to 1.45 m and turns it about the vertical to face the viewer (from the viewer pose).
- **Trade-off:** the fallback is aligned by eye, so the piece can sit a few centimetres off the wall and is not attached to it.
- **Open:** that LiDAR Pro iPhones also failed suggests more than detection alone (perhaps low light affecting Quick Look's tracking); the floor fallback sidesteps it either way. Not yet re-tested on the testers' phones.

### 2026-11-14 — No dead end when a phone has no AR

**Existing behaviour:** `webxr.html` threw before loading anything when neither WebXR AR nor Quick Look was available, leaving a black page with a red "supports neither" error. On 2026-11-14 the product owner's Android phone, and others they shared the wall-art link with, hit exactly this: Chrome reports no `immersive-ar` support when Google Play Services for AR (ARCore) is missing or the phone is not ARCore-certified.

- **Decision:** a third mode, `none`. The page still loads the project and shows the shared 3D preview (`startPreview`, also used before Quick Look), with an informational (not error) status explaining why. On Android it adds a **Get Google Play Services for AR** button (the Play Store page for `com.google.ar.core`): installing or updating it fixes phones that are certified; the status says that a "not compatible" Play Store answer means AR cannot run on that phone. Elsewhere it suggests an iPhone or an ARCore Android phone.
- **Also:** in WebXR wall placement, if no wall hit has arrived 8 s into a session, the status explains that plain walls are hard to detect and how to help (distance, texture, slow sideways motion), instead of an endless "point at a wall".
- **Not verified on the affected phones** (that the Play Store button resolves it where it can); checked in the browser pane with Android emulation, where the page shows the 3D view, the explanation and a 48 px button.

### 2026-11-14 — Wall placement for wall art (schema: optional `placement.surface`)

**Existing schema:** a project had no way to say where room placement should put it; everything went on the floor.

- **Decision (product owner, 2026-11-14): a project-level field.** `ProjectDocument.placement?: { surface: 'floor' | 'wall' }`, validated in `validateProject` and read through `placementSurfaceOf` (missing means `floor`, so every existing project is unchanged). It is project-level because room placement anchors the whole scene as one; a per-object field was considered but would not be used yet, and the `webxr` trigger's config (sketched in September) would leave image-tracking projects that are also room-placed, like the office chair, with nowhere to say it.
- **Wall convention:** a wall-placed model faces +Z with +Y up, and its origin is the centre of its back, so it hangs flat against the wall at the anchor point.
- **Android (WebXR):** `plane-detection` is requested as an optional session feature so the device also tracks walls. Hit-test poses have +Y along the surface normal; `surfaceOf` (`apps/preview/src/surface.ts`) classifies a hit as floor (normal within ~37° of up) or wall (within ~17° of horizontal), and only hits on the project's surface show the reticle or accept a tap. `wallAnchor` turns a wall hit into an orthonormal pose with +Z out of the wall and +Y as close to world-up as the wall allows (no sideways roll even when the detected wall leans). Wall pieces get no drag gestures, since turning them would lift them off the wall; tapping elsewhere on a wall moves them.
- **iPhone (Quick Look):** `buildUsdzBytes(root, surface)` sets `preliminary:planeAnchoring:alignment = "vertical"` for wall projects (three's `USDZExporter` `ar` option), for pre-baked and on-device exports alike.
- **Placeholder piece:** `scripts/generate-wall-art.mjs` builds a framed picture GLB by hand (62 × 82 cm frame, 56 × 76 cm canvas, 3 cm deep, our own generated abstract artwork, no dependencies) into `assets-src/projects/wall-art/`; the asset pipeline publishes it with its USDZ as `projects/wall-art`. It passes glTF-Transform validation with no errors or warnings.
- **Testing:** `tests/surface.test.mjs` checks the classification and the wall pose against hand-derived answers (including a leaning wall); `tests/schema.test.mjs` the new field; `tests/quick-look.test.mjs` the anchoring choice. In the browser pane, the iPhone path shows the picture upright and facing the viewer, says "point at a wall", links to the vertical-anchored USDZ, and ignores drags.
- **iPhone result, 2026-11-14, and fix:** Quick Look anchored the piece to the wall, but sticking out of it like a shelf with its face down. Its wall anchor is a horizontal plane turned onto the wall (Apple's ARKit docs say the vertical anchor transform is "rotating a horizontal plane to match" the surface): +Y points out of the wall and -Z up it. `forQuickLook` now exports wall content inside a group turned -90° about X (+Z → +Y, +Y → -Z), on a clone so the live preview is untouched (three's exporter writes only the scene's children, so the root/anchor transform never reaches the file). **Verified on the iPhone 2026-11-14:** the piece now hangs flat and upright, in Safari and in Chrome (after the `isQuickLookBrowser` fix for Chrome, Edge and Firefox on iOS).
- **Open, needs devices:** whether Chrome on Android reports wall hits with `plane-detection`.
- **Pipeline note:** `--force` re-encodes every output, and the KTX2/USDZ encoders are not byte-for-byte deterministic, so unchanged models come out as new bytes. Restore those with `git checkout` instead of committing them, which would add tens of MB of history for nothing. Whether Chrome on Android reports wall hits with `plane-detection` is unverified without an Android phone.

### 2026-11-14 — Room placement is real size and move-only

**Existing behaviour:** `webxr.html` auto-fitted every model to about 1 m on its longest side, and both WebXR and the Quick Look preview let people pinch to resize and drag to tilt. The pre-baked USDZ used the same auto-fitted size (the office chair at 86%). Once placed in WebXR, an object could not be moved.

- **Decision (product owner, 2026-11-14):** room placement shows the real object: the project's own transform, in metres, with no auto-fit and no resizing; the object can be moved and turned, but not scaled or tilted. `ar.html` (brochure image tracking) is unchanged and keeps pinch-to-scale, because there the model sits on a printed page.
- **WebXR (Android):** placed at scale 1. Hit-testing continues after placement, and a tap moves the object to the reticle. A WebXR screen touch fires `select` when the finger lifts, including after a drag, so a `select` only counts if the finger moved under 12 px since `pointerdown`; drags still spin the object about the vertical axis. `setUpTransformGestures(canvas, control, { scale: false, tilt: false })` turns off pinch, wheel and tilt.
- **Quick Look (iPhone):** the pre-baked and on-device USDZ are both exported at scale 1 (verified: chair USDZ root transform identity, `metersPerUnit = 1`, geometry 0.68 × 0.66 × 1.16 m, matching the master). Links use Apple's documented `#allowsContentScaling=0` (`quickLookHref`), so Quick Look allows moving and turning but not pinch-to-resize.
- **Trade-off:** real size is only as correct as each project's transform. The floorplan is about 3.5 × 3.7 m at real size, with no way to shrink it to a tabletop in room placement; tabletop viewing is what `ar.html` is for. `floorplan-image` keeps its 90° tip (made for image tracking), so its room-placement bake stands on edge; it should not be used with `webxr.html`.
- **Not verified on a device:** tap-to-move and the drag-versus-tap threshold in WebXR (no Android phone available), and `allowsContentScaling=0` in Quick Look. Also fixed: on a phone-width screen the Quick Look button overlapped the wrapped status text; it now stays above it.

### 2026-11-14 — In-app browsers get an "Open in browser" step

**Existing behaviour:** a link opened inside Instagram, Facebook, WhatsApp, LinkedIn and similar apps loaded the AR pages in the app's own web view, which usually blocks the camera, WebXR and AR Quick Look. `webxr.html` only mentioned this inside its "supports neither" error.

- **Decision:** `apps/preview/src/in-app-browser.ts` detects in-app browsers from user-agent tokens the apps add themselves (Instagram, Facebook, Messenger, LinkedIn, WhatsApp, Snapchat, TikTok, WeChat, LINE, Pinterest, X), plus Android's generic web-view marker `; wv)`. Chrome Custom Tabs and Safari View Controller report the real browser and are not flagged. `ar.html` shows the screen over its start screen before any camera prompt; `webxr.html` shows it before checking WebXR or Quick Look support.
- **The screen:** on Android, **Open in Chrome** is an `intent://…#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=…;end` link (Chrome is the WebXR target; without Chrome it falls back to the same page). iOS has no supported way for a page to open Safari, so iPhones get steps ("tap ⋯ or share → Open in Safari / Open in browser") and a **Copy link** button. The link is always shown in a selectable box, because web views often block the clipboard; the button then selects it instead. **Continue here anyway** dismisses the screen, since UA detection can be wrong and some apps do allow the camera. Mobile quality bar: 48 px buttons, safe-area padding, no horizontal scroll at 375 px, `role="dialog"` with focus moved to the heading.
- **Alternatives:** feature detection alone (camera and Quick Look checks cannot tell "blocked by the app" from "unsupported device", and the camera check needs a permission prompt first); the undocumented `x-safari-https://` scheme on iOS (not relied on, since it is unsupported and unverified on our devices).
- **Testing:** `tests/in-app-browser.test.mjs` covers real-world UA formats for 11 apps on iOS and Android, the unnamed Android web view, real browsers that must not be flagged (Safari, Chrome Android, Chrome iOS, Samsung Internet, desktop Chrome), and the intent URL. The screen was checked at 375×812 in the browser pane for both platforms, including the clipboard-blocked fallback and Continue. **Not yet verified inside real apps:** whether each app's intent handling opens Chrome, and whether the iPhone menu wording matches each app's current UI.
