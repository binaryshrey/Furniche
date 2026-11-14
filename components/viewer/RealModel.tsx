'use client';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Product } from '@/lib/types';
import Furniture3D from './Furniture3D';
import { enrichModelMaterial } from '@/lib/materials';

// A store's real 3D model (IKEA's textured GLBs today), fitted to the product's catalogue size.
// Shows the generic stand-in while it loads, or when the store has no model.

let loader: GLTFLoader | null = null;
function gltf(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath('/decoders/draco/'));
  }
  return loader;
}

// One download and fit per product; instances clone the result.
const templates = new Map<string, Promise<THREE.Object3D | null>>();

export function hasRealModel(p: Product): boolean {
  return p.retailer === 'ikea' && /^https:\/\/www\.ikea\.com\//.test(p.url);
}

function modelUrl(p: Product): string {
  const q = new URLSearchParams({ id: p.id, url: p.url, name: p.name });
  return `/api/model3d?${q}`;
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

function load(p: Product): Promise<THREE.Object3D | null> {
  let t = templates.get(p.id);
  if (!t) {
    const { w, d, h } = p.dimsCm;
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
        return fit(g.scene, w / 100, d / 100, h / 100);
      })
      .catch(() => null);
    templates.set(p.id, t);
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

  if (!object) return <Furniture3D category={product.category} w={w} d={d} h={h} color={product.color} opacity={opacity} />;
  return <primitive object={object} />;
}
