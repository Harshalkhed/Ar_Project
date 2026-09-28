import type { RendererAdapter } from '@internal-webar/renderer';
import type { Transform } from '@internal-webar/project-schema';
import { Box3, Vector3, type Object3D } from 'three';
import { scaledTransform } from './transform-utils.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

/** Scale factor that makes `root`'s longest side about `targetSize` metres — most AR viewers auto-fit like this on placement instead of leaving people to pinch every project to a usable size by hand. */
export function autoFitScale(root: Object3D, targetSize = 1): number {
  const size = new Box3().setFromObject(root).getSize(new Vector3());
  return targetSize / Math.max(size.x, size.y, size.z, 1e-6);
}

/**
 * Scales a set of already-loaded objects from their authored (unscaled) transform, so repeated
 * pinch/scroll always multiplies the original size rather than compounding onto the last result.
 */
export function createScaleControl(renderer: RendererAdapter, objectIds: readonly string[], onChange?: (scale: number) => void) {
  const baseTransforms = new Map<string, Transform>();
  for (const objectId of objectIds) {
    const transform = renderer.getObjectState(objectId)?.transform;
    if (transform) baseTransforms.set(objectId, transform);
  }
  let scaleFactor = 1;
  const setScale = (value: number): void => {
    scaleFactor = Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    for (const [objectId, base] of baseTransforms) renderer.applyTransform(objectId, scaledTransform(base, scaleFactor));
    onChange?.(scaleFactor);
  };
  return { setScale, getScale: (): number => scaleFactor };
}

/** Two-finger pinch (touch) and mouse-wheel (desktop) resize the placed content. */
export function setUpScaleGestures(canvas: HTMLCanvasElement, setScale: (value: number) => void, getScale: () => number): void {
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
      pinchStartScale = getScale();
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = distanceBetween();
    if (distance && pinchStartDistance) setScale(pinchStartScale * (distance / pinchStartDistance));
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) canvas.addEventListener(type, forgetPointer);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      setScale(getScale() * (event.deltaY < 0 ? 1.05 : 1 / 1.05));
    },
    { passive: false },
  );
}
