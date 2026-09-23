export type TrackingProviderState = 'idle' | 'initializing' | 'ready' | 'tracking' | 'error' | 'stopped';

/** Provider-neutral target. `id` is the project trigger ID; `sourceUri` is the resolved asset (e.g. a target image). */
export interface TrackingTarget { readonly id: string; readonly type: string; readonly sourceUri?: string; }

/**
 * Column-major 4×4 matrix (16 finite numbers) for one target, matching Three.js `Matrix4.elements`.
 * Index 12, 13, 14 is the translation. The renderer consumes this later; tracking does not import it.
 */
export type TargetPose = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export function isTargetPose(value: unknown): value is TargetPose {
  return Array.isArray(value) && value.length === 16 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

export type TrackingErrorCode = 'unsupported' | 'permission_denied' | 'camera_unavailable' | 'target_load_failed' | 'provider_failed';

export type TrackingEvent =
  | { type: 'initialized' }
  | { type: 'target_found'; targetId: string; pose?: TargetPose }
  | { type: 'target_lost'; targetId: string }
  | { type: 'pose_updated'; targetId: string; pose: TargetPose }
  | { type: 'error'; message?: string; code?: TrackingErrorCode };

/** Thrown by providers so the runtime can show a specific recovery state instead of a generic failure. */
export class TrackingError extends Error {
  constructor(readonly code: TrackingErrorCode, message: string) {
    super(message);
    this.name = 'TrackingError';
  }
}

export interface TrackingProvider {
  readonly type: string;
  initialize(targets: readonly TrackingTarget[]): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: TrackingEvent) => void): () => void;
}
