# Internal WebAR Experience Production Platform

This repository is our own internal WebAR production platform. It is not a fork or rename of the upstream Open WebAR SDK. The upstream repository is kept in `.reference/open-webar-sdk` for research and provenance only.

## Current stage

Stage 0/1: product and architecture foundation, versioned project schema, runtime contracts, a replaceable image-tracking seam, and a Three.js renderer that loads a scene's GLB objects. `apps/preview` is a desktop 3D viewer for a project scene; it does not use the camera or recognize targets yet.

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
pnpm preview         # builds, then starts the viewer at http://localhost:5173/
pnpm run preview:lan # same, reachable from a phone on your Wi-Fi (HTTP only)
pnpm run build:site  # static site in apps/preview/site (what Vercel deploys)
```

Each package builds to its own `packages/<name>/dist` through TypeScript project references. The reference project fixture (image trigger → scene → GLB model object) is `tests/fixtures/image-glb.project.json`.

## Preview and hosting

`apps/preview` is a Vite app that validates a project, loads its first scene through `ThreeRenderer`, reveals the scene objects, and frames them with orbit controls (drag to orbit; pinch or scroll to zoom). It loads `projects/office-chair/project.json` by default; pass another same-origin project with `?project=projects/<name>/project.json`. Projects and their assets live in `apps/preview/public/projects/<name>/` and are published as-is, so only put publishable assets there. Failures are shown in the status bar.

Vercel builds and serves the site using `vercel.json`. Deploy from the repository root with `npx vercel deploy --prod` after a one-time `npx vercel login`.

## Next milestone

Apply `pose_updated` to the loaded scene from a host that keeps tracking and rendering separate, then implement a concrete `ImageTrackingEngine` adapter and validate the flow on an Android device and an iPhone over HTTPS.

