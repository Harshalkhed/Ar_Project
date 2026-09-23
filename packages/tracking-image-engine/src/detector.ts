import { extractFeatures, type FeatureOptions } from './features.js';
import { applyHomography, estimateHomography, invert3, multiply3, type Point } from './homography.js';
import type { GrayImage } from './image.js';
import { matchDescriptors } from './matching.js';
import { cvPoseFromHomography, glPoseFromCv, type CameraIntrinsics, type CvPose } from './pose.js';
import { refinePose, type PointCorrespondence } from './refine.js';
import type { CompiledImageTarget } from './target.js';

export interface Detection {
  readonly targetIndex: number;
  /** Target plane (origin at centre, +Y up, 1 unit = target width) → frame pixels. */
  readonly planeToImage: number[];
  /** Column-major OpenGL model-view pose; see poseFromHomography. */
  readonly pose: Float64Array;
  /** Target image corners (top-left, top-right, bottom-right, bottom-left) in frame pixels. */
  readonly corners: [number, number][];
  readonly inlierCount: number;
}

export interface DetectorOptions {
  frameFeatures: FeatureOptions;
  ratio: number;
  maxDistance: number;
  ransacThreshold: number;
  ransacIterations: number;
  minInliers: number;
  /** Inliers must also be at least this fraction of the ratio-tested matches. */
  minInlierRatio: number;
  /** Gauss-Newton iterations refining the closed-form homography pose against the raw inlier matches. */
  refineIterations: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  frameFeatures: { maxFeatures: 500, levels: 3, scaleFactor: 0.75, threshold: 18 },
  ratio: 0.8,
  maxDistance: 70,
  ransacThreshold: 3,
  ransacIterations: 500,
  minInliers: 20,
  minInlierRatio: 0.25,
  refineIterations: 15,
};

/** Maps target-plane coordinates to target pixel coordinates (pixel v grows downward). */
function planeToTargetPixels(target: CompiledImageTarget): number[] {
  return [target.width, 0, target.width / 2, 0, -target.width, target.height / 2, 0, 0, 1];
}

function projectPoint({ r, t }: CvPose, { fx, fy, cx, cy }: CameraIntrinsics, [x, y]: readonly [number, number]): [number, number] {
  const zc = r[6] * x + r[7] * y + t[2];
  return [(fx * (r[0] * x + r[1] * y + t[0])) / zc + cx, (fy * (r[3] * x + r[4] * y + t[1])) / zc + cy];
}

/** Full-frame detection: finds which compiled target is visible and estimates its pose. */
export class ImageTargetDetector {
  private readonly options: DetectorOptions;

  constructor(private readonly targets: readonly CompiledImageTarget[], options: Partial<DetectorOptions> = {}) {
    this.options = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
  }

  detect(frame: GrayImage, intrinsics: CameraIntrinsics): Detection | null {
    const features = extractFeatures(frame, this.options.frameFeatures);
    if (features.length < this.options.minInliers) return null;
    const frameDescriptors = features.map((feature) => feature.descriptor);
    let best: Detection | null = null;
    this.targets.forEach((target, targetIndex) => {
      const matches = matchDescriptors(frameDescriptors, target.features.map((feature) => feature.descriptor), this.options);
      if (matches.length < this.options.minInliers) return;
      const source: Point[] = matches.map((match) => [target.features[match.train].x, target.features[match.train].y]);
      const destination: Point[] = matches.map((match) => [features[match.query].x, features[match.query].y]);
      const estimate = estimateHomography(source, destination, { threshold: this.options.ransacThreshold, iterations: this.options.ransacIterations, seed: 0x5eed + targetIndex });
      if (!estimate) return;
      const inlierCount = estimate.inliers.length;
      if (inlierCount < this.options.minInliers || inlierCount < this.options.minInlierRatio * matches.length) return;
      if (best && best.inlierCount >= inlierCount) return;
      const targetPixelsToPlane = invert3(planeToTargetPixels(target));
      if (!targetPixelsToPlane) return;
      const planeToImage = multiply3(estimate.homography, planeToTargetPixels(target));
      // Refine directly against the raw matched pixel positions, not the ones the homography implies.
      const correspondences: PointCorrespondence[] = estimate.inliers.map((index) => ({
        plane: applyHomography(targetPixelsToPlane, source[index][0], source[index][1]),
        image: destination[index],
      }));
      const closedForm = cvPoseFromHomography(planeToImage, intrinsics);
      const refined = refinePose(closedForm, correspondences, intrinsics, { iterations: this.options.refineIterations });
      const corners = [[0, 0], [target.width, 0], [target.width, target.height], [0, target.height]].map(([u, v]) =>
        projectPoint(refined, intrinsics, applyHomography(targetPixelsToPlane, u, v)),
      );
      best = { targetIndex, planeToImage, pose: glPoseFromCv(refined), corners, inlierCount };
    });
    return best;
  }
}
