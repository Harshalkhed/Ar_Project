export type TrackingProviderState = 'idle' | 'initializing' | 'ready' | 'tracking' | 'error' | 'stopped';
export interface TrackingTarget { id: string; type: string; }
export interface TrackingEvent { type: 'initialized' | 'target_found' | 'target_lost' | 'error'; targetId?: string; message?: string; }
export interface TrackingProvider { readonly type: string; initialize(): Promise<void>; start(): Promise<void>; stop(): Promise<void>; onEvent(listener: (event: TrackingEvent) => void): () => void; }
