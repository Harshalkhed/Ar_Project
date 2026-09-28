// Real camera image-tracking test page. Requires HTTPS (or localhost) and a rear camera.
// Camera passthrough (this file's own <video>) is a rendering/display concern, kept separate from
// the tracking engine's own internal camera capture (BrowserImageTrackingEngine) — see Architecture.md.
import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { RendererError, ThreeRenderer, type AssetReader } from '@internal-webar/renderer';
import { RuntimeCore, RuntimeError, type CameraProjection, type RuntimeEvent, type TargetPose } from '@internal-webar/runtime-core';
import { TrackingError } from '@internal-webar/tracking';
import { BrowserImageTrackingEngine, ImageTrackingProvider } from '@internal-webar/tracking-image';
import { HemisphereLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { PoseSmoother } from './pose-smoother.js';
import { withAbsoluteAssetUris } from './resolve-assets.js';
import { autoFitScale, createObjectControl, setUpTransformGestures } from './scale-control.js';

const DEFAULT_PROJECT = 'projects/office-chair/project.json';
/** Weight given to each new tracked pose; lower is smoother but laggier. Tuned by eye, not measured. */
const SMOOTHING_ALPHA = 0.25;

const statusElement = document.querySelector<HTMLParagraphElement>('#status');
const canvas = document.querySelector<HTMLCanvasElement>('#viewport');
const cameraVideo = document.querySelector<HTMLVideoElement>('#camera');
const startOverlay = document.querySelector<HTMLDivElement>('#start');
const startButton = document.querySelector<HTMLButtonElement>('#start-button');
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button');
const scaleBadge = document.querySelector<HTMLDivElement>('#scale-badge');

function setStatus(message: string, state: 'info' | 'error' | 'tracking' = 'info'): void {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.dataset.state = state;
}

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

function describeRuntimeError(event: Extract<RuntimeEvent, { type: 'runtime_error' }>): string {
  const hints: Partial<Record<string, string>> = {
    unsupported: 'This device or browser cannot run image tracking (needs HTTPS and a camera API).',
    permission_denied: 'Camera permission was denied. Allow camera access and reload.',
    camera_unavailable: 'No usable camera was found.',
    invalid_project: 'The project file is invalid.',
    unsupported_tracking_type: 'This project is not an image-tracking project.',
    no_targets: 'This project has no image targets to track.',
  };
  return `[${event.code}] ${hints[event.code] ?? ''} ${event.message}`.trim();
}

/** This page's own camera feed, purely for the visible background — independent of the tracking engine's capture. */
async function startCameraPassthrough(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  await video.play();
}

async function main(): Promise<void> {
  if (!canvas || !cameraVideo) throw new Error('Preview elements are missing.');
  if (!isSecureContext) throw new Error('Camera access requires HTTPS (or localhost).');

  const url = projectUrl();
  setStatus(`Loading project ${url.pathname}…`);
  const project: unknown = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const issues = validateProject(project);
  if (issues.length) throw new Error(`Invalid project: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  const rawDocument = project as ProjectDocument;
  if (rawDocument.tracking.type !== 'image') throw new Error(`This page only handles image tracking; project uses "${rawDocument.tracking.type}".`);
  const sceneId = rawDocument.triggers[0]?.sceneIds[0] ?? rawDocument.scenes[0]?.id;
  if (!sceneId) throw new Error('Project has no scene to track into.');
  // Both the renderer and the tracking engine fetch by asset URI; resolve once, up front, for both.
  const document = withAbsoluteAssetUris(rawDocument, url);

  const renderer = new ThreeRenderer();
  const readAsset: AssetReader = (uri) => fetchBytes(new URL(uri, url));
  await renderer.loadScene(document, sceneId, readAsset);
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  const objectIds = scene?.objectIds ?? [];
  for (const objectId of objectIds) renderer.setVisible(objectId, true);
  const autoScale = autoFitScale(renderer.scene);
  renderer.setAnchor(null); // Hidden until the target is found.

  const control = createObjectControl(renderer, objectIds, (scale) => {
    if (scaleBadge) scaleBadge.textContent = `${Math.round(scale * 100)}%`;
  });
  control.setScale(autoScale); // Drag to spin, pinch/scroll to resize, from here.

  const smoother = new PoseSmoother(SMOOTHING_ALPHA);

  const stage = new Scene();
  stage.add(new HemisphereLight(0xffffff, 0x444444, 2), renderer.scene); // PBR materials render black with no light.
  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Camera stays at the origin with no transform: the tracker's pose is already camera-relative
  // ("model-view"), so scene.matrixWorld applied under an identity camera view is exactly right.
  const camera = new PerspectiveCamera();
  camera.matrixAutoUpdate = false; // Stays at identity; WebGLRenderer never overwrites projectionMatrix itself.

  const resize = (): void => gl.setSize(window.innerWidth, window.innerHeight, false);
  window.addEventListener('resize', resize);
  resize();

  await startCameraPassthrough(cameraVideo);

  const applyPose = (pose: TargetPose | undefined): void => {
    if (!pose) return;
    renderer.setAnchor(smoother.update(pose));
  };
  const applyProjection = (projection: CameraProjection | undefined): void => {
    if (!projection) return;
    camera.projectionMatrix.fromArray(projection);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };

  const provider = new ImageTrackingProvider(new BrowserImageTrackingEngine());
  const runtime = new RuntimeCore(provider, (event) => {
    switch (event.type) {
      case 'runtime_initialized':
        setStatus('Point the camera at the target.');
        break;
      case 'target_found':
        applyPose(event.pose);
        applyProjection(event.projection);
        setStatus('Found — drag to spin, pinch or scroll to resize. Reset to track again.', 'tracking');
        break;
      case 'pose_updated':
        applyPose(event.pose);
        applyProjection(event.projection);
        break;
      case 'target_lost':
        // Image-anchored placement, not room placement (see Architecture.md): keep the content at
        // its last known pose instead of hiding it, so looking away from the target does not make
        // it disappear. It stays screen-relative, not fixed in the room, until Reset is pressed.
        setStatus('Target out of view — showing last position. Reset to track again.');
        break;
      case 'runtime_error':
        renderer.setAnchor(null);
        setStatus(describeRuntimeError(event), 'error');
        break;
    }
  });

  resetButton?.addEventListener('click', () => {
    renderer.setAnchor(null);
    smoother.reset();
    control.setScale(autoScale);
    control.resetYaw();
    setStatus('Point the camera at the target.');
  });
  setUpTransformGestures(canvas, control);

  gl.setAnimationLoop(() => gl.render(stage, camera));
  await runtime.start(document);
}

startButton?.addEventListener('click', () => {
  startOverlay?.remove();
  main().catch((error: unknown) => {
    const code = error instanceof RendererError || error instanceof RuntimeError || error instanceof TrackingError ? `[${error.code}] ` : '';
    setStatus(`Failed to start: ${code}${error instanceof Error ? error.message : String(error)}`, 'error');
    console.error(error);
  });
});
