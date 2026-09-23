# Internal WebAR Experience Production Platform

This repository is our own internal WebAR production platform. It is not a fork or rename of the upstream Open WebAR SDK. The upstream repository is kept in `.reference/open-webar-sdk` for research and provenance only.

## Current stage

Stage 0/1: product and architecture foundation, versioned project schema, runtime contracts, and replaceable tracking seams. The current preview is a foundation fixture; it does not claim to recognize camera targets yet.

## Documents

- `PRD.md` — product requirements and roadmap
- `Architecture.md` — technical architecture and research record
- `Architecture-Essentials.md` — non-negotiable rules
- `Claude.md` — implementation-agent instructions
- `GPT.md` — architecture-review instructions
- `Agents.md` — responsibility model

## Commands

Requires Node.js 18+ (on Windows, Node 21+ so `node --test` expands the test glob itself) and pnpm. The workspace uses the pnpm `workspace:*` protocol; see the package-manager open question in `Architecture.md`.

```text
pnpm install
pnpm run typecheck   # tsc -b (incremental; emits to each package's gitignored dist/)
pnpm test            # builds, then runs node --test tests/*.test.mjs
pnpm run clean       # removes build output
```

Each package builds to its own `packages/<name>/dist` through TypeScript project references. The reference project fixture (image trigger → scene → GLB model object) is `tests/fixtures/image-glb.project.json`.

## Next milestone

Implement a concrete `ImageTrackingEngine` adapter (the seam in `packages/tracking-image`), add GLB loading through the rendering boundary, and validate the complete flow on an Android and an iPhone device over HTTPS.

