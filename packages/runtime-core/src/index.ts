import { validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import type { TrackingEvent, TrackingProvider, TrackingProviderState } from '@internal-webar/tracking';

export type RuntimeEvent = { type: 'runtime_initialized' | 'tracking_initialized' | 'runtime_error'; message?: string } | TrackingEvent;
export class RuntimeCore {
  state: TrackingProviderState = 'idle';
  constructor(private readonly provider: TrackingProvider, private readonly emit: (event: RuntimeEvent) => void = () => {}) {}
  async start(project: ProjectDocument): Promise<void> {
    const issues = validateProject(project);
    if (issues.length) { this.state = 'error'; const message = issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '); this.emit({ type: 'runtime_error', message }); throw new Error(message); }
    this.state = 'initializing';
    this.provider.onEvent((event) => { if (event.type === 'initialized') { this.state = 'ready'; this.emit({ type: 'tracking_initialized' }); } this.emit(event); });
    try { await this.provider.initialize(); await this.provider.start(); this.emit({ type: 'runtime_initialized' }); } catch (error) { this.state = 'error'; const message = error instanceof Error ? error.message : 'Runtime initialization failed.'; this.emit({ type: 'runtime_error', message }); throw error; }
  }
  async stop(): Promise<void> { await this.provider.stop(); this.state = 'stopped'; }
}
