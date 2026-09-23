import { TrackingError, type TrackingErrorCode, type TrackingEvent, type TrackingProvider, type TrackingTarget } from '@internal-webar/tracking';

/**
 * Integration seam for a concrete image-recognition engine (ARSY, MindAR, a custom WASM build, ...).
 * A vendor adapter implements this; the vendor SDK types stay inside that adapter.
 * Targets are identified by their index in the `loadTargets` list.
 */
export interface ImageTrackingEngine {
  loadTargets(imageUris: readonly string[]): Promise<void>;
  /** Opens the camera and begins recognition. Rejections should keep the browser's DOMException `name`. */
  start(callbacks: ImageTrackingEngineCallbacks): Promise<void>;
  stop(): Promise<void>;
}

export interface ImageTrackingEngineCallbacks {
  targetFound(index: number): void;
  targetLost(index: number): void;
  failed(error: unknown): void;
}

export interface ImageTrackingEnvironment { isSecureContext: boolean; hasCamera: boolean; }

interface BrowserScope { isSecureContext?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } }; }

export function detectImageTrackingEnvironment(scope: BrowserScope = globalThis as BrowserScope): ImageTrackingEnvironment {
  return {
    isSecureContext: scope.isSecureContext === true,
    hasCamera: typeof scope.navigator?.mediaDevices?.getUserMedia === 'function',
  };
}

const errorName = (error: unknown): string | undefined => (typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : undefined);
const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

/** Maps getUserMedia DOMException names (a web standard, not vendor API) to tracking error codes. */
function cameraErrorCode(error: unknown): TrackingErrorCode {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'NotReadableError':
    case 'OverconstrainedError':
      return 'camera_unavailable';
    default:
      return 'provider_failed';
  }
}

export class ImageTrackingProvider implements TrackingProvider {
  readonly type = 'image';
  private readonly listeners = new Set<(event: TrackingEvent) => void>();
  private targetIds: readonly string[] = [];
  private readonly found = new Set<string>();

  constructor(private readonly engine: ImageTrackingEngine, private readonly environment: ImageTrackingEnvironment = detectImageTrackingEnvironment()) {}

  async initialize(targets: readonly TrackingTarget[]): Promise<void> {
    if (!this.environment.isSecureContext) this.fail('unsupported', 'Image tracking requires a secure (HTTPS) context.');
    if (!this.environment.hasCamera) this.fail('unsupported', 'This browser does not expose a camera API.');
    if (targets.length === 0) this.fail('target_load_failed', 'Image tracking needs at least one target.');
    const imageUris: string[] = [];
    for (const target of targets) {
      if (target.type !== 'image' || !target.sourceUri) this.fail('target_load_failed', `Target ${target.id} is not an image target with a source URI.`);
      imageUris.push(target.sourceUri);
    }
    try {
      await this.engine.loadTargets(imageUris);
    } catch (error) {
      this.fail('target_load_failed', errorMessage(error, 'Image targets could not be loaded.'));
    }
    this.targetIds = targets.map((target) => target.id);
    this.emit({ type: 'initialized' });
  }

  async start(): Promise<void> {
    if (this.targetIds.length === 0) this.fail('provider_failed', 'Image tracking was started before initialize().');
    try {
      await this.engine.start({
        targetFound: (index) => this.transition(index, true),
        targetLost: (index) => this.transition(index, false),
        failed: (error) => this.emit({ type: 'error', code: 'provider_failed', message: errorMessage(error, 'Image tracking failed.') }),
      });
    } catch (error) {
      this.fail(cameraErrorCode(error), errorMessage(error, 'Camera could not be started.'));
    }
  }

  async stop(): Promise<void> {
    await this.engine.stop();
    this.found.clear();
  }

  onEvent(listener: (event: TrackingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private transition(index: number, isFound: boolean): void {
    const targetId = this.targetIds[index];
    if (targetId === undefined || this.found.has(targetId) === isFound) return;
    if (isFound) this.found.add(targetId);
    else this.found.delete(targetId);
    this.emit({ type: isFound ? 'target_found' : 'target_lost', targetId });
  }

  private fail(code: TrackingErrorCode, message: string): never {
    this.emit({ type: 'error', code, message });
    throw new TrackingError(code, message);
  }

  private emit(event: TrackingEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
