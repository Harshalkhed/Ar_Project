// Standalone WebXR hit-test proof-of-concept (Android Chrome). iOS Safari has no WebXR, so there it
// falls back to AR Quick Look (Apple's native viewer) -- see quick-look.ts.
// Deliberately NOT wired through TrackingProvider/RuntimeCore yet: unlike image tracking, this has
// never run on real hardware, so proving the raw browser API works comes first (ponytail rung 1).
// If it works, the confirmed-placement half can move behind the same seam ImageTrackingProvider
// uses (see Architecture.md's WebXR scoping entry); the pre-tap reticle stays outside either way.
import { placementSurfaceOf, validateProject, type PlacementSurface, type ProjectDocument } from '@internal-webar/project-schema';
import { ThreeRenderer, type AssetReader } from '@internal-webar/renderer';
import { Box3, Color, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { offerOpenInBrowser } from './in-app-browser.js';
import { createKtx2Loader } from './ktx2.js';
import { buildUsdzUrl, createQuickLookLink, findPrebakedUsdz, supportsQuickLook, WALL_HANGING_CENTRE_M } from './quick-look.js';
import { createObjectControl, setUpTransformGestures, type ObjectControl } from './scale-control.js';
import { anchorFor, floorMountedWallAnchor, surfaceOf } from './surface.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const scaleBadge = document.querySelector<HTMLDivElement>('#scale-badge');
const statusElement = document.querySelector<HTMLParagraphElement>('#status');
const setStatus = (message: string, isError = false): void => {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.dataset.state = isError ? 'error' : 'info';
};

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
  if (!canvas) throw new Error('Canvas is missing.');
  // `?quicklook` forces the iOS path (preview + USDZ export) on any browser, for testing without an iPhone.
  const forceQuickLook = new URLSearchParams(location.search).has('quicklook');
  const webxrSupported = !forceQuickLook && Boolean(navigator.xr) && (await navigator.xr!.isSessionSupported('immersive-ar'));
  // No AR at all (e.g. an Android phone without Google Play Services for AR) still gets the 3D view and
  // a clear reason, never a dead end.
  const arMode: 'webxr' | 'quicklook' | 'none' = webxrSupported ? 'webxr' : forceQuickLook || supportsQuickLook() ? 'quicklook' : 'none';

  const url = new URL(new URLSearchParams(location.search).get('project') ?? 'projects/office-chair/project.json', location.href);
  const project: unknown = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const issues = validateProject(project);
  if (issues.length) throw new Error(`Invalid project: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const raw = project as ProjectDocument;
  const sceneId = raw.scenes[0]?.id;
  if (!sceneId) throw new Error('Project has no scene.');
  // Asset URIs stay relative: readAsset resolves them against the project file. Making them absolute
  // (as ar.ts must, for its tracking engine) fails the schema's relative-or-https rule on http://localhost.
  const document = raw;

  const objectIds = document.scenes.find((s) => s.id === sceneId)?.objectIds ?? [];
  // One WebGL context for both paths; KTX2 support is detected against it before any model loads.
  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  const renderer = new ThreeRenderer({ ktx2Loader: createKtx2Loader(gl) });
  const readAsset: AssetReader = (uri) => fetchBytes(new URL(uri, url));
  await renderer.loadScene(document, sceneId, readAsset);
  for (const objectId of objectIds) renderer.setVisible(objectId, true);
  renderer.setAnchor(null);
  // Room placement shows the object at its real size (the project's own transform, in metres): no
  // auto-fit and no pinch-to-resize. On the floor, dragging only spins it so it stays upright; wall
  // pieces get no gestures at all, since any turn would lift them off the wall.
  const surface = placementSurfaceOf(document);
  const where = surface === 'wall' ? 'a wall' : 'the floor';
  const control = createObjectControl(renderer, objectIds);
  if (scaleBadge) scaleBadge.textContent = 'Real size';
  if (surface === 'floor') setUpTransformGestures(canvas, control, { scale: false, tilt: false });
  if (arMode === 'quicklook') {
    const fromFloor = surface === 'wall' ? await findPrebakedUsdz(url, 'wall-from-floor') : null;
    return startQuickLook(gl, renderer, control, surface, await findPrebakedUsdz(url), fromFloor);
  }
  if (arMode === 'none') return showWithoutAr(gl, renderer, surface);

  const stage = new Scene();
  stage.add(new HemisphereLight(0xffffff, 0x444444, 2), renderer.scene); // PBR materials render black with no light.
  const reticle = new Mesh(new RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x2a6df4 }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  stage.add(reticle);

  gl.xr.enabled = true;
  // Three.js patches this camera's pose from the XR headset/phone each frame during a session.
  const camera = new PerspectiveCamera();
  // Without an explicit domOverlay root, ARButton creates its own near-empty overlay div (just its
  // close button) and only THAT subtree gets real pointer/touch events during the session -- our
  // canvas, status text and scale badge sat outside it and were silently non-interactive/hidden.
  window.document.body.appendChild(
    // `plane-detection` (optional) asks the device to track walls as well as floors (Chrome 147+).
    ARButton.createButton(gl, { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'plane-detection'], domOverlay: { root: window.document.body } }),
  );

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  // A screen touch in WebXR fires `select` when the finger lifts, including at the end of a drag
  // that was spinning the object. Only a tap (little movement) places or moves the object.
  const TAP_MAX_MOVE_PX = 12;
  let touchStart: { x: number; y: number } | null = null;
  let touchMoved = 0;
  canvas.addEventListener('pointerdown', (event) => {
    touchStart = { x: event.clientX, y: event.clientY };
    touchMoved = 0;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (touchStart) touchMoved = Math.max(touchMoved, Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y));
  });
  const controller = gl.xr.getController(0);
  // Where a tap would place the object now: the anchor for the latest hit on the project's surface.
  let candidate: number[] | null = null;
  controller.addEventListener('select', () => {
    if (!candidate || touchMoved > TAP_MAX_MOVE_PX) return;
    renderer.setAnchor(candidate);
    setStatus(surface === 'wall' ? 'Placed at real size. Tap another spot on the wall to move it.' : 'Placed at real size. Tap another spot on the floor to move it; drag to turn it.');
  });
  stage.add(controller);

  // Plain painted walls give ARCore few features to detect, so a wall search can stall; after a while
  // without any wall hit, say how to help it rather than leave people waiting.
  const WALL_HINT_AFTER_MS = 8000;
  let searchingSince: number | null = null;
  let wallHintShown = false;
  let acceptFloorForWall = false;
  gl.setAnimationLoop((time, frame) => {
    if (frame) {
      searchingSince ??= time;
      const referenceSpace = gl.xr.getReferenceSpace();
      const session = gl.xr.getSession();
      if (!hitTestSourceRequested && session && referenceSpace) {
        session.requestReferenceSpace('viewer').then((viewerSpace) => {
          session.requestHitTestSource?.({ space: viewerSpace })?.then((source) => (hitTestSource = source));
        });
        session.addEventListener('end', () => {
          hitTestSourceRequested = false;
          hitTestSource = null;
          searchingSince = null;
          wallHintShown = false;
          acceptFloorForWall = false;
        });
        hitTestSourceRequested = true;
      }
      // Keep hit-testing after placement: the reticle shows where a tap would move the object.
      // Only hits on the project's surface count (a wall piece ignores the floor and vice versa).
      if (hitTestSource && referenceSpace) {
        candidate = null;
        const viewer = frame.getViewerPose(referenceSpace)?.transform.position;
        for (const hit of frame.getHitTestResults(hitTestSource)) {
          const matrix = hit.getPose(referenceSpace)?.transform.matrix;
          let anchor = matrix && anchorFor(matrix, surface);
          // Wall not detectable (plain or dim wall): once offered, a floor tap hangs it at 1.45 m, facing you.
          if (matrix && !anchor && acceptFloorForWall && viewer && surfaceOf(matrix) === 'floor') anchor = floorMountedWallAnchor(matrix, viewer, WALL_HANGING_CENTRE_M);
          if (!matrix || !anchor) continue;
          candidate = anchor;
          reticle.matrix.fromArray(matrix); // The ring lies flat on the surface (its +Y is the normal).
          break;
        }
        reticle.visible = candidate !== null;
        if (candidate) wallHintShown = true; // A wall was found; no hint needed this session.
        if (surface === 'wall' && !wallHintShown && time - searchingSince > WALL_HINT_AFTER_MS) {
          wallHintShown = true;
          acceptFloorForWall = true;
          setStatus('No wall found yet: plain or dim walls are hard to detect. Or tap the floor right in front of the wall: the piece goes up at hanging height (1.45 m), facing you.');
        }
      }
    }
    gl.render(stage, camera);
  });

  setStatus(`Tap "Start AR", point at ${where}, tap the screen to place it at real size.`);
}

// In an in-app browser neither WebXR nor Quick Look usually works; offer the real browser first.
offerOpenInBrowser().then(main).catch((error: unknown) => {
  setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});

/**
 * A 3D view of the scene (Sketchfab-style, drag to turn floor pieces) with a bottom slot for buttons,
 * kept just above the status text. Used before Quick Look and when no AR is available at all.
 */
function startPreview(gl: WebGLRenderer, renderer: ThreeRenderer): HTMLDivElement {
  renderer.setAnchor(IDENTITY); // visible, at the origin, for both the preview and any export
  const stage = new Scene();
  stage.background = new Color(0x20232a);
  stage.add(new HemisphereLight(0xffffff, 0x444444, 2), renderer.scene);

  const box = new Box3().setFromObject(renderer.scene);
  const center = box.getCenter(new Vector3());
  const size = Math.max(...box.getSize(new Vector3()).toArray());
  const camera = new PerspectiveCamera(45, 1, size / 100, size * 100);
  const distance = (size / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.6;
  camera.position.copy(center).add(new Vector3(0, 0.4, 1).normalize().multiplyScalar(distance));
  camera.lookAt(center);

  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const resize = (): void => {
    gl.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  gl.setAnimationLoop(() => gl.render(stage, camera));

  const slot = document.createElement('div');
  slot.style.cssText = 'position:fixed;left:0;right:0;bottom:calc(64px + env(safe-area-inset-bottom));display:flex;justify-content:center;z-index:3';
  document.body.appendChild(slot);
  // Keep the button just above the status text, which wraps to several lines on a narrow phone.
  if (statusElement) {
    new ResizeObserver(() => (slot.style.bottom = `calc(${statusElement.offsetHeight + 24}px + env(safe-area-inset-bottom))`)).observe(statusElement);
  }
  return slot;
}

/** Google Play Services for AR (ARCore), which Chrome needs for WebXR AR on Android. */
const ARCORE_PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.google.ar.core';

/**
 * No WebXR AR and no Quick Look: show the 3D view anyway, say why AR is missing, and on Android point
 * to the one thing that can fix it (Google Play Services for AR; phones that are not ARCore-certified
 * cannot install it, and no website can do room placement on them).
 */
function showWithoutAr(gl: WebGLRenderer, renderer: ThreeRenderer, surface: PlacementSurface): void {
  const slot = startPreview(gl, renderer);
  const meanwhile = surface === 'floor' ? 'Meanwhile, drag to turn the 3D model.' : 'Meanwhile, here is the 3D model.';
  if (/Android/.test(navigator.userAgent)) {
    const link = document.createElement('a');
    link.href = ARCORE_PLAY_STORE;
    link.textContent = 'Get Google Play Services for AR';
    link.style.cssText = 'display:block;min-height:48px;box-sizing:border-box;padding:13px 24px;border-radius:10px;background:#2a6df4;color:#fff;font:600 17px/22px system-ui,sans-serif;text-decoration:none';
    slot.appendChild(link);
    setStatus(`AR isn't available in Chrome on this phone. It needs Google Play Services for AR: install or update it, then reload this page. If the Play Store says your phone isn't compatible, AR can't run on it. ${meanwhile}`);
  } else {
    setStatus(`AR isn't available in this browser. Open this link on an iPhone (Safari or Chrome) or on an Android phone with Google Play Services for AR. ${meanwhile}`);
  }
}

/**
 * iOS: the 3D preview plus a hand-off to AR Quick Look at real size. With a pre-baked USDZ
 * (scripts/build-assets.mjs) the AR button is ready at once; without one, the scene is exported on the
 * phone first (two taps, up to ~30 s for big models).
 */
function startQuickLook(gl: WebGLRenderer, renderer: ThreeRenderer, control: ObjectControl, surface: PlacementSurface, prebakedUsdz: string | null, prebakedFromFloorUsdz: string | null): void {
  const where = surface === 'wall' ? 'a wall' : 'the floor';
  const handling = surface === 'wall' ? 'drag to slide it along the wall' : 'drag to move it, twist to turn it';
  const slot = startPreview(gl, renderer);
  slot.style.flexDirection = 'column';
  slot.style.alignItems = 'center';
  slot.style.gap = '10px';
  // Wall pieces: phones find plain, light or dimly lit walls hard to detect, so offer tips and a second
  // way in that only needs the floor.
  const FROM_FLOOR_LABEL = "Can't find the wall? Place from the floor";
  const wallTips =
    'Point at a wall in good light, 1–2 m away. Plain or light walls are hard for phones to find: a sticky note or a strip of tape on the wall helps. ' +
    `Or use "Place from the floor": it stands at hanging height (1.45 m); drag it back until it touches the wall.`;
  if (prebakedUsdz) {
    slot.appendChild(createQuickLookLink(prebakedUsdz));
    if (surface === 'wall' && prebakedFromFloorUsdz) slot.appendChild(createQuickLookLink(prebakedFromFloorUsdz, FROM_FLOOR_LABEL, true));
    setStatus(surface === 'wall' ? `Real size. ${wallTips}` : `Tap "View in your room (AR)", then point at ${where}. It appears at real size; ${handling}.`);
    return;
  }
  const prepare = document.createElement('button');
  prepare.textContent = 'Prepare AR view';
  prepare.style.cssText = 'font-size:18px;padding:14px 28px;border-radius:10px;border:none;background:#2a6df4;color:#fff';
  prepare.addEventListener('click', async () => {
    prepare.disabled = true;
    setStatus('Preparing the AR model -- a few seconds, up to a minute for large models…');
    try {
      control.resetOrientation(); // export upright at real size, not mid-spin
      slot.replaceChildren(createQuickLookLink(await buildUsdzUrl(renderer.scene, surface)));
      if (surface === 'wall') slot.appendChild(createQuickLookLink(await buildUsdzUrl(renderer.scene, 'wall-from-floor'), FROM_FLOOR_LABEL, true));
      setStatus(surface === 'wall' ? `Ready. ${wallTips}` : `Ready. Tap "View in your room (AR)", then point at ${where}.`);
    } catch (error) {
      prepare.disabled = false;
      setStatus(`AR export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  slot.appendChild(prepare);
  setStatus(`${surface === 'floor' ? 'Drag to turn it, then tap' : 'Tap'} "Prepare AR view" to place it on ${where} at real size.`);
}
