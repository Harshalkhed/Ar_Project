// Standalone WebXR hit-test proof-of-concept (Android Chrome only; iOS Safari has no WebXR).
// Deliberately NOT wired through TrackingProvider/RuntimeCore yet: unlike image tracking, this has
// never run on real hardware, so proving the raw browser API works comes first (ponytail rung 1).
// If it works, the confirmed-placement half can move behind the same seam ImageTrackingProvider
// uses (see Architecture.md's WebXR scoping entry); the pre-tap reticle stays outside either way.
import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { ThreeRenderer, type AssetReader } from '@internal-webar/renderer';
import { HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, WebGLRenderer } from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { withAbsoluteAssetUris } from './resolve-assets.js';
import { createScaleControl, setUpScaleGestures } from './scale-control.js';

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
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-ar'))) {
    throw new Error('This browser/device does not support WebXR immersive-ar (needs Android Chrome).');
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
  renderer.setAnchor(null);
  const { setScale, getScale } = createScaleControl(renderer, objectIds, (scale) => {
    if (scaleBadge) scaleBadge.textContent = `${Math.round(scale * 100)}%`;
  });
  setUpScaleGestures(canvas, setScale, getScale);

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
  window.document.body.appendChild(ARButton.createButton(gl, { requiredFeatures: ['hit-test'] }));

  let hitTestSource: XRHitTestSource | null = null;
  let hitTestSourceRequested = false;
  let placed = false;
  const controller = gl.xr.getController(0);
  controller.addEventListener('select', () => {
    if (!reticle.visible || placed) return;
    renderer.setAnchor(Array.from(reticle.matrix.elements));
    placed = true;
    reticle.visible = false;
    setStatus('Placed. Pinch or scroll to resize.');
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
