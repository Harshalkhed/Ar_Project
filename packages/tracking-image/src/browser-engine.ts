import {
  compileImageTarget,
  grayscaleFromRgba,
  LiveImageTracker,
  type CameraIntrinsics,
  type CompiledImageTarget,
} from '@internal-webar/tracking-image-engine';
import type { CameraProjection, TargetPose } from '@internal-webar/tracking';
import type { ImageTrackingEngine, ImageTrackingEngineCallbacks } from './index.js';

/**
 * Processing resolution cap (longest side, pixels). Detection cost grows with pixel count; this
 * keeps per-frame work bounded on phones regardless of the camera's native capture resolution.
 */
const MAX_PROCESSING_DIMENSION = 480;

/**
 * Approximate horizontal field of view used to derive camera intrinsics when the device does not
 * report its own (no calibration is available from getUserMedia). This is a rough default for a
 * typical rear phone camera, not a measured value — see the open question in Architecture.md.
 */
const ASSUMED_HORIZONTAL_FOV_DEGREES = 62;

interface ProcessingFrame extends CameraIntrinsics {
  readonly width: number;
  readonly height: number;
}

function assumedIntrinsics(width: number, height: number): ProcessingFrame {
  const fx = width / 2 / Math.tan((ASSUMED_HORIZONTAL_FOV_DEGREES * Math.PI) / 360);
  return { fx, fy: fx, cx: width / 2, cy: height / 2, width, height };
}

function processingSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PROCESSING_DIMENSION / Math.max(sourceWidth, sourceHeight));
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/** Decodes an image URL into a compiled target. Runs once per target in `loadTargets`, not per frame. */
async function fetchAndCompileTarget(uri: string): Promise<CompiledImageTarget> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`${uri} returned HTTP ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context is unavailable.');
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return compileImageTarget(grayscaleFromRgba(data, bitmap.width, bitmap.height));
  } finally {
    bitmap.close();
  }
}

/**
 * {@link ImageTrackingEngine} backed by our own computer-vision pipeline
 * (`@internal-webar/tracking-image-engine`): getUserMedia for camera capture, that package for
 * detection and pose, and {@link LiveImageTracker} for the found/lost lifecycle. No third-party
 * or vendor AR SDK is used.
 */
export class BrowserImageTrackingEngine implements ImageTrackingEngine {
  private targets: CompiledImageTarget[] = [];
  private tracker: LiveImageTracker | undefined;
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private canvas: OffscreenCanvas | undefined;
  private context: OffscreenCanvasRenderingContext2D | undefined;
  private intrinsics: ProcessingFrame | undefined;
  private frameHandle: number | undefined;
  private stopped = true;

  async loadTargets(imageUris: readonly string[]): Promise<void> {
    this.targets = await Promise.all(imageUris.map(fetchAndCompileTarget));
  }

  async start(callbacks: ImageTrackingEngineCallbacks): Promise<void> {
    this.stopped = false;
    this.tracker = new LiveImageTracker(this.targets);
    // Constraints, not a guarantee: some browsers ignore facingMode and expose whatever camera they pick.
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (this.stopped) {
      // start() lost a race with stop() while awaiting the camera prompt.
      for (const track of this.stream.getTracks()) track.stop();
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;

    const { width, height } = processingSize(video.videoWidth, video.videoHeight);
    this.canvas = new OffscreenCanvas(width, height);
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas context is unavailable.');
    this.context = context;
    this.intrinsics = assumedIntrinsics(width, height);

    const step = (): void => {
      if (this.stopped || !this.video || !this.context || !this.tracker || !this.intrinsics) return;
      try {
        this.context.drawImage(this.video, 0, 0, this.intrinsics.width, this.intrinsics.height);
        const { data } = this.context.getImageData(0, 0, this.intrinsics.width, this.intrinsics.height);
        const frame = grayscaleFromRgba(data, this.intrinsics.width, this.intrinsics.height);
        for (const event of this.tracker.processFrame(frame, this.intrinsics)) this.dispatch(event, callbacks);
      } catch (error) {
        callbacks.failed(error);
        return;
      }
      this.frameHandle = requestAnimationFrame(step);
    };
    this.frameHandle = requestAnimationFrame(step);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.frameHandle !== undefined) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = undefined;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
    this.canvas = undefined;
    this.context = undefined;
    this.tracker?.reset();
    this.tracker = undefined;
  }

  private dispatch(event: { type: 'found' | 'pose' | 'lost'; index: number; pose?: Float64Array; projection?: Float64Array }, callbacks: ImageTrackingEngineCallbacks): void {
    if (event.type === 'lost') return callbacks.targetLost(event.index);
    const pose = Array.from(event.pose!) as unknown as TargetPose;
    const projection = Array.from(event.projection!) as unknown as CameraProjection;
    if (event.type === 'found') callbacks.targetFound(event.index, pose, projection);
    else callbacks.poseUpdated(event.index, pose, projection);
  }
}
