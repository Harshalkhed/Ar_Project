export type TrackingProviderState = 'idle' | 'initializing' | 'ready' | 'tracking' | 'error' | 'stopped';

/** Provider-neutral target. `id` is the project trigger ID; `sourceUri` is the resolved asset (e.g. a target image). */
export interface TrackingTarget { readonly id: string; readonly type: string; readonly sourceUri?: string; }

export type TrackingErrorCode = 'unsupported' | 'permission_denied' | 'camera_unavailable' | 'target_load_failed' | 'provider_failed';

export interface TrackingEvent { type: 'initialized' | 'target_found' | 'target_lost' | 'error'; targetId?: string; message?: string; code?: TrackingErrorCode; }

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
