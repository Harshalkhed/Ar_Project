import type { Transform } from '@internal-webar/project-schema';

/**
 * Scales `base` by `factor` around its own local origin (the anchor): both `scale` and `position`
 * are multiplied. Position must scale too -- a non-zero authored position often encodes a pivot
 * offset (e.g. recentering a model so it rests on its anchor), and scaling only `scale` leaves that
 * offset fixed while the model shrinks/grows around it, so the model visibly drifts away from the
 * anchor as soon as `factor != 1`. Rotation is untouched; scaling does not affect angles.
 */
export function scaledTransform(base: Transform, factor: number): Transform {
  return {
    ...base,
    position: { x: base.position.x * factor, y: base.position.y * factor, z: base.position.z * factor },
    scale: { x: base.scale.x * factor, y: base.scale.y * factor, z: base.scale.z * factor },
  };
}
