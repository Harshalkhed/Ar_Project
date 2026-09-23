import { DESCRIPTOR_BYTES, extractFeatures, type Feature } from './features.js';
import type { GrayImage } from './image.js';

export const COMPILED_TARGET_FORMAT = 'internal-webar/image-target';
/** Bump when the feature pipeline or descriptor pattern changes; old compiled targets must be recompiled. */
export const COMPILED_TARGET_VERSION = 1;

export interface CompiledImageTarget {
  /** Source image size in pixels; feature coordinates are in this pixel space. */
  readonly width: number;
  readonly height: number;
  readonly features: readonly Feature[];
}

export interface SerializedImageTarget {
  format: typeof COMPILED_TARGET_FORMAT;
  version: typeof COMPILED_TARGET_VERSION;
  width: number;
  height: number;
  features: { x: number; y: number; angle: number; level: number; descriptor: string }[];
}

/** Feature settings for targets: more features and levels than a live frame, since this runs offline. */
export const TARGET_FEATURE_OPTIONS = { maxFeatures: 900, levels: 5, scaleFactor: 0.75, threshold: 18 } as const;

/** Analyses a target image once (offline or at publish time) so detection only has to process camera frames. */
export function compileImageTarget(image: GrayImage): CompiledImageTarget {
  return { width: image.width, height: image.height, features: extractFeatures(image, TARGET_FEATURE_OPTIONS) };
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function serializeCompiledTarget(target: CompiledImageTarget): SerializedImageTarget {
  return {
    format: COMPILED_TARGET_FORMAT,
    version: COMPILED_TARGET_VERSION,
    width: target.width,
    height: target.height,
    features: target.features.map((feature) => ({ x: round(feature.x), y: round(feature.y), angle: round(feature.angle), level: feature.level, descriptor: toHex(feature.descriptor) })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const DESCRIPTOR_PATTERN = new RegExp(`^[0-9a-f]{${DESCRIPTOR_BYTES * 2}}$`);
const MAX_FEATURES = 20000;

/** Parses an untrusted serialized target; throws with a specific message when it is not a valid, current-format target. */
export function parseCompiledTarget(input: unknown): CompiledImageTarget {
  if (!isRecord(input)) throw new Error('Compiled target must be an object.');
  if (input.format !== COMPILED_TARGET_FORMAT) throw new Error(`Unsupported compiled target format: ${String(input.format)}.`);
  if (input.version !== COMPILED_TARGET_VERSION) throw new Error(`Unsupported compiled target version ${String(input.version)}; recompile the target.`);
  for (const key of ['width', 'height'] as const) {
    const value = input[key];
    if (!isFiniteNumber(value) || value <= 0 || !Number.isInteger(value)) throw new Error(`Compiled target ${key} must be a positive integer.`);
  }
  if (!Array.isArray(input.features) || input.features.length > MAX_FEATURES) throw new Error(`Compiled target features must be an array of at most ${MAX_FEATURES}.`);
  const features: Feature[] = input.features.map((entry: unknown, index: number) => {
    if (!isRecord(entry) || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.angle) || !isFiniteNumber(entry.level)) throw new Error(`Compiled target feature ${index} is malformed.`);
    if (typeof entry.descriptor !== 'string' || !DESCRIPTOR_PATTERN.test(entry.descriptor)) throw new Error(`Compiled target feature ${index} descriptor must be ${DESCRIPTOR_BYTES * 2} lowercase hex characters.`);
    const descriptor = new Uint8Array(DESCRIPTOR_BYTES);
    for (let byte = 0; byte < DESCRIPTOR_BYTES; byte += 1) descriptor[byte] = parseInt(entry.descriptor.slice(byte * 2, byte * 2 + 2), 16);
    return { x: entry.x, y: entry.y, angle: entry.angle, level: entry.level, descriptor };
  });
  return { width: input.width as number, height: input.height as number, features };
}
