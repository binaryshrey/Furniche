'use client';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { Product } from '@/lib/types';
import Furniture3D from './Furniture3D';

// Art and mirrors drawn as what they are on a wall: an upright frame flat against it, its face
// toward the room (+Z), bottom edge at y = 0. Art shows the product's own picture; a mirror is a
// polished face that picks up the room's light. (IKEA's 3D files for flat pieces don't always
// stand upright, so they aren't used here.)

const textures = new Map<string, Promise<THREE.Texture | null>>();
function artTexture(p: Product): Promise<THREE.Texture | null> {
  const url = `/api/product-image?v=room&id=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}`;
  if (!textures.has(url)) {
    textures.set(
      url,
      new Promise((res) =>
        new THREE.TextureLoader().load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            // Studio photos have a margin around the piece: use the middle.
            t.repeat.set(0.84, 0.84);
            t.offset.set(0.08, 0.08);
            t.anisotropy = 4;
            res(t);
          },
          undefined,
          () => res(null),
        ),
      ),
    );
  }
  return textures.get(url)!;
}

export default function WallPiece({ product, w, h, d, opacity = 1 }: { product: Product; w: number; h: number; d: number; opacity?: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const art = product.category === 'wall-art';
  useEffect(() => {
    if (!art || product.retailer !== 'ikea') return;
    let alive = true;
    artTexture(product).then((t) => alive && setTex(t));
    return () => {
      alive = false;
    };
  }, [art, product]);

  const depth = Math.max(0.025, Math.min(d, 0.05));
  const frame = Math.min(0.04, Math.min(w, h) * 0.06);
  const frameMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: product.color, roughness: 0.55, metalness: 0.1, transparent: opacity < 1, opacity }),
    [product.color, opacity],
  );
  const faceMat = useMemo(() => {
    if (!art) return new THREE.MeshStandardMaterial({ color: '#dfe7ea', roughness: 0.04, metalness: 0.95, transparent: opacity < 1, opacity });
    return new THREE.MeshStandardMaterial({ map: tex ?? null, color: tex ? '#ffffff' : product.color, roughness: 0.8, transparent: opacity < 1, opacity });
  }, [art, tex, product.color, opacity]);
  useEffect(() => () => (frameMat.dispose(), faceMat.dispose()), [frameMat, faceMat]);

  if (product.category === 'tv') return <Furniture3D category="tv" w={w} d={d} h={h} color={product.color} opacity={opacity} />;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={frameMat} castShadow receiveShadow>
        <boxGeometry args={[w, h, depth]} />
      </mesh>
      <mesh position={[0, h / 2, depth / 2 + 0.002]} material={faceMat}>
        <planeGeometry args={[w - frame * 2, h - frame * 2]} />
      </mesh>
    </group>
  );
}
