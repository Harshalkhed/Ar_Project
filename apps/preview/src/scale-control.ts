import type { RendererAdapter } from '@internal-webar/renderer';
import type { Transform } from '@internal-webar/project-schema';
import { Box3, Euler, Quaternion, Vector3, type Object3D } from 'three';
import { scaledTransform } from './transform-utils.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const UP = new Vector3(0, 1, 0);

/** Scale factor that makes `root`'s longest side about `targetSize` metres — most AR viewers auto-fit like this on placement instead of leaving people to pinch every project to a usable size by hand. */
export function autoFitScale(root: Object3D, targetSize = 1): number {
  const size = new Box3().setFromObject(root).getSize(new Vector3());
  return targetSize / Math.max(size.x, size.y, size.z, 1e-6);
}

export interface ObjectControl {
  setScale(value: number): void;
  getScale(): number;
  /** Spins the object about the anchor's vertical (world) axis, on top of its authored orientation — a Sketchfab-style turntable, so people can inspect a fixed, placed object from every side without physically walking around it. */
  addYaw(deltaRadians: number): void;
  resetYaw(): void;
}

/**
 * Scales and spins a set of already-loaded objects from their authored transform, so repeated
 * gestures always compose onto the original values rather than the last result.
 */
export function createObjectControl(renderer: RendererAdapter, objectIds: readonly string[], onScaleChange?: (scale: number) => void): ObjectControl {
  const baseTransforms = new Map<string, Transform>();
  for (const objectId of objectIds) {
    const transform = renderer.getObjectState(objectId)?.transform;
    if (transform) baseTransforms.set(objectId, transform);
  }
  let scaleFactor = 1;
  let yaw = 0;
  const apply = (): void => {
    const spin = new Quaternion().setFromAxisAngle(UP, yaw);
    for (const [objectId, base] of baseTransforms) {
      const scaled = scaledTransform(base, scaleFactor);
      // A non-zero authored position is a pivot offset that recenters the model onto the anchor for
      // one specific orientation (see scaledTransform's own comment for the same issue with scale).
      // Spinning the object changes that orientation, so the offset must spin too -- otherwise the
      // model's centroid swings out along an arc around the anchor as you drag, instead of the model
      // spinning in place. Confirmed on a real device: it "revolved" instead of turning on the spot.
      const position = new Vector3(scaled.position.x, scaled.position.y, scaled.position.z).applyQuaternion(spin);
      // Quaternion composition handles any authored rotation correctly (e.g. a model tipped 90°
      // to face the camera) without having to reason about Euler-angle order by hand.
      const authored = new Quaternion().setFromEuler(new Euler(base.rotation.x, base.rotation.y, base.rotation.z));
      const rotation = new Euler().setFromQuaternion(spin.clone().multiply(authored));
      renderer.applyTransform(objectId, {
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
        scale: scaled.scale,
      });
    }
    onScaleChange?.(scaleFactor);
  };
  return {
    setScale(value) {
      scaleFactor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
      apply();
    },
    getScale: () => scaleFactor,
    addYaw(deltaRadians) {
      yaw += deltaRadians;
      apply();
    },
    resetYaw() {
      yaw = 0;
      apply();
    },
  };
}

/** One-finger drag spins the object (Sketchfab-style); two-finger pinch (touch) and mouse-wheel (desktop) resize it. */
export function setUpTransformGestures(canvas: HTMLCanvasElement, control: ObjectControl): void {
  const ROTATE_RADIANS_PER_PIXEL = 0.01;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;

  const distanceBetween = (): number | null => {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const forgetPointer = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    pinchStartDistance = null;
  };

  canvas.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      pinchStartDistance = distanceBetween();
      pinchStartScale = control.getScale();
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const distance = distanceBetween();
      if (distance && pinchStartDistance) control.setScale(pinchStartScale * (distance / pinchStartDistance));
    } else {
      control.addYaw((event.clientX - previous.x) * ROTATE_RADIANS_PER_PIXEL);
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) canvas.addEventListener(type, forgetPointer);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      control.setScale(control.getScale() * (event.deltaY < 0 ? 1.05 : 1 / 1.05));
    },
    { passive: false },
  );
}
