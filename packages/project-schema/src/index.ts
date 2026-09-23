export type TrackingType = 'image' | 'qr' | 'face' | 'webxr' | 'ar360' | 'geo' | 'vps';
export type DeploymentStatus = 'draft' | 'test' | 'production' | 'archived';

export interface Vec3 { x: number; y: number; z: number; }
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3; }
export interface AssetRef { id: string; kind: 'model' | 'image' | 'video' | 'audio' | 'environment'; uri: string; }
export interface SceneObject { id: string; assetId?: string; name: string; transform: Transform; visible: boolean; }
export interface Interaction { id: string; event: 'object_click' | 'button_click' | 'target_found'; action: 'show_object' | 'hide_object' | 'change_scene' | 'emit'; targetId?: string; sceneId?: string; }
export interface Scene { id: string; name: string; objectIds: string[]; interactions: Interaction[]; }
export interface Trigger { id: string; type: TrackingType; label: string; sceneIds: string[]; config: Record<string, unknown>; }
/** Provider-neutral config required on `image` triggers: the target image is an `image` asset referenced by stable ID. */
export interface ImageTriggerConfig { imageAssetId: string; }
export interface Deployment { experienceId: string; version: number; status: DeploymentStatus; runtimeVersion: string; }
export interface ProjectDocument {
  schemaVersion: '1.0';
  id: string;
  name: string;
  tracking: { type: TrackingType };
  triggers: Trigger[];
  scenes: Scene[];
  objects: SceneObject[];
  assets: AssetRef[];
  deployment: Deployment;
}

export { validateProject, type ValidationIssue } from './validation.js';
