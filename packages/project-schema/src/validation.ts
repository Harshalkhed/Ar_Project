import type { ProjectDocument } from './index.js';

export interface ValidationIssue { path: string; message: string; }

export function validateProject(project: ProjectDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (project.schemaVersion !== '1.0') issues.push({ path: 'schemaVersion', message: 'Unsupported schema version.' });
  if (!project.id) issues.push({ path: 'id', message: 'Project id is required.' });
  if (!project.name) issues.push({ path: 'name', message: 'Project name is required.' });
  const ids = new Set<string>();
  for (const asset of project.assets) { if (ids.has(asset.id)) issues.push({ path: `assets.${asset.id}`, message: 'Duplicate asset id.' }); ids.add(asset.id); }
  const sceneIds = new Set(project.scenes.map((scene) => scene.id));
  for (const trigger of project.triggers) for (const sceneId of trigger.sceneIds) if (!sceneIds.has(sceneId)) issues.push({ path: `triggers.${trigger.id}.sceneIds`, message: `Unknown scene id: ${sceneId}.` });
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  for (const object of project.objects) if (object.assetId && !assetIds.has(object.assetId)) issues.push({ path: `objects.${object.id}.assetId`, message: `Unknown asset id: ${object.assetId}.` });
  return issues;
}
