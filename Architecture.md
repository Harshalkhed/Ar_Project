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

