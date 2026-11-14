'use client';
import * as THREE from 'three';

// Physically based finishes for the procedural furniture. Each finish pairs a canvas-generated
// texture set (woven fabric, wood grain, rug pile) with the matching surface response:
// fabric has a soft sheen at grazing angles, wood a thin clear coat, metal sharp reflections,
// lacquer a glossy coat. The room's own panorama is applied as the environment map elsewhere
// (FurnitureLayer), so every highlight and reflection comes from the real room.

export type Finish = 'fabric' | 'linen' | 'wood' | 'lacquer' | 'metal' | 'rug' | 'leaf' | 'ceramic' | 'glass';

const SIZE = 256;

function canvas(draw: (ctx: CanvasRenderingContext2D, img: ImageData) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  draw(ctx, img);
  ctx.putImageData(img, 0, 0);
  return c;
}

// Cheap deterministic value noise.
function noise(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = Array.from({ length: 64 * 64 }, rnd);
  return (x: number, y: number) => {
    const xi = Math.floor(x) & 63;
    const yi = Math.floor(y) & 63;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const a = g[yi * 64 + xi];
    const b = g[yi * 64 + ((xi + 1) & 63)];
    const c = g[((yi + 1) & 63) * 64 + xi];
    const d = g[((yi + 1) & 63) * 64 + ((xi + 1) & 63)];
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// Height field -> tangent-space normal map.
function normalFrom(height: (x: number, y: number) => number, strength: number): HTMLCanvasElement {
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = height(x, y);
  return canvas((_, img) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const l = h[y * SIZE + ((x - 1 + SIZE) % SIZE)];
        const r = h[y * SIZE + ((x + 1) % SIZE)];
        const u = h[((y - 1 + SIZE) % SIZE) * SIZE + x];
        const d = h[((y + 1) % SIZE) * SIZE + x];
        const n = new THREE.Vector3((l - r) * strength, (u - d) * strength, 1).normalize();
        const i = (y * SIZE + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255;
        img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
  });
}

// Grey detail map multiplied with the product colour (so one texture serves every colour).
function detailFrom(value: (x: number, y: number) => number): HTMLCanvasElement {
  return canvas((_, img) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = Math.max(0, Math.min(255, value(x, y) * 255));
        const i = (y * SIZE + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
  });
}

type Set = { map: THREE.Texture; normal: THREE.Texture; scale: number }; // scale: metres per tile
let sets: Partial<Record<'weave' | 'grain' | 'pile' | 'leaf', Set>> | null = null;

function tex(c: HTMLCanvasElement, color: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureSets() {
  if (sets) return sets;
  const n1 = noise(7);
  const n2 = noise(31);
  // Basket weave: alternating over/under threads with slub noise.
  const weave = (x: number, y: number) => {
    const t = 16;
    const cx = Math.floor(x / t);
    const cy = Math.floor(y / t);
    const fx = (x % t) / t;
    const fy = (y % t) / t;
    const warp = (cx + cy) % 2 === 0;
    const thread = warp ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    return thread * 0.8 + n1(x / 6, y / 6) * 0.2;
  };
  // Wood: long stretched rings with fine pores.
  const grain = (x: number, y: number) => {
    const ring = Math.sin((x / SIZE) * 40 + n1(x / 40, y / 120) * 8) * 0.5 + 0.5;
    return ring * 0.6 + n2(x * 1.5, y / 12) * 0.4;
  };
  // Rug: dense pile loops.
  const pile = (x: number, y: number) => n1(x / 2.5, y / 2.5) * 0.6 + n2(x / 9, y / 9) * 0.4;
  const leaf = (x: number, y: number) => n1(x / 10, y / 10) * 0.7 + Math.abs(Math.sin(x / 9 + y / 17)) * 0.3;
  sets = {
    weave: { map: tex(detailFrom((x, y) => 0.7 + weave(x, y) * 0.3), true), normal: tex(normalFrom(weave, 3), false), scale: 0.09 },
    grain: { map: tex(detailFrom((x, y) => 0.72 + grain(x, y) * 0.28), true), normal: tex(normalFrom(grain, 0.8), false), scale: 0.6 },
    pile: { map: tex(detailFrom((x, y) => 0.8 + pile(x, y) * 0.2), true), normal: tex(normalFrom(pile, 3), false), scale: 0.12 },
    leaf: { map: tex(detailFrom((x, y) => 0.75 + leaf(x, y) * 0.25), true), normal: tex(normalFrom(leaf, 1.5), false), scale: 0.15 },
  };
  return sets;
}

// Finish for a colour when the category doesn't decide it: warm mid-tones read as wood,
// everything else as a painted (lacquered) surface.
export function woodOrPaint(color: string): Finish {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(color).getHSL(hsl);
  return hsl.h > 0.03 && hsl.h < 0.13 && hsl.s > 0.18 && hsl.l > 0.12 && hsl.l < 0.7 ? 'wood' : 'lacquer';
}

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

// A material for `finish` in `color`, with its textures tiled at real size for a surface of
// `size` metres (so the weave and grain are the same scale on every piece).
export function finishMaterial(finish: Finish, color: string, size: [number, number] = [1, 1], opacity = 1): THREE.MeshPhysicalMaterial {
  const key = `${finish}|${color}|${size[0].toFixed(2)}|${size[1].toFixed(2)}|${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = textureSets();
  const base = new THREE.Color(color);
  const tiled = (set: Set) => {
    const m = set.map.clone();
    const n = set.normal.clone();
    m.repeat.set(size[0] / set.scale, size[1] / set.scale);
    n.repeat.copy(m.repeat);
    return { map: m, normalMap: n };
  };
  const common = { transparent: opacity < 1, opacity, color: base };
  let mat: THREE.MeshPhysicalMaterial;
  switch (finish) {
    case 'fabric':
    case 'linen': {
      const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.35);
      mat = new THREE.MeshPhysicalMaterial({
        ...common,
        ...tiled(s.weave!),
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: finish === 'linen' ? 0.95 : 0.88,
        sheen: 1,
        sheenRoughness: 0.55,
        sheenColor: light,
      });
      break;
    }
    case 'rug':
      mat = new THREE.MeshPhysicalMaterial({
        ...common,
        ...tiled(s.pile!),
        normalScale: new THREE.Vector2(1, 1),
        roughness: 1,
        sheen: 0.8,
        sheenRoughness: 0.8,
        sheenColor: base.clone().lerp(new THREE.Color('#ffffff'), 0.25),
      });
      break;
    case 'wood':
      mat = new THREE.MeshPhysicalMaterial({
        ...common,
        ...tiled(s.grain!),
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.55,
        clearcoat: 0.45,
        clearcoatRoughness: 0.35,
      });
      break;
    case 'lacquer':
      mat = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.18 });
      break;
    case 'metal':
      mat = new THREE.MeshPhysicalMaterial({ ...common, metalness: 1, roughness: 0.32 });
      break;
    case 'ceramic':
      mat = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
      break;
    case 'glass':
      mat = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.05, metalness: 0, transmission: 0.9, thickness: 0.01, ior: 1.5 });
      break;
    case 'leaf':
      mat = new THREE.MeshPhysicalMaterial({
        ...common,
        ...tiled(s.leaf!),
        roughness: 0.55,
        sheen: 0.4,
        sheenColor: base.clone().lerp(new THREE.Color('#d8f0c0'), 0.4),
      });
      break;
  }
  cache.set(key, mat);
  return mat;
}

// IKEA's models ship generic materials ("Material_0") whose roughness and metalness live in a
// texture (the factors are both 1), so the finish is chosen from the product's category:
// upholstery gets a fabric sheen (plus a woven surface if it has no normal map), hard goods a
// thin varnish clear coat that picks up the room's highlights. Textures get anisotropic filtering.
const SOFT = new Set(['sofa', 'sectional', 'armchair', 'bed', 'rug', 'lounger', 'bench']);
export function enrichModelMaterial(std: THREE.MeshStandardMaterial, category: string): THREE.MeshStandardMaterial {
  for (const t of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap]) if (t) t.anisotropy = 8;
  if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
  const phys = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(phys, std);
  if (SOFT.has(category)) {
    phys.sheen = 1;
    phys.sheenRoughness = 0.5;
    phys.sheenColor = new THREE.Color('#ffffff').multiplyScalar(0.35);
    if (!std.normalMap) {
      const weave = textureSets().weave!.normal.clone();
      weave.repeat.set(24, 24);
      phys.normalMap = weave;
      phys.normalScale = new THREE.Vector2(0.4, 0.4);
    }
  } else {
    phys.clearcoat = 0.6;
    phys.clearcoatRoughness = 0.18;
  }
  return phys;
}
