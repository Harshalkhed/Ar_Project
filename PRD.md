# Internal WebAR Experience Production Platform — PRD

## Vision

Build an internal production system that lets our team turn client briefs into reliable, browser-delivered WebAR experiences. The client receives a stable URL, QR code, hosted experience, optional custom-domain delivery, analytics, and maintenance. The client does not initially access the editor or receive the SDK/source code.

## Product positioning

This is an internal service platform, not an initial self-serve SaaS editor. It combines a project/scene model, mobile WebAR runtime, tracking adapters, asset pipeline, preview, publishing, hosting, and event instrumentation. The selected Open WebAR SDK/ARSY repository is a technical reference and possible isolated provider source, not our product identity.

## Users and workflow

Internal users are producers, designers, 3D/content specialists, engineers, QA, and account/project leads. End users scan a QR code or open a URL, grant camera permission, and interact with the published experience on a capable mobile browser.

`Client requirement → internal project → tracking/assets/scenes → preview → device test → deployment → stable URL/QR → analytics and maintenance`

## Experience types

The long-term provider roadmap includes image tracking, QR tracking, WebXR/markerless AR, AR360, face tracking, product configurator, GEO AR, and VPS. MVP scope is image tracking with one or more triggers, a scene, a GLB placeholder/reference, a transform, an interaction, and a previewable runtime document.

## Requirements

### Editor and project

- Create a project and experience without hardcoding content into runtime code.
- Choose a tracking type, register targets, reference assets by stable IDs, and create multiple scenes.
- Support transforms, basic visibility, interaction definitions, and future animation definitions.
- Keep project documents versioned and serializable.

### Runtime

- Mobile-first browser runtime with feature detection and explicit states for permission, unsupported devices, tracking failure, asset failure, and recovery.
- Separate renderer, tracking, scene, interaction, asset, device, and analytics modules.
- Emit structured events such as `runtime_initialized`, `tracking_initialized`, `target_found`, `target_lost`, `object_interacted`, and `experience_completed`.

### Publishing and hosting

- Draft, test, production, and archived deployment states.
- Stable experience ID resolves to an active deployment/version so updates do not require new QR codes.
- Our domain is MVP; client domains and CDN/object-storage choices remain designed extension points.

### Security and performance

- Validate file type, size, project references, and public/private boundaries.
- Never ship internal secrets or execute arbitrary project-authored JavaScript.
- Proposed engineering targets: first meaningful runtime UI under 3 seconds on a representative mobile connection, tracking initialization feedback under 5 seconds when supported, and a clear error state for every initialization failure. These are targets, not guarantees.

## Roadmap

### MVP

Project schema, runtime core, image-tracking provider boundary, asset references, basic scene/object state, interaction event model, preview, and a test deployment fixture.

### V1

Real image target integration, GLB loading, transform editing, basic animation, internal editor shell, build/publish flow, QR generation, device test checklist, and analytics ingestion.

### Later

QR, WebXR, AR360, face, configurator, GEO, VPS, client-domain deployment, richer asset optimization, organization/client/campaign hierarchy, and operational analytics.

## Non-goals now

No billing, customer dashboard, public self-serve editor, native applications, VPS/GEO implementation, large analytics product, or full game-engine-style editor.

## Success criteria

The initial phase is successful when the six handoff documents, source capability map, licensing record, independent repository, schema, runtime contracts, provider seam, tests, and a runnable preview foundation exist. The first production milestone is a real device flow: create project → image target → GLB → transform → interaction → build → URL → camera → recognized target → visible content.

## Acceptance criteria

- A future engineer can understand the product without this prompt.
- Runtime code consumes project data rather than hardcoded scene content.
- Provider-specific SDK types do not appear in project schema.
- Unsupported capabilities produce a visible, structured failure state.
- All foundational commands are documented in `README.md`.

## Open questions

Storage/database choice, editor framework, Three.js renderer boundary, real image-tracking provider and WASM packaging, project validation library, hosting/CDN, CI provider, and the exact amount of ARSY code that is safe and useful to isolate behind the provider boundary remain decisions for the next milestone.

