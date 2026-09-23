import { validateProject, type ProjectDocument, type SceneObject, type Transform } from '@internal-webar/project-schema';
import { Mesh, Object3D, Scene, type Group, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RendererError, type AssetReader, type LoadedObjectState, type RendererAdapter } from './adapter.js';

const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] as const;

/** GLB files start with the ASCII magic `glTF` (little-endian 0x46546C67). */
function hasGlbMagic(bytes: Uint8Array): boolean {
  return bytes.length >= GLB_MAGIC.length && GLB_MAGIC.every((byte, index) => bytes[index] === byte);
}

function readTransform(node: Object3D): Transform {
  return {
    position: { x: node.position.x, y: node.position.y, z: node.position.z },
    rotation: { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z },
    scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
  };
}

function writeTransform(node: Object3D, transform: Transform): void {
  node.position.set(transform.position.x, transform.position.y, transform.position.z);
  node.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  node.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
}

function disposeMaterials(material: Material | Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) entry.dispose();
}

function release(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      disposeMaterials(object.material);
    }
  });
}

function parseGlb(bytes: Uint8Array): Promise<Group> {
  const loader = new GLTFLoader();
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  return new Promise((resolve, reject) => {
    loader.parse(data, '', (gltf) => resolve(gltf.scene), (error) => reject(error));
  });
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Three.js implementation of {@link RendererAdapter}. Three.js types stay inside this module. */
export class ThreeRenderer implements RendererAdapter {
  /** Root of the loaded objects. A Three.js host adds this to its own stage (lights, camera) and draws it. */
  readonly scene = new Scene();
  private readonly nodes = new Map<string, Object3D>();
  private disposed = false;

  async loadScene(project: unknown, sceneId: string, readAsset: AssetReader): Promise<void> {
    this.assertActive();
    const issues = validateProject(project);
    if (issues.length) throw new RendererError('invalid_project', issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    const document = project as ProjectDocument;
    const scene = document.scenes.find((entry) => entry.id === sceneId);
    if (!scene) throw new RendererError('unknown_scene', `Unknown scene id: ${sceneId}.`);

    const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
    const loaded: { object: SceneObject; model?: Group }[] = [];
    for (const objectId of scene.objectIds) {
      const object = document.objects.find((entry) => entry.id === objectId);
      if (!object) throw new RendererError('asset_load_failed', `Scene object ${objectId} is missing.`);
      loaded.push({ object, model: object.assetId ? await this.loadModel(object, assets, readAsset) : undefined });
    }

    this.clear();
    for (const entry of loaded) {
      const node = new Object3D();
      node.name = entry.object.id;
      writeTransform(node, entry.object.transform);
      node.visible = entry.object.visible;
      if (entry.model) node.add(entry.model);
      this.scene.add(node);
      this.nodes.set(entry.object.id, node);
    }
  }

  applyTransform(objectId: string, transform: Transform): void {
    writeTransform(this.requireNode(objectId), transform);
  }

  setVisible(objectId: string, visible: boolean): void {
    this.requireNode(objectId).visible = visible;
  }

  getObjectState(objectId: string): LoadedObjectState | undefined {
    if (this.disposed) return undefined;
    const node = this.nodes.get(objectId);
    if (!node) return undefined;
    return { id: objectId, transform: readTransform(node), visible: node.visible, modelLoaded: node.children.length > 0 };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private async loadModel(object: SceneObject, assets: Map<string, ProjectDocument['assets'][number]>, readAsset: AssetReader): Promise<Group> {
    const asset = object.assetId ? assets.get(object.assetId) : undefined;
    if (!asset || asset.kind !== 'model') throw new RendererError('asset_load_failed', `Object ${object.id} does not reference a model asset.`);
    let bytes: Uint8Array;
    try {
      bytes = await readAsset(asset.uri);
    } catch (error) {
      throw new RendererError('asset_load_failed', failureMessage(error, `Asset ${asset.id} could not be read.`));
    }
    if (!hasGlbMagic(bytes)) throw new RendererError('asset_load_failed', `Asset ${asset.id} does not start with the GLB magic header.`);
    try {
      return await parseGlb(bytes);
    } catch (error) {
      throw new RendererError('asset_load_failed', failureMessage(error, `Asset ${asset.id} could not be parsed as GLB.`));
    }
  }

  private requireNode(objectId: string): Object3D {
    this.assertActive();
    const node = this.nodes.get(objectId);
    if (!node) throw new RendererError('unknown_object', `Unknown object id: ${objectId}.`);
    return node;
  }

  private assertActive(): void {
    if (this.disposed) throw new RendererError('disposed', 'Renderer has been disposed.');
  }

  private clear(): void {
    for (const node of this.nodes.values()) release(node);
    this.scene.clear();
    this.nodes.clear();
  }
}
