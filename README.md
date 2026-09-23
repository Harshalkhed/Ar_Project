# Internal WebAR Experience Production Platform

This repository is our own internal WebAR production platform. It is not a fork or rename of the upstream Open WebAR SDK. The upstream repository is kept in `.reference/open-webar-sdk` for research and provenance only.

## Current stage

Stage 0/1: product and architecture foundation, versioned project schema, runtime contracts, a replaceable image-tracking seam, and a Three.js renderer that loads a scene's GLB objects. The preview does not recognize camera targets or draw the loaded model yet.

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

Apply `pose_updated` to the loaded scene from a host that keeps tracking and rendering separate, then implement a concrete `ImageTrackingEngine` adapter and validate the flow on an Android device and an iPhone over HTTPS.

