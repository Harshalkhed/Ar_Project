// Standalone WebXR hit-test proof-of-concept (Android Chrome). iOS Safari has no WebXR, so there it
// falls back to AR Quick Look (Apple's native viewer) -- see quick-look.ts.
// Deliberately NOT wired through TrackingProvider/RuntimeCore yet: unlike image tracking, this has
// never run on real hardware, so proving the raw browser API works comes first (ponytail rung 1).
// If it works, the confirmed-placement half can move behind the same seam ImageTrackingProvider
// uses (see Architecture.md's WebXR scoping entry); the pre-tap reticle stays outside either way.
import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { ThreeRenderer, type AssetReader } from '@internal-webar/renderer';
import { Box3, Color, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3, WebGLRenderer } from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { buildUsdzUrl, createQuickLookLink, supportsQuickLook } from './quick-look.js';
import { withAbsoluteAssetUris } from './resolve-assets.js';
import { autoFitScale, createObjectControl, setUpTransformGestures, type ObjectControl } from './scale-control.js';

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
  if (!webxrSupported && !forceQuickLook && !supportsQuickLook()) {
    throw new Error('This browser/device supports neither WebXR AR (Android Chrome) nor AR Quick Look (iPhone/iPad Safari). In-app browsers (Instagram, Slack, etc.) usually block both -- open this link in Safari or Chrome.');
  }

  const url = new URL(new URLSearchParams(location.search).get('project') ?? 'projects/office-chair/project.json', location.href);
  const project: unknown = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const issues = validateProject(project);
  if (issues.length) throw new Error(`Invalid project: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const raw = project as ProjectDocument;
  const sceneId = raw.scenes[0]?.id;
  if (!sceneId) throw new Error('Project has no scene.');
  const document = withAbsoluteAssetUris(raw, url);

  const objectIds = document.scenes.find((s) => s.id === sceneId)?.objectIds ?? [];
  const renderer = new ThreeRenderer();
  const readAsset: AssetReader = (uri) => fetchBytes(new URL(uri, url));
  await renderer.loadScene(document, sceneId, readAsset);
  for (const objectId of objectIds) renderer.setVisible(objectId, true);
  const autoScale = autoFitScale(renderer.scene);
  renderer.setAnchor(null);
  const control = createObjectControl(renderer, objectIds, (scale) => {
    if (scaleBadge) scaleBadge.textContent = `${Math.round(scale * 100)}%`;
  });
  control.setScale(autoScale); // Drag to rotate, pinch/scroll to resize, from here.
  setUpTransformGestures(canvas, control);
  if (!webxrSupported) return startQuickLook(canvas, renderer, control);

  const stage = new Scene();
  stage.add(new HemisphereLight(0xffffff, 0x444444, 2), renderer.scene); // PBR materials render black with no light.
  const reticle = new Mesh(new RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x2a6df4 }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  stage.add(reticle);

  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  gl.xr.enabled = true;
  // Three.js patches this camera's pose from the XR headset/phone each frame during a session.
  const camera = new PerspectiveCamera();
  // Without an explicit domOverlay root, ARButton creates its own near-empty overlay div (just its
  // close button) and only THAT subtree gets real pointer/touch events during the session -- our
  // canvas, status text and scale badge sat outside it and were silently non-interactive/hidden.
  window.document.body.appendChild(
    ARButton.createButton(gl, { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: window.document.body } }),
  );

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let placed = false;
  const controller = gl.xr.getController(0);
  controller.addEventListener('select', () => {
    if (!reticle.visible || placed) return;
    renderer.setAnchor(Array.from(reticle.matrix.elements));
    placed = true;
    reticle.visible = false;
    setStatus('Placed. Drag to rotate, pinch or scroll to resize.');
  });
  stage.add(controller);

  gl.setAnimationLoop((_time, frame) => {
    if (frame) {
      const referenceSpace = gl.xr.getReferenceSpace();
      const session = gl.xr.getSession();
      if (!hitTestSourceRequested && session && referenceSpace) {
        session.requestReferenceSpace('viewer').then((viewerSpace) => {
          session.requestHitTestSource?.({ space: viewerSpace })?.then((source) => (hitTestSource = source));
        });
        session.addEventListener('end', () => {
          hitTestSourceRequested = false;
          hitTestSource = null;
        });
        hitTestSourceRequested = true;
      }
      if (hitTestSource && referenceSpace && !placed) {
        const hits = frame.getHitTestResults(hitTestSource);
        if (hits.length > 0) {
          const pose = hits[0].getPose(referenceSpace);
          if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
          }
        } else {
          reticle.visible = false;
        }
      }
    }
    gl.render(stage, camera);
  });

  setStatus('Tap "Start AR", point at a flat surface, tap the screen to place.');
}

main().catch((error: unknown) => {
  setStatus(`Failed: ${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});

/** iOS fallback: a Sketchfab-style preview (drag/pinch still work) plus a two-tap hand-off to AR Quick Look. */
function startQuickLook(canvas: HTMLCanvasElement, renderer: ThreeRenderer, control: ObjectControl): void {
  renderer.setAnchor(IDENTITY); // visible, at the origin, for both the preview and the export
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

  const gl = new WebGLRenderer({ canvas, antialias: true });
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
  const prepare = document.createElement('button');
  prepare.textContent = 'Prepare AR view';
  prepare.style.cssText = 'font-size:18px;padding:14px 28px;border-radius:10px;border:none;background:#2a6df4;color:#fff';
  prepare.addEventListener('click', async () => {
    prepare.disabled = true;
    setStatus('Preparing the AR model -- a few seconds, up to a minute for large models…');
    try {
      control.resetOrientation(); // place it upright at the size you chose, not mid-spin
      slot.replaceChildren(createQuickLookLink(await buildUsdzUrl(renderer.scene)));
      setStatus('Ready. Tap "View in your room (AR)", then point at the floor or a table.');
    } catch (error) {
      prepare.disabled = false;
      setStatus(`AR export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });
  slot.appendChild(prepare);
  document.body.appendChild(slot);
  setStatus('Drag to rotate, pinch to resize, then tap "Prepare AR view" to place it in your room.');
}
