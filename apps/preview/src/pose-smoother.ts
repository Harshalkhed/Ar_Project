import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Exponential smoothing (position lerp, rotation slerp) over a stream of tracker poses. The image-
 * tracking engine detects every frame independently with no inter-frame filtering (see
 * Architecture.md), so raw poses jitter; this removes the jitter for display without touching the
 * tracking contract. The first `update` after construction or `reset` is passed through unsmoothed
 * (there is nothing to blend with yet), so a freshly found target does not visibly ease in from zero.
 */
export class PoseSmoother {
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly matrix = new Matrix4();
  private initialized = false;

  /** @param alpha Weight given to each new sample, in (0, 1]. Lower is smoother but laggier. */
  constructor(private readonly alpha: number) {
    if (!(alpha > 0 && alpha <= 1)) throw new RangeError('alpha must be in (0, 1].');
  }

  update(pose: readonly number[]): number[] {
    this.matrix.fromArray(pose);
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    this.matrix.decompose(position, quaternion, scale);
    if (!this.initialized) {
      this.position.copy(position);
      this.quaternion.copy(quaternion);
      this.scale.copy(scale);
      this.initialized = true;
    } else {
      this.position.lerp(position, this.alpha);
      this.quaternion.slerp(quaternion, this.alpha);
      this.scale.lerp(scale, this.alpha);
    }
    return this.matrix.compose(this.position, this.quaternion, this.scale).toArray();
  }

  reset(): void {
    this.initialized = false;
  }
}
