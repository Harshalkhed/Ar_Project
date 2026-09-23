import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { isTargetPose, TrackingError, type TargetPose, type TrackingErrorCode, type TrackingEvent, type TrackingProvider, type TrackingTarget } from '@internal-webar/tracking';

export type { TargetPose } from '@internal-webar/tracking';

export type RuntimeState = 'created' | 'initializing' | 'ready' | 'tracking' | 'error' | 'stopped';
export type RuntimeErrorCode = 'invalid_project' | 'unsupported_tracking_type' | 'no_targets' | TrackingErrorCode;

export type RuntimeEvent =
  | { type: 'runtime_initialized' }
  | { type: 'tracking_initialized' }
  | { type: 'target_found'; targetId: string; pose?: TargetPose }
  | { type: 'target_lost'; targetId: string }
  | { type: 'pose_updated'; targetId: string; pose: TargetPose }
  | { type: 'runtime_error'; code: RuntimeErrorCode; message: string };

export class RuntimeError extends Error {
  constructor(readonly code: RuntimeErrorCode, message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/** Maps project triggers to provider-neutral targets, resolving asset IDs to URIs so providers never see the schema. */
export function resolveTrackingTargets(project: ProjectDocument): TrackingTarget[] {
  const assetUris = new Map(project.assets.map((asset) => [asset.id, asset.uri]));
  return project.triggers
    .filter((trigger) => trigger.type === project.tracking.type)
    .map((trigger) => {
      const imageAssetId = trigger.type === 'image' ? trigger.config.imageAssetId : undefined;
      const sourceUri = typeof imageAssetId === 'string' ? assetUris.get(imageAssetId) : undefined;
      return sourceUri === undefined ? { id: trigger.id, type: trigger.type } : { id: trigger.id, type: trigger.type, sourceUri };
    });
}

export class RuntimeCore {
  state: RuntimeState = 'created';
  private unsubscribe: (() => void) | undefined;
  private readonly found = new Set<string>();

  constructor(private readonly provider: TrackingProvider, private readonly emit: (event: RuntimeEvent) => void = () => {}) {}

  async start(project: ProjectDocument): Promise<void> {
    if (this.state !== 'created' && this.state !== 'stopped' && this.state !== 'error') throw new Error(`Runtime is already ${this.state}.`);
    try {
      const issues = validateProject(project);
      if (issues.length) throw new RuntimeError('invalid_project', issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
      if (this.provider.type !== project.tracking.type) throw new RuntimeError('unsupported_tracking_type', `No ${this.provider.type} provider can run ${project.tracking.type} tracking.`);
      const targets = resolveTrackingTargets(project);
      if (targets.length === 0) throw new RuntimeError('no_targets', `Project has no ${project.tracking.type} triggers to track.`);

      this.state = 'initializing';
      this.found.clear();
      this.unsubscribe?.();
      this.unsubscribe = this.provider.onEvent((event) => this.handleTrackingEvent(event));
      await this.provider.initialize(targets);
      await this.provider.start();
      this.emit({ type: 'runtime_initialized' });
    } catch (error) {
      if (this.state !== 'error') this.fail(errorCode(error), error instanceof Error ? error.message : 'Runtime initialization failed.');
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.provider.stop();
    this.found.clear();
    this.state = 'stopped';
  }

  private handleTrackingEvent(event: TrackingEvent): void {
    if (event.type === 'initialized') {
      this.state = 'ready';
      this.emit({ type: 'tracking_initialized' });
    } else if (event.type === 'error') {
      this.fail(event.code ?? 'provider_failed', event.message ?? 'Tracking failed.');
    } else if (event.type === 'pose_updated') {
      if (isTargetPose(event.pose)) this.emit({ type: 'pose_updated', targetId: event.targetId, pose: event.pose });
    } else if (event.type === 'target_found' || event.type === 'target_lost') {
      if (event.type === 'target_found') this.found.add(event.targetId);
      else this.found.delete(event.targetId);
      this.state = this.found.size > 0 ? 'tracking' : 'ready';
      const pose = event.type === 'target_found' && isTargetPose(event.pose) ? event.pose : undefined;
      this.emit(pose ? { type: 'target_found', targetId: event.targetId, pose } : { type: event.type, targetId: event.targetId });
    }
  }

  private fail(code: RuntimeErrorCode, message: string): void {
    this.state = 'error';
    this.emit({ type: 'runtime_error', code, message });
  }
}

function errorCode(error: unknown): RuntimeErrorCode {
  if (error instanceof RuntimeError || error instanceof TrackingError) return error.code;
  return 'provider_failed';
}
