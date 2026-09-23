import type { Transform } from '@internal-webar/project-schema';

/** Multiplies `base`'s scale by `factor`, keeping position and rotation untouched. */
export function scaledTransform(base: Transform, factor: number): Transform {
  return { ...base, scale: { x: base.scale.x * factor, y: base.scale.y * factor, z: base.scale.z * factor } };
}
