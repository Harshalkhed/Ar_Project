import type { RendererAdapter } from '@internal-webar/renderer';
import type { Transform } from '@internal-webar/project-schema';
import { Box3, Euler, Quaternion, Vector3, type Object3D } from 'three';
import { scaledTransform } from './transform-utils.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
/** Keeps pitch just short of ±90° so the view cannot flip upside-down/gimbal-lock. */
const MAX_PITCH = (89 * Math.PI) / 180;

export interface ObjectControl {
  setScale(value: number): void;
  getScale(): number;
  /** Spins the object about the anchor's vertical (world) axis, on top of its authored orientation — a Sketchfab-style turntable, so people can inspect a fixed, placed object from every side without physically walking around it. */
  addYaw(deltaRadians: number): void;
  /** Tips the object about a fixed horizontal (world) axis, so it can also be viewed from above/below, not just spun left-right. */
  addPitch(deltaRadians: number): void;
  resetOrientation(): void;
}

/** Scale factor that makes `root`'s longest side about `targetSize` metres — most AR viewers auto-fit like this on placement instead of leaving people to pinch every project to a usable size by hand. */
export function autoFitScale(root: Object3D, targetSize = 1): number {
  const size = new Box3().setFromObject(root).getSize(new Vector3());
  return targetSize / Math.max(size.x, size.y, size.z, 1e-6);
}

/**
 * Scales and orbits a set of already-loaded objects from their authored transform, so repeated
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
  let pitch = 0;
  const apply = (): void => {
    // Yaw about the fixed world-up axis, then pitch about a fixed horizontal axis — both in the
    // anchor's own frame, not the object's rotated one, so each axis always responds the same way
    // to a drag regardless of the model's current orientation (a simple, predictable orbit).
    const spin = new Quaternion().setFromAxisAngle(UP, yaw).multiply(new Quaternion().setFromAxisAngle(RIGHT, pitch));
    for (const [objectId, base] of baseTransforms) {
      const scaled = scaledTransform(base, scaleFactor);
      // A non-zero authored position is a pivot offset that recenters the model onto the anchor for
      // one specific orientation (see scaledTransform's own comment for the same issue with scale).
      // Orbiting the object changes that orientation, so the offset must rotate too -- otherwise the
      // model's centroid swings out along an arc around the anchor as you drag, instead of the model
      // turning in place. Confirmed on a real device: it "revolved" instead of turning on the spot.
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
    addPitch(deltaRadians) {
      pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch + deltaRadians));
      apply();
    },
    resetOrientation() {
      yaw = 0;
      pitch = 0;
      apply();
    },
  };
}

const MOMENTUM_DAMPING_PER_FRAME = 0.94;
const MOMENTUM_STOP_RADIANS = 0.0005;

/**
 * One-finger drag orbits the object (Sketchfab-style: horizontal = spin, vertical = tilt), and
 * keeps coasting with decaying momentum after release, like flicking a Sketchfab embed, instead of
 * stopping dead the instant a finger lifts. Two-finger pinch (touch) and mouse-wheel (desktop)
 * resize it.
 */
export function setUpTransformGestures(canvas: HTMLCanvasElement, control: ObjectControl): void {
  const ROTATE_RADIANS_PER_PIXEL = 0.01;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;
  let velocityYaw = 0;
  let velocityPitch = 0;
  let momentumFrame: number | null = null;

  const stopMomentum = (): void => {
    if (momentumFrame !== null) cancelAnimationFrame(momentumFrame);
    momentumFrame = null;
  };
  const coast = (): void => {
    velocityYaw *= MOMENTUM_DAMPING_PER_FRAME;
    velocityPitch *= MOMENTUM_DAMPING_PER_FRAME;
    if (Math.abs(velocityYaw) < MOMENTUM_STOP_RADIANS && Math.abs(velocityPitch) < MOMENTUM_STOP_RADIANS) {
      momentumFrame = null;
      return;
    }
    control.addYaw(velocityYaw);
    control.addPitch(velocityPitch);
    momentumFrame = requestAnimationFrame(coast);
  };

  const distanceBetween = (): number | null => {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const forgetPointer = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    pinchStartDistance = null;
    if (pointers.size === 0 && (Math.abs(velocityYaw) > MOMENTUM_STOP_RADIANS || Math.abs(velocityPitch) > MOMENTUM_STOP_RADIANS)) {
      stopMomentum();
      momentumFrame = requestAnimationFrame(coast);
    }
  };

  canvas.addEventListener('pointerdown', (event) => {
    stopMomentum();
    velocityYaw = 0;
    velocityPitch = 0;
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
      velocityYaw = 0;
      velocityPitch = 0;
      const distance = distanceBetween();
      if (distance && pinchStartDistance) control.setScale(pinchStartScale * (distance / pinchStartDistance));
    } else {
      velocityYaw = (event.clientX - previous.x) * ROTATE_RADIANS_PER_PIXEL;
      velocityPitch = (event.clientY - previous.y) * ROTATE_RADIANS_PER_PIXEL;
      control.addYaw(velocityYaw);
      control.addPitch(velocityPitch);
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
