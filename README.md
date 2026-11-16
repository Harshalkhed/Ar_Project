# Internal WebAR Experience Production Platform

This repository is our own internal WebAR production platform. It is not a fork or rename of the upstream Open WebAR SDK. The upstream repository is kept in `.reference/open-webar-sdk` for research and provenance only.

## Current stage

Stage 1, a working WebAR platform verified on real devices. The product goals, approved phases and the mobile/website quality bar are in `PROJECT.md`. Read it first.

| Capability | Page | Android (Chrome) | iPhone (Safari) |
|---|---|---|---|
| Image tracking (in-house engine, no vendor SDK) | `ar.html` | Not yet device-tested | ✅ Verified 2026-09-23 |
| Room placement | `webxr.html` | ✅ WebXR hit-test, verified 2026-09-28 | ✅ AR Quick Look, verified 2026-10-03 |
| Capability check | `check.html` | ✅ | — |

Also included: a versioned project schema, runtime contracts and a Three.js renderer that loads a scene's GLB objects. The site is deployed on Vercel. Image tracking is image-anchored, not room-fixed; see the two-tier plan in `Architecture.md`.

## Documents

- `PROJECT.md` — product goals, approved phases, verified device status, mobile and website quality bar, next 30 days
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

`apps/preview` is a Vite app that validates a project, loads its first scene through `ThreeRenderer`, reveals the scene objects, and frames them with orbit controls (drag to orbit; pinch or scroll to zoom). Its **View in your room (AR)** button opens room placement (`webxr.html`) for the same project. It loads `projects/office-chair/project.json` by default; pass another same-origin project with `?project=projects/<name>/project.json`. Projects and their assets live in `apps/preview/public/projects/<name>/` and are published as-is, so only put publishable assets there. Failures are shown in the status bar.

## Asset pipeline

Master models live in `assets-src/projects/<name>/…`, which is not published. `pnpm run build:assets` turns them into the delivery files under `apps/preview/public/projects/<name>/`:

- each master `.glb` is compressed to the same relative path (Meshopt geometry, KTX2 textures capped at 2048 px, light mesh simplification), so `project.json` keeps pointing at it unchanged;
- each project with a model gets a pre-baked `quicklook.usdz` next to its `project.json`, exported in headless Chromium by the same code iPhones run, from the masters.

Up-to-date outputs are skipped; `--force` rebuilds everything (do this after changing `apps/preview/src/quick-look.ts` or `bake.ts`), and `--skip-usdz` only compresses. To add a model, put the master in `assets-src/projects/<name>/assets/` and reference `assets/<file>.glb` from the project. One-time setup: KTX-Software 4.4+ ([installer](https://github.com/KhronosGroup/KTX-Software/releases); the script finds the default Windows install folder without PATH changes) and `pnpm exec playwright install chromium`.

Vercel builds and serves the site using `vercel.json`. Deploy from the repository root with `npx vercel deploy --prod` after a one-time `npx vercel login`.

## Sales demos

`demos.html` lists three demos (a Seahorn ceramic jar, framed wall art, an apartment floor plan), each with **Scan the brochure page**, **Place in your room**, **Print the brochure page** and a QR code. `brochure.html?demo=showpiece|wall-art|floorplan` is a print-ready A4 page (print or save as PDF from the deployed site, so the QR code points at it). Each demo is a folder under `projects/` with `project.json` (room placement), `scan.json` (brochure scan) and `assets/target.png`; add one in `apps/preview/src/demos.ts`.

Third-party models: NVIDIA SimReady props convert with `python scripts/usd-to-glb.py <prop.usd> <out.glb> --copyright "<NVIDIA notice>"` (needs `pip install --user usd-core`), then `node node_modules/@gltf-transform/cli/bin/cli.js resize <out.glb> assets-src/projects/<name>/assets/<name>.glb --width 1024 --height 1024`, then `pnpm run build:assets`. See `Architecture.md` for the licence decision and notice requirements.

## Real-device test

`apps/preview/ar.html` points the camera at a target image and overlays the tracked 3D model, using our own image-tracking engine (`packages/tracking-image-engine`, `packages/tracking-image`'s `BrowserImageTrackingEngine`) — not a vendor SDK. Needs HTTPS (or `localhost`) and a rear camera:

1. Print the project's target image (or display it full-screen on another device), and open the deployed `.../ar.html` URL (or `?project=projects/<name>/project.json` for a different project) on a phone.
2. Tap "Point camera at target", allow camera access, then point the camera at the target. Found content stays visible (and can be pinch-to-scale resized) even after you look away — tap **Reset** to track again from scratch.
3. If it does not track: the status bar shows a specific reason (e.g. `[permission_denied]`, `[unsupported]`) rather than a blank screen — report what it says.
4. For a device-test report, open `ar.html?debug`: a readout shows frames per second, poses per second, time to first pose (Reset restarts the timer), camera and screen size, and the browser version.

This is **image-anchored** placement: content stays attached to wherever the target currently is on screen, not fixed at a point in the room. Regenerate a different target image with `node scripts/generate-target-image.mjs <out.png> [width] [height] [seed]`.

## Room placement by platform (`webxr.html`)

| Device | What happens | Notes |
|---|---|---|
| Android + Chrome + ARCore | WebXR hit-test placement at **real size**, on the spot of floor you tap; the model stays fixed in the room (WebXR anchors keep it on the floor as tracking improves). Tap another spot to move it, drag to turn it. No resizing. Only the nearest surface under the finger counts, and floor pieces always stand upright. | Needs Google Play Services for AR. Check a device at `check.html`. For a device-test report, open `webxr.html?debug`: it shows the granted AR features, what the ring and your last touch hit (and whether a surface lay behind it), detected planes, and how far the anchor moved the object. |
| iPhone / iPad Safari | A drag-to-turn preview at real size, plus **View in your room (AR)**, which hands off to Apple's AR Quick Look at real size (drag to move, twist to turn; pinch-to-resize is turned off). With a pre-baked `quicklook.usdz` the button is ready at once; without one, **Prepare AR view** exports on the phone first. | iOS has no WebXR. Quick Look is Apple's own viewer, not a vendor SDK. |
| No AR available (e.g. an Android phone without Google Play Services for AR, or a desktop) | The 3D view still loads, with a plain explanation. On Android: a **Get Google Play Services for AR** button (install or update it, then reload). | Phones that are not ARCore-certified cannot install it, and no website can do room placement on them; `ar.html` (brochure tracking) still works there. |
| Wall art (`"placement": { "surface": "wall" }` in the project) | Same pages, but placed on a wall: Android shows the reticle only on walls and hangs the piece upright where you tap (tap again to move it); iPhone Quick Look anchors it to a wall. No turning or resizing. For walls the phone can't detect (plain, light or dim), iPhone offers **Place from the floor** (`quicklook-floor.usdz`, hung at 1.45 m, dragged back to the wall) and Android accepts a floor tap after 8 s. Try `webxr.html?project=projects/wall-art/project.json`. | The placeholder piece comes from `node scripts/generate-wall-art.mjs`. |
| Inside Instagram, Facebook, WhatsApp, LinkedIn and other apps | An **Open in browser** screen first (Android: **Open in Chrome**; iPhone: steps plus **Copy link**), with **Continue here anyway**. `ar.html` shows it too. | In-app browsers usually block the camera and AR. |

iOS test: open `https://<site>/webxr.html?project=projects/floorplan/project.json` in **Safari** (Chrome on iPhone is the same WebKit engine; Quick Look works from Safari). Tap **View in your room (AR)**. Both the pre-baked file and the on-device fallback (**Prepare AR view**, then the AR button) place the model at real size, which comes from the project's own transform in metres (e.g. the office chair is 1.16 m tall), so that transform must be right for each product. `?quicklook` forces this path on any browser to test the preview and export without an iPhone. Image tracking (`ar.html`) already works on iPhone/iPad.

## Next milestone

See `PROJECT.md` → "Next 30 days" for the full, approved backlog. Engineering highlights:

1. **Mobile performance for the image-tracking engine.** Detection now runs in a Web Worker, with optical-flow tracking between detections (2026-11-14). Still open: measuring both on a phone, and calibrating or better approximating camera intrinsics. See the "known limitations" list in `Architecture.md`'s in-house-engine decision entry.
2. **Asset pipeline.** Built 2026-11-14 (see "Asset pipeline" above). Still open: USDZ files are large because three's exporter writes text geometry (floorplan 47 MB); see `Architecture.md`.
3. **Wall-art placement.** Built 2026-11-14 with a placeholder piece (`projects/wall-art`); verified on iPhone (Safari and Chrome). Still open: an ARCore-certified Android phone to confirm Chrome reports walls.
4. **Room-fixed placement behind `TrackingProvider`** (it works today as a standalone page). `'webxr'` is already a valid schema `tracking.type`.
5. **Showcase website** to the mobile quality bar in `PROJECT.md`.
