# Internal WebAR Experience Production Platform

This repository is our own internal WebAR production platform. It is not a fork or rename of the upstream Open WebAR SDK. The upstream repository is kept in `.reference/open-webar-sdk` for research and provenance only.

## Current stage

Stage 0/1: product and architecture foundation, versioned project schema, runtime contracts, an in-house image-tracking engine (no vendor AR SDK), and a Three.js renderer that loads a scene's GLB objects. `apps/preview` has two pages: a desktop 3D viewer, and `ar.html`, a real camera image-tracking test page — confirmed working on a real iPhone (detection, pose smoothing, pinch-to-scale, Reset). This is image-anchored placement, not room-fixed placement; see the two-tier plan in `Architecture.md`.

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

## Real-device test

`apps/preview/ar.html` points the camera at a target image and overlays the tracked 3D model, using our own image-tracking engine (`packages/tracking-image-engine`, `packages/tracking-image`'s `BrowserImageTrackingEngine`) — not a vendor SDK. Needs HTTPS (or `localhost`) and a rear camera:

1. Print the project's target image (or display it full-screen on another device), and open the deployed `.../ar.html` URL (or `?project=projects/<name>/project.json` for a different project) on a phone.
2. Tap "Point camera at target", allow camera access, then point the camera at the target. Found content stays visible (and can be pinch-to-scale resized) even after you look away — tap **Reset** to track again from scratch.
3. If it does not track: the status bar shows a specific reason (e.g. `[permission_denied]`, `[unsupported]`) rather than a blank screen — report what it says.

This is **image-anchored** placement: content stays attached to wherever the target currently is on screen, not fixed at a point in the room. Regenerate a different target image with `node scripts/generate-target-image.mjs <out.png> [width] [height] [seed]`.

## Room placement by platform (`webxr.html`)

| Device | What happens | Notes |
|---|---|---|
| Android + Chrome + ARCore | WebXR hit-test placement; the model stays fixed in the room. Drag to rotate/tilt (with momentum), pinch/scroll to resize. | Needs Google Play Services for AR. Check a device at `check.html`. |
| iPhone / iPad Safari | Same drag/pinch preview, then **Prepare AR view** → **View in your room (AR)** hands off to Apple's AR Quick Look (native placement, pinch, rotate). | iOS has no WebXR. Quick Look is Apple's own viewer, not a vendor SDK. |
| Anything else | A visible "supports neither" message. | |

iOS test: open `https://<site>/webxr.html?project=projects/floorplan/project.json` in **Safari** (Chrome on iPhone is the same WebKit engine; Quick Look works from Safari). Tap **Prepare AR view**, wait for "Ready", tap **View in your room (AR)**. The export bakes in the current size (the `%` badge) at an upright orientation; heavy models take longer (office chair ≈ 1 s / 21 MB; floorplan ≈ 30 s / 50 MB on a desktop). `?quicklook` forces this path on any browser to test the preview and export without an iPhone. Image tracking (`ar.html`) already works on iPhone/iPad.

## Next milestone

Two tracks, per the two-tier decision in `Architecture.md`:

1. **Room-fixed placement behind `TrackingProvider`** (it works today as a standalone page on Android, and via Quick Look on iOS). `'webxr'` is already a valid schema `tracking.type`.
2. **Mobile performance for the existing image-tracking engine.** Move detection into a Web Worker, add frame-to-frame (optical flow) tracking between full re-detections, and calibrate or better-approximate camera intrinsics. See the "known limitations" list in `Architecture.md`'s in-house-engine decision entry.

