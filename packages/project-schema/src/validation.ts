export interface ValidationIssue { path: string; message: string; }

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const records = (value: unknown): UnknownRecord[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const idOf = (record: UnknownRecord): string => (typeof record.id === 'string' ? record.id : '?');
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** Relative paths or https URLs only; blocks javascript:, data:, http: and protocol-relative URIs. */
function isAllowedAssetUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length === 0 || uri.startsWith('//')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri);
  return !scheme || scheme[1].toLowerCase() === 'https';
}

const isGlbUri = (uri: string): boolean => /\.glb$/i.test(uri.split(/[?#]/)[0]);

/**
 * Validates an untrusted project document. Accepts `unknown` so JSON from storage or the network
 * can be checked before it is treated as a `ProjectDocument`; an empty result means it is safe to use.
 */
export function validateProject(input: unknown): ValidationIssue[] {
  if (!isRecord(input)) return [{ path: '', message: 'Project document must be an object.' }];
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string): void => { issues.push({ path, message }); };

  if (input.schemaVersion !== '1.0') report('schemaVersion', 'Unsupported schema version.');
  if (!input.id) report('id', 'Project id is required.');
  if (!input.name) report('name', 'Project name is required.');
  for (const key of ['triggers', 'scenes', 'objects', 'assets']) if (!Array.isArray(input[key])) report(key, 'Must be an array.');
  // Reference checks against a missing collection would only produce cascading noise.
  if (issues.some((issue) => issue.message === 'Must be an array.')) return issues;

  const triggers = records(input.triggers);
  const scenes = records(input.scenes);
  const objects = records(input.objects);
  const assets = records(input.assets);

  const collectIds = (collection: string, noun: string, items: UnknownRecord[]): Set<string> => {
    const ids = new Set<string>();
    for (const item of items) {
      const id = idOf(item);
      if (ids.has(id)) report(`${collection}.${id}`, `Duplicate ${noun} id.`);
      ids.add(id);
    }
    return ids;
  };
  collectIds('triggers', 'trigger', triggers);
  const sceneIds = collectIds('scenes', 'scene', scenes);
  const objectIds = collectIds('objects', 'object', objects);
  const assetIds = collectIds('assets', 'asset', assets);
  const imageAssetIds = new Set(assets.filter((asset) => asset.kind === 'image').map(idOf));

  for (const asset of assets) {
    const path = `assets.${idOf(asset)}.uri`;
    if (!isAllowedAssetUri(asset.uri)) report(path, 'Asset URI must be a relative path or an https URL.');
    else if (asset.kind === 'model' && !isGlbUri(asset.uri as string)) report(path, 'Model assets must be .glb files.');
  }

  for (const trigger of triggers) {
    const path = `triggers.${idOf(trigger)}`;
    for (const sceneId of stringList(trigger.sceneIds)) if (!sceneIds.has(sceneId)) report(`${path}.sceneIds`, `Unknown scene id: ${sceneId}.`);
    if (trigger.type === 'image') {
      const imageAssetId = isRecord(trigger.config) ? trigger.config.imageAssetId : undefined;
      if (typeof imageAssetId !== 'string' || !imageAssetIds.has(imageAssetId)) report(`${path}.config.imageAssetId`, 'Image triggers must reference an image asset.');
    }
  }

  for (const scene of scenes) {
    const path = `scenes.${idOf(scene)}`;
    for (const objectId of stringList(scene.objectIds)) if (!objectIds.has(objectId)) report(`${path}.objectIds`, `Unknown object id: ${objectId}.`);
    for (const interaction of records(scene.interactions)) {
      const interactionPath = `${path}.interactions.${idOf(interaction)}`;
      const targetsObject = interaction.action === 'show_object' || interaction.action === 'hide_object';
      if (targetsObject && typeof interaction.targetId === 'string' && !objectIds.has(interaction.targetId)) report(`${interactionPath}.targetId`, `Unknown object id: ${interaction.targetId}.`);
      if (typeof interaction.sceneId === 'string' && !sceneIds.has(interaction.sceneId)) report(`${interactionPath}.sceneId`, `Unknown scene id: ${interaction.sceneId}.`);
    }
  }

  for (const object of objects) {
    if (typeof object.assetId === 'string' && !assetIds.has(object.assetId)) report(`objects.${idOf(object)}.assetId`, `Unknown asset id: ${object.assetId}.`);
  }

  return issues;
}
