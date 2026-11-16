#!/usr/bin/env python
"""Convert one NVIDIA SimReady prop (USD + MDL material + PNG textures) to a GLB master for assets-src/.

    python scripts/usd-to-glb.py <prop.usd> <out.glb> [--copyright TEXT]

Needs Pixar's usd-core (`pip install --user usd-core`); build-time only, nothing from it ships.
three.js's USD loader cannot read these files (binary crate, layered references, instancing).

What it does:
- Reads the stage's default prim, through instances, and ignores everything else (SimReady stages also
  carry a thumbnail rig with icon planes and lights).
- Applies each mesh's world transform, converts to glTF's Y-up and metres (upAxis, metersPerUnit),
  triangulates polygons, and expands face-varying normals/UVs per corner (the asset pipeline welds and
  simplifies afterwards). USD UVs have v up; glTF has v down, so v is flipped.
- Puts the origin at the bottom centre, so the piece stands on whatever surface it is placed on.
- Maps the MDL material's texture inputs (OmniPBR / SimPBR: diffuse, normal map, reflection roughness)
  onto a glTF metallic-roughness material, metallic 0. A grayscale roughness PNG works as the
  metallicRoughness texture: glTF reads roughness from G, and B (metalness) is multiplied by 0.
- Writes NVIDIA's required notice into the GLB's asset.copyright (see Architecture.md, demo projects).
Textures are embedded at full resolution; the caller resizes them (see README, asset pipeline).
"""
import argparse
import json
import struct
from array import array
from pathlib import Path

from pxr import Gf, Usd, UsdGeom, UsdShade

TEXTURE_INPUTS = {
    'baseColor': ('diffuse_texture', 'albedo_texture', 'base_color_texture'),
    'normal': ('normalmap_texture', 'normal_texture'),
    'roughness': ('reflectionroughness_texture', 'roughness_texture'),
}


def to_y_up(v, up_axis, scale):
    x, y, z = v[0] * scale, v[1] * scale, v[2] * scale
    return (x, z, -y) if up_axis == 'Z' else (x, y, z)


def material_textures(prim):
    """Texture file paths found on the mesh's bound material, keyed by glTF slot."""
    material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    found = {}
    if not material:
        return found
    for shader_prim in Usd.PrimRange(material.GetPrim()):
        if not shader_prim.IsA(UsdShade.Shader):
            continue
        for shader_input in UsdShade.Shader(shader_prim).GetInputs():
            path = getattr(shader_input.Get(), 'resolvedPath', None)  # Only asset-path inputs have one.
            if not path:
                continue
            for slot, names in TEXTURE_INPUTS.items():
                if shader_input.GetBaseName() in names:
                    found[slot] = path
    return found


def collect(stage):
    up_axis = UsdGeom.GetStageUpAxis(stage)
    scale = UsdGeom.GetStageMetersPerUnit(stage)
    root = stage.GetDefaultPrim()
    if not root:
        raise SystemExit('Stage has no default prim.')
    groups = {}  # texture set -> {positions, normals, uvs}
    for prim in Usd.PrimRange(root, Usd.TraverseInstanceProxies(Usd.PrimDefaultPredicate)):
        if not prim.IsA(UsdGeom.Mesh) or UsdGeom.Imageable(prim).ComputeVisibility() == 'invisible':
            continue
        if UsdGeom.Imageable(prim).ComputePurpose() not in ('default', 'render'):
            continue
        mesh = UsdGeom.Mesh(prim)
        world = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        normal_matrix = world.ExtractRotationMatrix().GetInverse().GetTranspose()
        points = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        normals = mesh.GetNormalsAttr().Get() if mesh.GetNormalsAttr().HasValue() else None
        normal_interp = mesh.GetNormalsInterpolation()
        st = UsdGeom.PrimvarsAPI(prim).GetPrimvar('st')
        st_values = st.Get() if st and st.HasValue() else None
        st_indices = st.GetIndices() if st_values is not None and st.IsIndexed() else None
        st_interp = st.GetInterpolation() if st_values is not None else None

        textures = material_textures(prim)
        key = json.dumps(textures, sort_keys=True)
        group = groups.setdefault(key, {'textures': textures, 'positions': array('f'), 'normals': array('f'), 'uvs': array('f')})

        def corner(face, fv):
            point_index = indices[fv]
            p = to_y_up(world.Transform(Gf.Vec3d(*points[point_index])), up_axis, scale)
            group['positions'].extend(p)
            if normals is not None:
                n = normals[{'faceVarying': fv, 'vertex': point_index, 'varying': point_index, 'uniform': face}.get(normal_interp, 0)]
                n = normal_matrix * Gf.Vec3d(*n)
                n = to_y_up(n.GetNormalized(), up_axis, 1.0)
            else:
                n = (0.0, 1.0, 0.0)
            group['normals'].extend(n)
            if st_values is not None:
                i = {'faceVarying': fv, 'vertex': point_index, 'varying': point_index, 'uniform': face}.get(st_interp, 0)
                u, v = st_values[st_indices[i] if st_indices is not None else i]
                group['uvs'].extend((u, 1.0 - v))
            else:
                group['uvs'].extend((0.0, 0.0))

        fv = 0
        for face, count in enumerate(counts):
            for k in range(1, count - 1):  # triangle fan
                for corner_fv in (fv, fv + k, fv + k + 1):
                    corner(face, corner_fv)
            fv += count
    if not groups:
        raise SystemExit('No visible meshes under the default prim.')
    return groups


def recentre(groups):
    xs, ys, zs = [], [], []
    for g in groups.values():
        p = g['positions']
        xs += [min(p[0::3]), max(p[0::3])]
        ys += [min(p[1::3]), max(p[1::3])]
        zs += [min(p[2::3]), max(p[2::3])]
    cx, cz, by = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2, min(ys)
    for g in groups.values():
        p = g['positions']
        for i in range(0, len(p), 3):
            p[i] -= cx
            p[i + 1] -= by
            p[i + 2] -= cz
    return (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))


def write_glb(groups, out, copyright_text):
    chunks, views, accessors, images, textures, materials, primitives = [], [], [], [], [], [], []
    length = 0

    def add_view(data, target=None):
        nonlocal length
        pad = (4 - length % 4) % 4
        chunks.append(b'\0' * pad)
        length += pad
        views.append({'buffer': 0, 'byteOffset': length, 'byteLength': len(data), **({'target': target} if target else {})})
        chunks.append(data)
        length += len(data)
        return len(views) - 1

    def add_accessor(values, kind, size, bounds=False):
        accessor = {'bufferView': add_view(values.tobytes(), 34962), 'componentType': 5126, 'count': len(values) // size, 'type': kind}
        if bounds:
            accessor['min'] = [min(values[i::3]) for i in range(3)]
            accessor['max'] = [max(values[i::3]) for i in range(3)]
        accessors.append(accessor)
        return len(accessors) - 1

    image_index = {}

    def texture(path):
        if path not in image_index:
            images.append({'bufferView': add_view(Path(path).read_bytes()), 'mimeType': 'image/png'})
            textures.append({'source': len(images) - 1, 'sampler': 0})
            image_index[path] = len(textures) - 1
        return {'index': image_index[path]}

    for g in groups.values():
        t = g['textures']
        pbr = {'metallicFactor': 0.0, 'roughnessFactor': 1.0}
        if 'baseColor' in t:
            pbr['baseColorTexture'] = texture(t['baseColor'])
        if 'roughness' in t:
            pbr['metallicRoughnessTexture'] = texture(t['roughness'])
        material = {'name': Path(t.get('baseColor', 'material')).stem, 'pbrMetallicRoughness': pbr}
        if 'normal' in t:
            material['normalTexture'] = texture(t['normal'])
        materials.append(material)
        primitives.append({
            'attributes': {
                'POSITION': add_accessor(g['positions'], 'VEC3', 3, True),
                'NORMAL': add_accessor(g['normals'], 'VEC3', 3),
                'TEXCOORD_0': add_accessor(g['uvs'], 'VEC2', 2),
            },
            'material': len(materials) - 1,
        })

    gltf = {
        'asset': {'version': '2.0', 'generator': 'internal-webar scripts/usd-to-glb.py', **({'copyright': copyright_text} if copyright_text else {})},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': Path(out).stem}],
        'meshes': [{'name': Path(out).stem, 'primitives': primitives}],
        'materials': materials, 'textures': textures, 'images': images,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': length}],
    }
    if not textures:
        for key in ('textures', 'images', 'samplers'):
            del gltf[key]
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode()
    json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = b''.join(chunks)
    bin_bytes += b'\0' * ((4 - len(bin_bytes) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(json_bytes), 0x4E4F534A) + json_bytes)
        f.write(struct.pack('<II', len(bin_bytes), 0x004E4942) + bin_bytes)
    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('usd')
    parser.add_argument('out')
    parser.add_argument('--copyright', default='')
    args = parser.parse_args()
    groups = collect(Usd.Stage.Open(args.usd))
    size = recentre(groups)
    triangles = sum(len(g['positions']) // 9 for g in groups.values())
    total = write_glb(groups, args.out, args.copyright)
    print(f"Wrote {args.out}: {triangles} triangles, {len(groups)} material(s), "
          f"{size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f} m (w x h x d), {total / 1048576:.1f} MB")
    for g in groups.values():
        print('  textures:', {slot: Path(path).name for slot, path in g['textures'].items()} or 'none')


if __name__ == '__main__':
    main()
