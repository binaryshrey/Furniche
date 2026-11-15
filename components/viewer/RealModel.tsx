'use client';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { PhotoModel, Product } from '@/lib/types';
import Furniture3D, { BedDressing } from './Furniture3D';
import { enrichModelMaterial } from '@/lib/materials';
import { assetUrl } from '@/lib/photoAssets';

// A real 3D model fitted to the product's size: a store's own model (IKEA's textured GLBs today)
// or one generated from the shopper's photo. Shows the generic stand-in while it loads, or when
// there is no model.

let loader: GLTFLoader | null = null;
function gltf(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/decoders/draco/'));
  }
  return loader;
}

// One download and fit per product and size; instances clone the result.
const templates = new Map<string, Promise<THREE.Object3D | null>>();

// A bed's store model is the frame alone. Which end the headboard is on (the end with the tall
// geometry) and whether the model already has a mattress, so a mattress is added only when missing.
const bedInfo = new Map<string, { head: 1 | -1; hasMattress: boolean }>();
function inspectBed(root: THREE.Object3D, h: number) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let named = false;
  let sum = 0;
  let n = 0;
  root.traverse((o) => {
    if (/mattress/i.test(o.name)) named = true;
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry?.attributes?.position : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 4) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y > h * 0.6) {
        sum += v.z;
        n++;
      }
    }
  });
  return { head: (n && sum / n > 0 ? 1 : -1) as 1 | -1, hasMattress: named };
}

export function hasRealModel(p: Product): boolean {
  // Art and mirrors are drawn as upright panels: IKEA's models for them are authored lying flat.
  return !!p.photoModel || (p.placement !== 'wall' && p.retailer === 'ikea' && /^https:\/\/www\.ikea\.com\//.test(p.url));
}

export const photoModelUrl = (m: Pick<PhotoModel, 'id' | 'engine'>) => `/api/photo3d/${m.id}/${m.engine}`;

function modelUrl(p: Product): string {
  const q = new URLSearchParams({ id: p.id, url: p.url, name: p.name });
  return `/api/model3d?${q}`;
}

// A photo model's materials come from the photo, so they are used as they are, only kept opaque:
// alpha blending would sort badly against the scan. Shared with the preview in the photo panel.
const photoScenes = new Map<string, Promise<THREE.Object3D>>();
export function loadPhotoScene(url: string): Promise<THREE.Object3D> {
  let scene = photoScenes.get(url);
  if (!scene) {
    scene = gltf()
      .loadAsync(url)
      .then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
            for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (t) t.anisotropy = 8;
            if (mat.transparent) Object.assign(mat, { transparent: false, depthWrite: true, alphaTest: Math.max(mat.alphaTest, 0.5) });
            // Stable Fast 3D guesses one roughness and metalness for the whole piece, and sometimes
            // calls fabric polished metal, which renders almost black. Without per-texel maps (which
            // TRELLIS.2 gives), the photo's colours carry the look, so keep the surface matte.
            if (!mat.metalnessMap) mat.metalness = Math.min(mat.metalness, 0.05);
            if (!mat.roughnessMap) mat.roughness = Math.max(mat.roughness, 0.55);
          }
        });
        return g.scene;
      });
    scene.catch(() => photoScenes.delete(url)); // let a later attempt try again
    photoScenes.set(url, scene);
  }
  return scene;
}

// Centre on the floor, turn the long side to match the product's width, and scale to its size.
// IKEA models are already real scale; small differences are absorbed per axis, while a large
// one (likely a different variant) gets a uniform scale so the model isn't distorted.
function fit(scene: THREE.Object3D, w: number, d: number, h: number): THREE.Object3D {
  const inner = new THREE.Group();
  inner.add(scene);
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  if (Math.abs(w - d) > 0.05 && Math.sign(size.x - size.z) !== Math.sign(w - d)) {
    scene.rotation.y = Math.PI / 2;
    box = new THREE.Box3().setFromObject(inner);
    size = box.getSize(new THREE.Vector3());
  }
  const center = box.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= box.min.y;

  const ratios = [w / size.x, h / size.y, d / size.z];
  const outer = new THREE.Group();
  outer.add(inner);
  if (ratios.every((r) => r > 0.85 && r < 1.15)) inner.scale.set(ratios[0], ratios[1], ratios[2]);
  else inner.scale.setScalar([...ratios].sort((a, b) => a - b)[1]);
  return outer;
}

// Every vertex of a model as x, y, z, x, y, z, … in the model's own frame: what its size and
// squaring are worked out from (lib/photoSize.ts).
export function scenePoints(scene: THREE.Object3D): Float32Array {
  scene.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry.getAttribute('position') : null;
    if (!pos) return;
    const part = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      part[i * 3] = v.x;
      part[i * 3 + 1] = v.y;
      part[i * 3 + 2] = v.z;
    }
    parts.push(part);
  });
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
  return all;
}

// A photo model turned to face +Z, standing on the floor, scaled to the product's size. Its size was
// measured from every vertex at this turn (lib/photoSize.ts), so this box is measured the same way.
function fitPhoto(scene: THREE.Object3D, yaw: number, w: number, d: number, h: number): THREE.Object3D {
  const copy = scene.clone(true);
  copy.rotation.y = yaw;
  const turned = new THREE.Group().add(copy);
  const box = new THREE.Box3().setFromObject(turned, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  copy.position.x -= center.x;
  copy.position.z -= center.z;
  copy.position.y -= box.min.y;
  turned.scale.set(w / Math.max(size.x, 1e-6), h / Math.max(size.y, 1e-6), d / Math.max(size.z, 1e-6));
  return new THREE.Group().add(turned);
}

// While a photo's model is being built: its cut-out, upright at the piece's size, readable from both sides.
function standee(id: string, w: number, h: number): Promise<THREE.Object3D> {
  return assetUrl(id, 'cutout')
    .then((url) => new THREE.TextureLoader().loadAsync(url))
    .then((map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
      card.position.y = h / 2;
      return new THREE.Group().add(card);
    });
}

function load(p: Product): Promise<THREE.Object3D | null> {
  const { w, d, h } = p.dimsCm;
  const m = p.photoModel;
  // A photo model can be resized, turned or rebuilt, so those are part of the key.
  const key = m ? `${p.id}:${m.standee ? 'standee' : photoModelUrl(m)}:${m.yaw}:${w}x${d}x${h}` : p.id;
  let t = templates.get(key);
  if (!t && m?.standee) {
    t = standee(m.id, w / 100, h / 100).catch(() => null);
    templates.set(key, t);
  }
  if (!t && m) {
    t = assetUrl(m.id, m.engine)
      .then(loadPhotoScene)
      .then((scene) => fitPhoto(scene, m.yaw, w / 100, d / 100, h / 100))
      .catch(() => null);
    templates.set(key, t);
  }
  if (!t) {
    t = gltf()
      .loadAsync(modelUrl(p))
      .then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true; // lit and shadowed by the room (RoomLighting)
          m.receiveShadow = true;
          // Sharper textures, and a fabric sheen on upholstery (see enrichModelMaterial).
          const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) =>
            (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial ? enrichModelMaterial(mat as THREE.MeshStandardMaterial, p.category) : mat,
          );
          m.material = Array.isArray(m.material) ? mats : mats[0];
        });
        const fitted = fit(g.scene, w / 100, d / 100, h / 100);
        if (p.category === 'bed') bedInfo.set(p.id, { ...inspectBed(fitted, h / 100), hasMattress: /mattress/i.test(p.name) || inspectBed(fitted, h / 100).hasMattress });
        return fitted;
      })
      .catch(() => null);
    templates.set(key, t);
  }
  return t;
}

export default function RealModel({ product, w, d, h, opacity = 1, warnTint }: { product: Product; w: number; d: number; h: number; opacity?: number; warnTint?: string }) {
  const [template, setTemplate] = useState<THREE.Object3D | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    load(product).then((t) => live && setTemplate(t));
    return () => {
      live = false;
    };
  }, [product]);

  // Per-instance copy; materials are cloned only when this instance needs to look different.
  const object = useMemo(() => {
    if (!template) return null;
    const o = template.clone(true);
    if (opacity < 1 || warnTint) {
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
          const c = mat.clone() as THREE.MeshStandardMaterial;
          if (opacity < 1) Object.assign(c, { transparent: true, opacity, depthWrite: false });
          if (warnTint && c.emissive) {
            c.emissive = new THREE.Color(warnTint);
            c.emissiveIntensity = 0.22;
          }
          return c;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      });
    }
    return o;
  }, [template, opacity, warnTint]);

  if (!object) return <Furniture3D category={product.category} w={w} d={d} h={h} color={product.color} opacity={opacity} name={product.name} />;
  const bed = product.category === 'bed' ? bedInfo.get(product.id) : undefined;
  if (!bed || bed.hasMattress) return <primitive object={object} />;
  return (
    <group>
      <primitive object={object} />
      <group rotation={[0, bed.head > 0 ? Math.PI : 0, 0]}>
        <BedDressing w={w} d={d} base={Math.min(0.38, Math.max(0.22, h * 0.33))} opacity={opacity} />
      </group>
    </group>
  );
}
