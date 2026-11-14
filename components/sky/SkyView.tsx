'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { EnvironmentControls, TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, ReorientationPlugin, TilesFadePlugin } from '3d-tiles-renderer/three/plugins';

export type SkyPin = { sid: string; lat: number; lon: number; label: string };
type LatLon = { lat: number; lon: number };

const TILESET = '/api/vexcel/3d/tileset.json?collection=us-tx-houstonr2-2023&layer=3d-cities';
// Ground in Houston sits a little below the WGS84 ellipsoid (geoid offset ≈ -27 m, land ≈ +15 m).
const GROUND_H = -12;
const PIN_H = 70; // pins float this high above the ground
const D2R = THREE.MathUtils.DEG2RAD;
// The scene is anchored here once; the camera flies, the city never reloads.
const ORIGIN: LatLon = { lat: 29.7589, lon: -95.3677 };

// A camera move: position and look-at target eased together, optionally narrowing the lens,
// optionally followed by another leg.
type Flight = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  lookFrom: THREE.Vector3;
  lookTo: THREE.Vector3;
  fovFrom: number;
  fovTo: number;
  dur: number;
  t: number;
  next?: () => Flight;
  done?: () => void;
};

// Keeps every tileset and mesh in the browser's Cache Storage (persistent and far larger than
// localStorage), so a revisit loads the city with no network at all. The data never changes.
const TILE_CACHE = 'furniche-3d-tiles-v1';
class BrowserTileCache {
  name = 'BROWSER_TILE_CACHE';
  async fetchData(url: string, options?: RequestInit): Promise<Response> {
    if (typeof caches === 'undefined') return fetch(url, options);
    try {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await fetch(url, options);
      if (res.ok) cache.put(url, res.clone()).catch(() => {});
      return res;
    } catch {
      return fetch(url, options);
    }
  }
}

// Pulls the whole city overview (every tileset, meshes down to zoom 15, listed by
// /api/vexcel/3d-manifest) into the same cache in the background, so flying anywhere in Houston
// is served locally. Finer zooms (several GB) still stream on demand.
async function preloadCity(signal: { paused: boolean; stopped: boolean }, onProgress: (done: number, total: number) => void, workers = 6) {
  if (typeof caches === 'undefined') return;
  const res = await fetch('/api/vexcel/3d-manifest');
  if (!res.ok) return;
  const { base, urls } = (await res.json()) as { base: string; urls: string[] };
  const cache = await caches.open(TILE_CACHE);
  // Keys exactly as the renderer requests them (relative links resolved against the proxy).
  const all = urls.map((u) => new URL(base + u, location.origin).href);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = all.filter((u) => !have.has(u));
  let done = all.length - todo.length;
  onProgress(done, all.length);
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !signal.stopped) {
      while (signal.paused && !signal.stopped) await new Promise((r) => setTimeout(r, 500));
      const url = todo[i++];
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url);
          if (r.ok) await cache.put(url, r);
        }
      } catch {
        /* the renderer will fetch it on demand */
      }
      done += 1;
      onProgress(done, all.length);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

// Vexcel's mesh is textured with aerial photos that already hold the real sun, shadows and
// colours, so the most photographic result is to show them as captured: unlit, with no second,
// fake lighting pass on top. Anisotropic filtering keeps the oblique facades sharp. Runs before
// the tile is added (and before the fade plugin wraps its materials).
class PhotoMaterials {
  name = 'PHOTO_MATERIALS';
  constructor(private anisotropy: number) {}
  processTileModel(scene: THREE.Object3D) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material as THREE.MeshStandardMaterial;
      const map = old.map ?? null;
      if (map) {
        map.anisotropy = this.anisotropy;
        map.colorSpace = THREE.SRGBColorSpace;
      }
      mesh.material = new THREE.MeshBasicMaterial({ map, color: map ? 0xffffff : old.color, side: old.side });
      old.dispose();
    });
  }
}

// A daytime sky dome: deep blue overhead fading to a pale haze at the horizon. The fog uses the
// same haze colour, so distant blocks dissolve into the sky like real aerial perspective.
const HAZE = new THREE.Color('#c3cfdb');
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color('#3f6fa8') }, horizon: { value: HAZE }, below: { value: new THREE.Color('#8f9aa3') } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir;' +
      'void main() { float h = vDir.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(min(h * 2.2, 1.0), 0.7)) : mix(horizon, below, min(-h * 6.0, 1.0));' +
      ' gl_FragColor = vec4(c, 1.0); #include <colorspace_fragment> }',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

// The real room, before the tour has loaded: the six faces of the 360° photo where the tour
// opens (Matterport order: up, front, right, back, left, down), as an inward-facing cube around
// that spot. The flight ends inside it, so the crossfade to the live tour is from the same view.
export type Entry = { faces: string[]; eyeHeight: number };
const ROOM_HALF = 6; // metres; beyond the camera's near plane
function panoRoom(faces: string[]): { group: THREE.Group; mats: THREE.MeshBasicMaterial[]; state: { loaded: boolean; failed: boolean } } {
  const loader = new THREE.TextureLoader();
  const group = new THREE.Group();
  const mats: THREE.MeshBasicMaterial[] = [];
  const s = ROOM_HALF;
  // [position, rotation] per face so each looks inward with the image upright.
  const place: [number, number, number, number, number][] = [
    [0, s, 0, Math.PI / 2, 0], // up
    [0, 0, -s, 0, 0], // front (-z)
    [s, 0, 0, 0, -Math.PI / 2], // right (+x)
    [0, 0, s, 0, Math.PI], // back (+z)
    [-s, 0, 0, 0, Math.PI / 2], // left (-x)
    [0, -s, 0, -Math.PI / 2, 0], // down
  ];
  const state = { loaded: false, failed: false };
  const loads = faces.map(
    (url, i) =>
      new Promise<void>((res) => {
        const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
        mats.push(mat);
        const [x, y, z, rx, ry] = place[i];
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * s + 0.02, 2 * s + 0.02), mat);
        mesh.position.set(x, y, z);
        mesh.rotation.set(rx, ry, 0, 'YXZ');
        mesh.renderOrder = 1000;
        mesh.frustumCulled = false;
        group.add(mesh);
        loader.load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 8;
            mat.map = t;
            mat.needsUpdate = true;
            res();
          },
          undefined,
          () => {
            state.failed = true;
            res();
          },
        );
      }),
  );
  group.visible = false;
  Promise.all(loads).then(() => (state.loaded = !state.failed));
  return { group, mats, state };
}

// Where the camera waits beside a home while its tour loads: rooftop height, a house or two away.
const HOVER_UP = 24;
const HOVER_R = 58;

const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

export default function SkyView({
  lookAt,
  pins,
  activeSid,
  flyToSid,
  enterSid,
  onDescended,
  onPick,
  onHover,
  snapshotKey,
  onLoadState,
  dive = false,
  entry = null,
}: {
  // Reports the full-city preload and whether the first view has sharpened, so a page can hold
  // a loading screen until the whole city is local and the view is crystal clear. Passing it
  // also starts the preload at once, at full speed (the user is waiting for it).
  onLoadState?: (s: { done: number; total: number; sharp: boolean }) => void;
  lookAt: LatLon | null; // overview target (the middle of the search results)
  snapshotKey?: string; // remembers the last idle view (picture + camera) per search
  pins: SkyPin[];
  activeSid: string | null;
  flyToSid: string | null;
  enterSid: string | null; // descend into this home
  dive?: boolean; // the interior is ready: push the camera into the house while the page crossfades
  entry?: Entry | null; // the 360° photo where the tour opens: the flight ends inside it
  onDescended?: () => void;
  onPick: (sid: string) => void;
  onHover: (sid: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<Map<string, HTMLButtonElement>>(new Map());
  const api = useRef<{
    positionOf: (sid: string) => THREE.Vector3 | null;
    groundOf: (sid: string) => THREE.Vector3 | null;
    groundAt: (p: LatLon) => THREE.Vector3;
    fly: (target: THREE.Vector3, offset: THREE.Vector3) => void;
    descend: (ground: THREE.Vector3, done: () => void) => void;
    dive: () => void;
    prepareEntry: (e: Entry) => void;
    leave: () => void;
  } | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const enterRef = useRef(enterSid);
  enterRef.current = enterSid;
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const doneRef = useRef(onDescended);
  doneRef.current = onDescended;
  const [status, setStatus] = useState('Loading the 3D city…');
  // Instant start: the last idle view for this search, shown as a picture while the live city
  // rebuilds behind it (from cache that still takes a few seconds of decoding).
  const snapKey = `furniche-sky-snap2:${snapshotKey ?? ''}`; // v2: daylight look
  const [poster, setPoster] = useState<string | null>(null);
  const [posterGone, setPosterGone] = useState(false);
  const restored = useRef(false);
  const [preload, setPreload] = useState<{ done: number; total: number } | null>(null);
  const preloadSignal = useRef({ paused: false, stopped: false });
  // Give way to the tour while descending into a home.
  preloadSignal.current.paused = !!enterSid;

  const loadStateRef = useRef(onLoadState);
  loadStateRef.current = onLoadState;
  const loadState = useRef({ done: 0, total: 0, sharp: false });
  const report = (p: Partial<{ done: number; total: number; sharp: boolean }>) => {
    Object.assign(loadState.current, p);
    loadStateRef.current?.({ ...loadState.current });
  };

  useEffect(() => {
    const signal = preloadSignal.current;
    signal.stopped = false;
    let last = 0;
    const waiting = !!loadStateRef.current;
    // In the background, start once the first view has had the network to itself; behind a
    // loading screen, start straight away with more requests in flight.
    const t = setTimeout(
      () => {
        preloadCity(
          signal,
          (done, total) => {
            const now = performance.now();
            if (done === total || now - last > 250) {
              last = now;
              setPreload({ done, total });
              report({ done, total });
            }
          },
          waiting ? 16 : 6,
        ).catch(() => report({ done: 1, total: 1 })); // no Cache Storage: don't hold the page
      },
      waiting ? 0 : 2500,
    );
    return () => {
      clearTimeout(t);
      signal.stopped = true;
    };
  }, []);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    // Photo textures shown as captured: no tone mapping to wash them out.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = HAZE;
    scene.fog = new THREE.Fog(HAZE, 2600, 8800);
    const dome = skyDome();
    dome.scale.setScalar(8500);
    scene.add(dome);

    // A short far plane keeps the streamer from fetching the whole metro; fog hides the edge.
    const camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 2, 9000);
    camera.position.set(0, 900, 1300);
    camera.lookAt(0, 0, 0);
    try {
      const snap = JSON.parse(localStorage.getItem(snapKey) ?? 'null') as { img: string; pos: number[]; quat: number[] } | null;
      if (snap?.img) {
        camera.position.fromArray(snap.pos);
        camera.quaternion.fromArray(snap.quat);
        restored.current = true;
        setPoster(snap.img);
      }
    } catch {
      /* no snapshot */
    }

    // Once tiles come from the cache, decoding (Draco meshes, KTX2 textures) is the bottleneck,
    // so give each decoder a worker per core instead of the default handful.
    const workers = Math.max(4, Math.min(12, navigator.hardwareConcurrency || 4));
    const draco = new DRACOLoader().setDecoderPath('/decoders/draco/');
    draco.setWorkerLimit(workers);
    const ktx = new KTX2Loader().setTranscoderPath('/decoders/basis/').setWorkerLimit(workers).detectSupport(renderer);
    const tiles = new TilesRenderer(TILESET);
    tiles.registerPlugin(new BrowserTileCache());
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx }));
    tiles.registerPlugin(new PhotoMaterials(Math.min(16, renderer.capabilities.getMaxAnisotropy())));
    // Sharper tiles fade in over the coarse ones instead of popping.
    tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 350, maximumFadeOutTiles: 80 }));
    // Put downtown at the origin with +Y up, so the city reads like a normal scene.
    tiles.registerPlugin(new ReorientationPlugin({ lat: ORIGIN.lat * D2R, lon: ORIGIN.lon * D2R, height: GROUND_H, up: '+y', recenter: true }));
    // Vexcel nests a tileset per level with large textures; a coarser target and a bigger byte
    // budget stop the cache filling with distant tiles, and active tiles stay on screen while
    // their children stream in. Tiles are served from a disk cache, so fetch more at once.
    // Coarse first so the city appears quickly, then sharpen once the first wave has loaded.
    tiles.errorTarget = 40;
    let loadWaves = 0;
    // "Sharp" = a load wave has finished at the final level of detail. If the finer target needs
    // no new tiles there is no further wave, so fall back after a few seconds.
    let sharpTimer: ReturnType<typeof setTimeout> | undefined;
    tiles.addEventListener('tiles-load-end', () => {
      loadWaves += 1;
      if (tiles.errorTarget <= 14 && !loadState.current.sharp) report({ sharp: true });
      // Then a finer level of detail: crisper facades and roofs (they fade in, see above).
      if (tiles.errorTarget > 14) {
        tiles.errorTarget = loadWaves === 1 ? 20 : 14;
        if (tiles.errorTarget === 14) sharpTimer = setTimeout(() => report({ sharp: true }), 5000);
      }
      // The picture only bridges the first load; with everything cached there may be only one
      // load wave, so hand over to the live city after the first one.
      setTimeout(() => setPosterGone(true), 400);
    });
    tiles.displayActiveTiles = true;
    tiles.lruCache.maxBytesSize = 1.2e9;
    tiles.lruCache.minBytesSize = 0.9e9;
    tiles.downloadQueue.maxJobsPerOrigin = 48;
    tiles.parseQueue.maxJobs = workers * 2;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    scene.add(tiles.group);
    let loaded = 0;
    tiles.addEventListener('load-model', () => {
      loaded += 1;
      if (loaded === 1) setStatus('');
    });
    tiles.addEventListener('load-error', () => setStatus('Some 3D tiles failed to load.'));

    const controls = new EnvironmentControls(scene, camera, renderer.domElement);
    controls.enableDamping = true;
    // Snapshot bookkeeping: remember when the camera last moved.
    let lastMove = performance.now();
    let dirty = !restored.current;
    controls.addEventListener('change', () => {
      lastMove = performance.now();
      dirty = true;
      setPosterGone(true); // the camera moved: the saved picture no longer matches
    });
    const posterTimeout = setTimeout(() => setPosterGone(true), 8000);
    controls.enableFlight = true;
    controls.flightSpeed = 40;
    controls.minAltitude = 0.05;
    controls.maxAltitude = 0.48 * Math.PI;
    controls.maxDistance = 9000;

    const toScene = (p: LatLon, h: number) =>
      tiles.ellipsoid.getCartographicToPosition(p.lat * D2R, p.lon * D2R, h, new THREE.Vector3()).applyMatrix4(tiles.group.matrixWorld);

    // Listing positions in scene space (ellipsoid → reoriented group frame).
    const stems = new THREE.Group();
    scene.add(stems);
    const stemMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
    const top = new Map<string, THREE.Vector3>();
    const ground = new Map<string, THREE.Vector3>();
    function rebuildPins() {
      stems.clear();
      top.clear();
      ground.clear();
      tiles.group.updateMatrixWorld(true);
      for (const p of pinsRef.current) {
        const base = toScene(p, GROUND_H);
        const head = toScene(p, GROUND_H + PIN_H);
        top.set(p.sid, head);
        ground.set(p.sid, base);
        stems.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, head]), stemMat));
      }
    }
    let pinsKey = '';

    let flight: Flight | null = null;
    let pano: ReturnType<typeof panoRoom> | null = null; // the real room, see panoRoom
    let bridgeAt: THREE.Vector3 | null = null; // where it stands
    let inside = false; // the camera has arrived in it
    let intoRoom: (() => Flight) | null = null; // the final leg, once a descent is under way
    let hoverAround: THREE.Vector3 | null = null; // slow orbit after a descent
    let orbit = 0;
    const look = new THREE.Vector3();
    const currentLook = () => camera.position.clone().add(camera.getWorldDirection(look).multiplyScalar(300));
    const leg = (to: THREE.Vector3, lookTo: THREE.Vector3, dur: number, fovTo = camera.fov, extra: Partial<Flight> = {}): Flight => ({
      from: camera.position.clone(),
      to,
      lookFrom: currentLook(),
      lookTo,
      fovFrom: camera.fov,
      fovTo,
      dur,
      t: 0,
      ...extra,
    });

    api.current = {
      positionOf: (sid) => top.get(sid) ?? null,
      groundOf: (sid) => ground.get(sid) ?? null,
      groundAt: (p) => {
        tiles.group.updateMatrixWorld(true);
        return toScene(p, GROUND_H);
      },
      fly: (target, offset) => {
        setPosterGone(true);
        hoverAround = null;
        controls.enabled = false;
        flight = leg(target.clone().add(offset), target.clone(), 1.6, 55);
      },
      // Sky → house in one move: glide in over the home, drop to the street in front of it, then
      // fly straight through the front wall into the real room (the 360° photo where the tour
      // opens), which fades in around the camera. The tour crossfades in from that same view.
      // Without the photo it falls back to drifting beside the house while the tour loads.
      descend: (g, done) => {
        setPosterGone(true);
        hoverAround = null;
        controls.enabled = false;
        const roof = g.clone().add(new THREE.Vector3(0, 5, 0));
        const eye = () => g.clone().add(new THREE.Vector3(0, entryRef.current?.eyeHeight ?? 1.5, 0));
        // The last leg: straight through the front into the room photo.
        intoRoom = () => {
          intoRoom = null;
          hoverAround = null;
          pano!.group.position.copy(eye());
          pano!.group.visible = true;
          bridgeAt = eye();
          return leg(eye(), eye().add(new THREE.Vector3(0, 0, -50)), 1.6, 76, {
            done: () => {
              inside = true;
              done();
            },
          });
        };
        // `done` belongs on the last leg: a leg with `next` hands over instead of finishing.
        flight = leg(g.clone().add(new THREE.Vector3(0, 200, 280)), g.clone(), 1.5, 50, {
          // Rooftop height a few houses back, facing the home; then swoop down into it.
          next: () =>
            leg(eye().add(new THREE.Vector3(0, 14, 32)), eye(), 1.7, 55, {
              next: () => {
                if (pano?.state.loaded && intoRoom) return intoRoom();
                // The photo isn't here yet: drift beside the house and go in when it arrives
                // (see the frame loop). If it never comes, the tour simply crossfades in.
                hoverAround = roof;
                orbit = 0;
                done(); // let the page crossfade to the tour if that is ready first
                return null as unknown as Flight;
              },
            }),
        });
      },
      leave: () => {
        if (pano) scene.remove(pano.group);
        pano = null;
        bridgeAt = null;
        inside = false;
        intoRoom = null;
        hoverAround = null;
        controls.enabled = true;
      },
      prepareEntry: (e) => {
        if (pano) scene.remove(pano.group);
        pano = panoRoom(e.faces);
        scene.add(pano.group);
      },
      // Into the house: close the last few metres to the front wall and narrow the view, timed
      // with the page's crossfade into the panorama.
      dive: () => {
        if (inside) return; // already standing where the tour opens: the page just crossfades
        const target = hoverAround ?? currentLook();
        hoverAround = null;
        controls.enabled = false;
        const toward = target.clone().sub(camera.position);
        const into = camera.position.clone().addScaledVector(toward, 0.85);
        into.y = Math.max(target.y - 2, into.y);
        flight = leg(into, target.clone().addScaledVector(toward.normalize(), 30), 1.3, 34);
      },
    };

    const v = new THREE.Vector3();
    const clock = new THREE.Clock();
    let raf = 0;
    let stillFrames = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.1);
      // Inside the room photo nothing on screen changes, so after a few frames stop drawing (the
      // canvas keeps its last frame). That leaves the GPU and main thread to the Matterport tour
      // loading underneath, which otherwise can stall without ever landing on a pano.
      if (inside && !flight) {
        if (++stillFrames > 3) return;
      } else stillFrames = 0;
      if (flight) {
        const f: Flight = flight;
        f.t = Math.min(1, f.t + dt / f.dur);
        const e = ease(f.t);
        camera.position.lerpVectors(f.from, f.to, e);
        camera.fov = THREE.MathUtils.lerp(f.fovFrom, f.fovTo, e);
        camera.updateProjectionMatrix();
        camera.lookAt(look.lerpVectors(f.lookFrom, f.lookTo, e));
        if (f.t === 1) {
          flight = f.next ? f.next() : null;
          if (!flight) {
            f.done?.();
            if (!hoverAround && !inside) controls.enabled = true; // inside the house the camera stays put
          }
        }
      } else if (inside) {
        // Standing in the room photo until the tour crossfades in: hold still (the city's
        // controls would lift the camera back above the ground and out of the room).
      } else if (hoverAround && intoRoom && pano?.state.loaded) {
        flight = intoRoom(); // the room photo arrived while waiting beside the house
      } else if (hoverAround) {
        // Slow drift around the house at rooftop height while the interior loads, so nothing
        // ever freezes and the street around it stays in view.
        orbit += dt * 0.06;
        camera.position.set(hoverAround.x + Math.sin(orbit) * HOVER_R, hoverAround.y - 5 + HOVER_UP, hoverAround.z + Math.cos(orbit) * HOVER_R);
        camera.lookAt(hoverAround);
      } else {
        controls.update(dt);
      }
      camera.updateMatrixWorld();
      dome.position.copy(camera.position);
      // The room photo fades in as the camera closes the last stretch to the front door, and
      // fully surrounds it once inside: the city (and the mesh's walls) disappear behind it.
      if (pano && bridgeAt) {
        const dist = camera.position.distanceTo(bridgeAt);
        const o = inside ? 1 : THREE.MathUtils.clamp((24 - dist) / 18, 0, 1);
        for (const m of pano.mats) m.opacity = o;
      }
      tiles.update();

      const key = pinsRef.current.map((p) => p.sid).join();
      if (key !== pinsKey && tiles.root) {
        pinsKey = key;
        rebuildPins();
      }
      stems.visible = !enterRef.current;
      renderer.render(scene, camera);

      // Once the view has been still for a moment with the sharp tiles in, save a small picture
      // of it with the camera pose. Drawn straight after render, while the buffer is valid.
      if (flight || hoverAround) {
        lastMove = performance.now();
        dirty = true;
      } else if (dirty && loadWaves >= 1 && !enterRef.current && performance.now() - lastMove > 1500) {
        dirty = false;
        try {
          const c = document.createElement('canvas');
          c.width = 960;
          c.height = Math.round((960 * el.clientHeight) / Math.max(el.clientWidth, 1));
          c.getContext('2d')!.drawImage(renderer.domElement, 0, 0, c.width, c.height);
          localStorage.setItem(snapKey, JSON.stringify({ img: c.toDataURL('image/jpeg', 0.72), pos: camera.position.toArray(), quat: camera.quaternion.toArray() }));
        } catch {
          /* storage full or unavailable: skip */
        }
      }

      // Keep the HTML pins over their 3D anchors; while descending only the chosen home shows.
      const w = el.clientWidth;
      const h = el.clientHeight;
      for (const [sid, node] of labels.current) {
        const p = top.get(sid);
        if (!p || (enterRef.current && (sid !== enterRef.current || bridgeAt))) {
          node.style.display = 'none';
          continue;
        }
        v.copy(p).project(camera);
        const dist = camera.position.distanceTo(p);
        if (v.z > 1 || dist > 9000) {
          node.style.display = 'none';
          continue;
        }
        node.style.display = '';
        node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        node.style.zIndex = String(100000 - Math.round(dist));
      }
    };
    loop();

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      tiles.setResolutionFromRenderer(camera, renderer);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      clearTimeout(posterTimeout);
      clearTimeout(sharpTimer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose?.();
      tiles.dispose();
      draco.dispose();
      ktx.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, []);

  // Overview: fly to the middle of the results once they arrive.
  useEffect(() => {
    if (!lookAt || enterSid) return;
    // Starting from a remembered view: stay there instead of flying to the overview.
    if (restored.current) {
      restored.current = false;
      return;
    }
    let tries = 0;
    const go = () => {
      const a = api.current;
      if (!a) return;
      a.fly(a.groundAt(lookAt), new THREE.Vector3(0, 900, 1300));
    };
    const id = setInterval(() => {
      tries += 1;
      if (api.current || tries > 40) {
        clearInterval(id);
        go();
      }
    }, 100);
    return () => clearInterval(id);
  }, [lookAt?.lat, lookAt?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flyToSid || enterSid) return;
    const p = api.current?.positionOf(flyToSid);
    if (p) api.current!.fly(p, new THREE.Vector3(0, 380, 520));
  }, [flyToSid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dive && enterSid) api.current?.dive();
  }, [dive, enterSid]);

  // Start loading the room photo as soon as it is known (the flight takes a few seconds).
  useEffect(() => {
    if (entry?.faces?.length === 6) api.current?.prepareEntry(entry);
  }, [entry]);
  useEffect(() => {
    if (!enterSid) api.current?.leave();
  }, [enterSid]);

  useEffect(() => {
    if (!enterSid) return;
    const g = api.current?.groundOf(enterSid);
    if (g) api.current!.descend(g, () => doneRef.current?.());
    else doneRef.current?.();
  }, [enterSid]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" />
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
          style={{ opacity: posterGone ? 0 : 1 }}
        />
      )}
      <div className="pointer-events-none absolute inset-0">
        {pins.map((p) => (
          <button
            key={p.sid}
            ref={(node) => {
              if (node) labels.current.set(p.sid, node);
              else labels.current.delete(p.sid);
            }}
            onClick={() => onPick(p.sid)}
            onMouseEnter={() => onHover(p.sid)}
            onMouseLeave={() => onHover(null)}
            className="pointer-events-auto absolute left-0 top-0"
            style={{ display: 'none' }}
          >
            <span className={`fn-pin${p.sid === activeSid || p.sid === enterSid ? ' is-active' : ''}`}>
              <span>{p.label}</span>
            </span>
          </button>
        ))}
      </div>
      {preload && !enterSid && !onLoadState && preload.done < preload.total && (
        <div className="pointer-events-none absolute right-4 top-[4.75rem] z-10 w-56 rounded-xl bg-paper/85 px-3 py-2 text-[11px] text-muted backdrop-blur">
          <div className="flex justify-between">
            <span>Loading all of 3D Houston</span>
            <span>{Math.round((preload.done / preload.total) * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${(preload.done / preload.total) * 100}%` }} />
          </div>
        </div>
      )}
      {status && !poster && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper/85 px-4 py-2 text-sm text-muted">{status}</div>
      )}
      {!enterSid && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-xl bg-paper/80 px-3 py-2 text-[11px] leading-relaxed text-muted backdrop-blur">
          Drag to pan · right-drag to tilt · scroll to zoom
          <br />
          Fly with W A S D, Q/E down/up, Shift for speed
        </div>
      )}
    </div>
  );
}
