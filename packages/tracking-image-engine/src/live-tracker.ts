import { ImageTargetDetector, type Detection, type DetectorOptions } from './detector.js';
import { buildPyramid, trackPoints, type FlowOptions } from './flow.js';
import { estimateHomography, type Point } from './homography.js';
import type { GrayImage } from './image.js';
import type { CameraIntrinsics, CvPose } from './pose.js';
import { cvPoseFromHomography, glPoseFromCv, projectionFromIntrinsics } from './pose.js';
import { refinePose, type PointCorrespondence } from './refine.js';
import type { CompiledImageTarget } from './target.js';

export type LiveTrackerEvent =
  | { readonly type: 'found'; readonly index: number; readonly pose: Float64Array; readonly projection: Float64Array; readonly source: 'detection' }
  | { readonly type: 'pose'; readonly index: number; readonly pose: Float64Array; readonly projection: Float64Array; readonly source: 'detection' | 'flow' }
  | { readonly type: 'lost'; readonly index: number };

export interface LiveTrackerOptions extends Partial<DetectorOptions> {
  /** Consecutive frames where both optical flow and detection fail before a tracked target is reported lost. */
  lostAfterMisses: number;
  near: number;
  far: number;
  /** Optical flow between detections. `false` runs full detection on every frame (the pre-2026-11-14 behaviour). */
  flow: false | Partial<FlowOptions>;
  /** Fewest tracked points that still give a trusted pose; below it, full detection runs again. */
  minTrackedPoints: number;
  /** Run full detection after this many flow-only frames even while flow is healthy, to correct drift. */
  redetectEvery: number;
  pyramidLevels: number;
}

const DEFAULT_LIVE_OPTIONS: Omit<LiveTrackerOptions, keyof DetectorOptions> = {
  lostAfterMisses: 3,
  near: 0.05,
  far: 50,
  flow: {},
  minTrackedPoints: 12,
  redetectEvery: 15,
  pyramidLevels: 3,
};

/** What optical flow carries from one frame to the next. */
interface FlowState {
  readonly index: number;
  readonly pyramid: GrayImage[];
  readonly correspondences: readonly PointCorrespondence[];
  readonly cvPose: CvPose;
  readonly framesSinceDetection: number;
}

interface TrackedPose {
  readonly index: number;
  readonly cvPose: CvPose;
  readonly correspondences: readonly PointCorrespondence[];
  readonly source: 'detection' | 'flow';
}

/**
 * Turns camera frames into a found/pose/lost event sequence. After a full detection, the matched
 * corners are followed frame to frame with pyramidal Lucas-Kanade optical flow (far cheaper than
 * detection), and the pose is re-fitted from them. Full detection runs again when flow loses too many
 * points or every `redetectEvery` frames. A miss is counted only when both fail, and the target is
 * reported lost after `lostAfterMisses` of them. No camera or timing dependency, so it is
 * unit-testable with synthetic frames; {@link BrowserImageTrackingEngine} drives it from a real camera.
 */
export class LiveImageTracker {
  private readonly detector: ImageTargetDetector;
  private readonly options: LiveTrackerOptions;
  private currentIndex: number | null = null;
  private misses = 0;
  private flowState: FlowState | null = null;

  constructor(targets: readonly CompiledImageTarget[], options: Partial<LiveTrackerOptions> = {}) {
    this.detector = new ImageTargetDetector(targets, options);
    this.options = { ...DEFAULT_LIVE_OPTIONS, ...options };
  }

  processFrame(frame: GrayImage, intrinsics: CameraIntrinsics & { readonly width: number; readonly height: number }): LiveTrackerEvent[] {
    const pyramid = this.options.flow === false ? null : buildPyramid(frame, this.options.pyramidLevels);
    const flowed = pyramid && this.flowState ? this.track(this.flowState, pyramid, intrinsics) : null;
    const detectionDue = !flowed || (this.flowState?.framesSinceDetection ?? 0) + 1 >= this.options.redetectEvery;
    const detected = detectionDue ? this.detected(this.detector.detect(frame, intrinsics)) : null;
    const result = detected ?? flowed;

    if (!result) {
      this.flowState = null;
      return this.miss();
    }
    this.flowState = pyramid
      ? { index: result.index, pyramid, correspondences: result.correspondences, cvPose: result.cvPose, framesSinceDetection: result.source === 'detection' ? 0 : (this.flowState?.framesSinceDetection ?? 0) + 1 }
      : null;
    return this.hit(result, projectionFromIntrinsics(intrinsics, this.options.near, this.options.far));
  }

  reset(): void {
    this.currentIndex = null;
    this.misses = 0;
    this.flowState = null;
  }

  private detected(detection: Detection | null): TrackedPose | null {
    return detection && { index: detection.targetIndex, cvPose: detection.cvPose, correspondences: detection.correspondences, source: 'detection' };
  }

  /** Follows the previous frame's points into this frame and re-fits the pose from the survivors. */
  private track(state: FlowState, pyramid: GrayImage[], intrinsics: CameraIntrinsics): TrackedPose | null {
    if (this.options.flow === false) return null;
    const moved = trackPoints(state.pyramid, pyramid, state.correspondences.map((c) => c.image), this.options.flow);
    const plane: Point[] = [];
    const image: Point[] = [];
    moved.forEach((point, i) => {
      if (!point) return;
      plane.push(state.correspondences[i].plane);
      image.push(point);
    });
    if (plane.length < this.options.minTrackedPoints) return null;
    const estimate = estimateHomography(plane, image, { threshold: 3, iterations: 100, seed: 0xf10 });
    if (!estimate || estimate.inliers.length < this.options.minTrackedPoints) return null;
    const correspondences = estimate.inliers.map((i) => ({ plane: plane[i], image: image[i] }));
    // Start from last frame's pose (one frame of motion away) unless the fresh closed-form fit is the better start.
    const closedForm = cvPoseFromHomography(estimate.homography, intrinsics);
    const cvPose = refinePose(reprojectionError(closedForm, correspondences, intrinsics) < reprojectionError(state.cvPose, correspondences, intrinsics) ? closedForm : state.cvPose, correspondences, intrinsics, { iterations: 5 });
    return { index: state.index, cvPose, correspondences, source: 'flow' };
  }

  private hit(result: TrackedPose, projection: Float64Array): LiveTrackerEvent[] {
    this.misses = 0;
    const events: LiveTrackerEvent[] = [];
    if (this.currentIndex !== null && this.currentIndex !== result.index) events.push({ type: 'lost', index: this.currentIndex });
    const pose = glPoseFromCv(result.cvPose);
    events.push(this.currentIndex === result.index
      ? { type: 'pose', index: result.index, pose, projection, source: result.source }
      : { type: 'found', index: result.index, pose, projection, source: 'detection' });
    this.currentIndex = result.index;
    return events;
  }

  private miss(): LiveTrackerEvent[] {
    if (this.currentIndex === null) return [];
    this.misses += 1;
    if (this.misses < this.options.lostAfterMisses) return [];
    const lost: LiveTrackerEvent = { type: 'lost', index: this.currentIndex };
    this.currentIndex = null;
    this.misses = 0;
    return [lost];
  }
}

function reprojectionError({ r, t }: CvPose, correspondences: readonly PointCorrespondence[], { fx, fy, cx, cy }: CameraIntrinsics): number {
  let sum = 0;
  for (const { plane: [x, y], image: [u, v] } of correspondences) {
    const z = r[6] * x + r[7] * y + t[2];
    sum += ((fx * (r[0] * x + r[1] * y + t[0])) / z + cx - u) ** 2 + ((fy * (r[3] * x + r[4] * y + t[1])) / z + cy - v) ** 2;
  }
  return sum;
}
