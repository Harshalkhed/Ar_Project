import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { RendererError, ThreeRenderer, type AssetReader } from '@internal-webar/renderer';
import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_PROJECT = 'projects/office-chair/project.json';

const statusElement = document.querySelector<HTMLParagraphElement>('#status');
const canvas = document.querySelector<HTMLCanvasElement>('#viewport');

function setStatus(message: string, isError = false): void {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.dataset.state = isError ? 'error' : 'info';
}

/** Only same-origin project URLs are accepted from the query string. */
function projectUrl(): URL {
  const requested = new URL(new URLSearchParams(location.search).get('project') ?? DEFAULT_PROJECT, location.href);
  if (requested.origin !== location.origin) throw new Error(`Project must be served from ${location.origin}.`);
  return requested;
}

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

function frame(camera: PerspectiveCamera, controls: OrbitControls, root: Scene): void {
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z);
  // Fit whichever field of view is narrower, so portrait phones do not crop the model sideways.
  const halfVertical = (camera.fov * Math.PI) / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const distance = (radius / (2 * Math.tan(Math.min(halfVertical, halfHorizontal)))) * 1.3;
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.position.copy(center).add(new Vector3(0.6, 0.4, 1).normalize().multiplyScalar(distance));
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

async function main(): Promise<void> {
  if (!canvas) throw new Error('Preview canvas is missing.');
  const url = projectUrl();
  setStatus(`Loading project ${url.pathname}…`);
  const project: unknown = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const issues = validateProject(project);
  if (issues.length) throw new Error(`Invalid project: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  const document = project as ProjectDocument;
  const sceneId = document.triggers[0]?.sceneIds[0] ?? document.scenes[0]?.id;
  if (!sceneId) throw new Error('Project has no scene to preview.');

  const renderer = new ThreeRenderer();
  const readAsset: AssetReader = async (uri) => {
    setStatus(`Downloading ${uri}…`);
    const bytes = await fetchBytes(new URL(uri, url));
    setStatus(`Parsing ${uri} (${(bytes.byteLength / 1048576).toFixed(1)} MB)…`);
    return bytes;
  };
  const started = performance.now();
  await renderer.loadScene(document, sceneId, readAsset);
  // Preview has no tracking, so reveal every object that would appear once the target is found.
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  for (const objectId of scene?.objectIds ?? []) renderer.setVisible(objectId, true);

  const stage = new Scene();
  stage.background = new Color(0x20232a);
  stage.add(new HemisphereLight(0xffffff, 0x444444, 2));
  const sun = new DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  stage.add(sun, renderer.scene);

  const gl = new WebGLRenderer({ canvas, antialias: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;

  const resize = (): void => {
    const { clientWidth, clientHeight } = canvas;
    gl.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / Math.max(clientHeight, 1);
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  frame(camera, controls, renderer.scene);
  gl.setAnimationLoop(() => {
    controls.update();
    gl.render(stage, camera);
  });
  setStatus(`${document.name}: scene "${sceneId}" loaded in ${Math.round(performance.now() - started)} ms. Drag to orbit; pinch or scroll to zoom.`);
}

main().catch((error: unknown) => {
  const code = error instanceof RendererError ? `[${error.code}] ` : '';
  setStatus(`Preview failed: ${code}${error instanceof Error ? error.message : String(error)}`, true);
  console.error(error);
});
