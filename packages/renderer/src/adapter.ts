import type { Transform } from '@internal-webar/project-schema';

export type RendererErrorCode = 'invalid_project' | 'unknown_scene' | 'unknown_object' | 'asset_load_failed' | 'invalid_anchor' | 'disposed';

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
  /**
   * Places the whole scene in camera space with a column-major 4×4 matrix (16 finite numbers), or hides it with null.
   * Objects keep their authored transforms relative to this anchor. Plain numbers keep the renderer independent of tracking.
   */
  setAnchor(matrix: readonly number[] | null): void;
  getObjectState(objectId: string): LoadedObjectState | undefined;
  dispose(): void;
}

export class RendererError extends Error {
  constructor(readonly code: RendererErrorCode, message: string) {
    super(message);
    this.name = 'RendererError';
  }
}
