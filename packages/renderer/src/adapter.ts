import type { Transform } from '@internal-webar/project-schema';

export type RendererErrorCode = 'invalid_project' | 'unknown_scene' | 'unknown_object' | 'asset_load_failed' | 'disposed';

/** Reads asset bytes for a project URI. The host resolves paths; the renderer does not fetch. */
export type AssetReader = (uri: string) => Promise<Uint8Array>;

export interface LoadedObjectState {
  readonly id: string;
  readonly transform: Transform;
  readonly visible: boolean;
  /** True when a GLB scene graph was attached for this object's model asset. */
  readonly modelLoaded: boolean;
}

/**
 * Provider-neutral scene renderer. Implementations load objects from a validated project,
 * apply authoring transforms, and toggle visibility. Tracking providers are not part of this contract.
 */
export interface RendererAdapter {
  loadScene(project: unknown, sceneId: string, readAsset: AssetReader): Promise<void>;
  applyTransform(objectId: string, transform: Transform): void;
  setVisible(objectId: string, visible: boolean): void;
  getObjectState(objectId: string): LoadedObjectState | undefined;
  dispose(): void;
}

export class RendererError extends Error {
  constructor(readonly code: RendererErrorCode, message: string) {
    super(message);
    this.name = 'RendererError';
  }
}
