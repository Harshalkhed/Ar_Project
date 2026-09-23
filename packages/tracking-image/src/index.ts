import type { TrackingEvent, TrackingProvider } from '@internal-webar/tracking';

export class ImageTrackingProvider implements TrackingProvider {
  readonly type = 'image';
  private listeners = new Set<(event: TrackingEvent) => void>();
  async initialize(): Promise<void> { this.emit({ type: 'initialized' }); }
  async start(): Promise<void> { /* Real camera/WASM integration is the next milestone. */ }
  async stop(): Promise<void> { this.listeners.clear(); }
  onEvent(listener: (event: TrackingEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: TrackingEvent): void { for (const listener of this.listeners) listener(event); }
}
