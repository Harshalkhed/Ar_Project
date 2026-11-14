import type { LiveTrackerEvent } from '@internal-webar/tracking-image-engine';
import type { CameraProjection, TargetPose } from '@internal-webar/tracking';
import type { DetectionReply, DetectionRequest, FrameIntrinsics } from './detection-protocol.js';
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

function assumedIntrinsics(width: number, height: number): FrameIntrinsics {
  const fx = width / 2 / Math.tan((ASSUMED_HORIZONTAL_FOV_DEGREES * Math.PI) / 360);
  return { fx, fy: fx, cx: width / 2, cy: height / 2, width, height };
}

function processingSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PROCESSING_DIMENSION / Math.max(sourceWidth, sourceHeight));
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/**
 * {@link ImageTrackingEngine} backed by our own computer-vision pipeline
 * (`@internal-webar/tracking-image-engine`). The main thread only captures camera frames
 * (getUserMedia + a 480 px canvas readback); target compilation and detection run in a module
 * Web Worker (`detection-worker.ts`), one frame in flight at a time. No third-party or vendor AR SDK is used.
 */
export class BrowserImageTrackingEngine implements ImageTrackingEngine {
  private worker: Worker | undefined;
  private pendingLoad: { resolve(): void; reject(error: Error): void } | undefined;
  private callbacks: ImageTrackingEngineCallbacks | undefined;
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private context: OffscreenCanvasRenderingContext2D | undefined;
  private intrinsics: FrameIntrinsics | undefined;
  private frameHandle: number | undefined;
  private session = 0;
  private workerBusy = false;
  private stopped = true;

  async loadTargets(imageUris: readonly string[]): Promise<void> {
    this.worker ??= this.createWorker();
    await new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
      this.post({ type: 'load', uris: imageUris });
    });
  }

  async start(callbacks: ImageTrackingEngineCallbacks): Promise<void> {
    if (!this.worker) throw new Error('Image targets must be loaded before tracking starts.');
    this.stopped = false;
    this.session += 1;
    this.workerBusy = false;
    this.callbacks = callbacks;
    this.post({ type: 'reset' });
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
    const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas context is unavailable.');
    this.context = context;
    this.intrinsics = assumedIntrinsics(width, height);

    const step = (): void => {
      if (this.stopped || !this.video || !this.context || !this.intrinsics) return;
      if (!this.workerBusy) {
        try {
          const { width: w, height: h } = this.intrinsics;
          this.context.drawImage(this.video, 0, 0, w, h);
          const rgba = this.context.getImageData(0, 0, w, h).data;
          this.workerBusy = true;
          this.post({ type: 'frame', session: this.session, rgba, intrinsics: this.intrinsics }, [rgba.buffer]);
        } catch (error) {
          callbacks.failed(error);
          return;
        }
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
    this.context = undefined;
    this.callbacks = undefined;
    this.post({ type: 'reset' });
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('./detection-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<DetectionReply>) => this.receive(event.data);
    worker.onerror = (event) => this.fail(new Error(`Detection worker failed: ${event.message || 'script error'}`));
    return worker;
  }

  private post(request: DetectionRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(request, transfer);
  }

  private receive(reply: DetectionReply): void {
    switch (reply.type) {
      case 'loaded':
        this.pendingLoad?.resolve();
        this.pendingLoad = undefined;
        return;
      case 'error':
        return this.fail(new Error(reply.message));
      case 'events':
        if (reply.session !== this.session || this.stopped || !this.callbacks) return; // From before a stop/start.
        this.workerBusy = false;
        for (const event of reply.events) this.dispatch(event, this.callbacks);
    }
  }

  private fail(error: Error): void {
    if (this.pendingLoad) {
      this.pendingLoad.reject(error);
      this.pendingLoad = undefined;
      return;
    }
    this.stopped = true; // Same as before the worker: a detection failure ends the frame loop.
    this.callbacks?.failed(error);
  }

  private dispatch(event: LiveTrackerEvent, callbacks: ImageTrackingEngineCallbacks): void {
    if (event.type === 'lost') return callbacks.targetLost(event.index);
    const pose = Array.from(event.pose) as unknown as TargetPose;
    const projection = Array.from(event.projection) as unknown as CameraProjection;
    if (event.type === 'found') callbacks.targetFound(event.index, pose, projection);
    else callbacks.poseUpdated(event.index, pose, projection);
  }
}
