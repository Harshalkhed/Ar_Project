# WebAR Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish an independent internal WebAR production-platform foundation with documented product intent, a versioned project schema, a runtime core, and replaceable tracking-provider interfaces.

**Architecture:** Project data is a versioned, provider-neutral document. The runtime consumes that document and coordinates scene, asset, interaction, analytics, and tracking services. Tracking providers are adapters behind a stable interface; upstream ARSY remains a documented reference and is not copied into the initial codebase.

**Tech Stack:** TypeScript, Node.js 18+, npm workspaces, Vitest-compatible test seams, browser APIs, and Three.js integration deferred until the rendering package is introduced.

**Spec:** `MASTER PROJECT BOOTSTRAP PROMPT.docx` (source brief; extracted and analyzed during initialization)

## Global Constraints

- The initial business model is an internal production tool; clients receive published experiences, not the editor.
- Editor and runtime remain separate.
- Tracking and rendering remain separate.
- Provider-specific APIs must not leak into project data.
- The project schema is versioned and supports multiple triggers and scenes.
- The first provider target is image tracking; QR, WebXR, AR360, face, GEO, and VPS are later providers.
- This phase must avoid billing, customer SaaS dashboards, native apps, and a full editor.
- Licensing notes are technical research only, not legal advice.

## Review Focus

- Unknown or future tracking providers must be rejected explicitly rather than silently selected.
- Invalid project documents must produce actionable validation errors.
- Runtime startup failures must be observable and must not degrade to a blank screen.
- Asset references must remain stable when an asset URL changes.
- Published deployments must resolve a stable experience identifier to an explicit version.

### Task 1: Product and architecture documentation

**Files:** `PRD.md`, `Architecture.md`, `Architecture-Essentials.md`, `Claude.md`, `GPT.md`, `Agents.md`, `README.md`

- [ ] Record the repository inspection, product reference, capability map, licensing/provenance, open questions, and initial decisions.
- [ ] Cross-check all six handoff documents for consistent business and architecture rules.

### Task 2: Repository foundation

**Files:** `package.json`, `tsconfig.json`, `packages/*`, `apps/preview`, `tests`

- [ ] Define npm workspaces and TypeScript project references.
- [ ] Add package boundaries for schema, runtime, and tracking.
- [ ] Add a test command and typecheck command.

### Task 3: Versioned project schema

**Files:** `packages/project-schema/src/index.ts`, `packages/project-schema/src/validation.ts`, `packages/project-schema/tests/schema.test.ts`

- [ ] Define project, trigger, scene, asset, object, interaction, and deployment types.
- [ ] Validate schema version, unique IDs, trigger references, and stable asset references.

### Task 4: Runtime and tracking contracts

**Files:** `packages/tracking/src/index.ts`, `packages/runtime-core/src/index.ts`, tests

- [ ] Define provider-neutral tracking lifecycle and runtime event contracts.
- [ ] Implement runtime startup, provider selection, structured events, and failure states.

### Task 5: Image provider seam and vertical-slice fixture

**Files:** `packages/tracking-image/src/index.ts`, `apps/preview/index.html`, `apps/preview/src/main.ts`, tests

- [ ] Add an image provider adapter seam that can later wrap ARSY or another implementation.
- [ ] Add a browser-preview fixture that loads a project document and renders runtime state without pretending to perform camera tracking.
- [ ] Document the next implementation milestone for real image recognition and GLB loading.

