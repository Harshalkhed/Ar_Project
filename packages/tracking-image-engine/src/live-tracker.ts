import { ImageTargetDetector, type DetectorOptions } from './detector.js';
import type { GrayImage } from './image.js';
import type { CameraIntrinsics } from './pose.js';
import { projectionFromIntrinsics } from './pose.js';
import type { CompiledImageTarget } from './target.js';

export type LiveTrackerEvent =
  | { readonly type: 'found'; readonly index: number; readonly pose: Float64Array; readonly projection: Float64Array }
  | { readonly type: 'pose'; readonly index: number; readonly pose: Float64Array; readonly projection: Float64Array }
  | { readonly type: 'lost'; readonly index: number };

export interface LiveTrackerOptions extends Partial<DetectorOptions> {
  /** Consecutive frames with no detection before a tracked target is reported lost. Detection is re-run every frame (no inter-frame optical-flow tracking yet), so this absorbs single dropped frames. */
  lostAfterMisses: number;
  near: number;
  far: number;
}

const DEFAULT_LIVE_OPTIONS: Pick<LiveTrackerOptions, 'lostAfterMisses' | 'near' | 'far'> = { lostAfterMisses: 3, near: 0.05, far: 50 };

/**
 * Turns a stream of independent per-frame detections into a found/pose/lost event sequence.
 * Detection runs fresh every frame; this class only adds hysteresis so a single missed frame
 * does not flicker the target away. It has no camera or timing dependency, so it is unit-testable
 * with synthetic frames; {@link BrowserImageTrackingEngine} drives it from real camera frames.
 */
export class LiveImageTracker {
  private readonly detector: ImageTargetDetector;
  private readonly lostAfterMisses: number;
  private readonly near: number;
  private readonly far: number;
  private currentIndex: number | null = null;
  private misses = 0;

  constructor(targets: readonly CompiledImageTarget[], options: Partial<LiveTrackerOptions> = {}) {
    this.detector = new ImageTargetDetector(targets, options);
    this.lostAfterMisses = options.lostAfterMisses ?? DEFAULT_LIVE_OPTIONS.lostAfterMisses;
    this.near = options.near ?? DEFAULT_LIVE_OPTIONS.near;
    this.far = options.far ?? DEFAULT_LIVE_OPTIONS.far;
  }

  processFrame(frame: GrayImage, intrinsics: CameraIntrinsics & { readonly width: number; readonly height: number }): LiveTrackerEvent[] {
    const detection = this.detector.detect(frame, intrinsics);
    const events: LiveTrackerEvent[] = [];

    if (detection) {
      this.misses = 0;
      const projection = projectionFromIntrinsics(intrinsics, this.near, this.far);
      if (this.currentIndex !== null && this.currentIndex !== detection.targetIndex) events.push({ type: 'lost', index: this.currentIndex });
      const isNewFind = this.currentIndex === null || this.currentIndex !== detection.targetIndex;
      events.push({ type: isNewFind ? 'found' : 'pose', index: detection.targetIndex, pose: detection.pose, projection });
      this.currentIndex = detection.targetIndex;
      return events;
    }

    if (this.currentIndex === null) return events;
    this.misses += 1;
    if (this.misses >= this.lostAfterMisses) {
      events.push({ type: 'lost', index: this.currentIndex });
      this.currentIndex = null;
      this.misses = 0;
    }
    return events;
  }

  reset(): void {
    this.currentIndex = null;
    this.misses = 0;
  }
}
