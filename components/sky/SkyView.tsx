'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { EnvironmentControls, TilesRenderer } from '3d-tiles-renderer/three';
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/three/plugins';

export type SkyPin = { sid: string; lat: number; lon: number; label: string };

const TILESET = '/api/vexcel/3d/tileset.json?collection=us-tx-houstonr2-2023&layer=3d-cities';
// Ground in Houston sits a little below the WGS84 ellipsoid (geoid offset ≈ -27 m, land ≈ +15 m).
const GROUND_H = -12;
const PIN_H = 70; // pins float this high above the ground
const D2R = THREE.MathUtils.DEG2RAD;

// A camera flight to a point: look at it from above and a little to the south.
type Flight = { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3; t: number };

export default function SkyView({
  center,
  pins,
  activeSid,
  flyToSid,
  onPick,
  onHover,
}: {
  center: { lat: number; lon: number };
  pins: SkyPin[];
  activeSid: string | null;
  flyToSid: string | null;
  onPick: (sid: string) => void;
  onHover: (sid: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<Map<string, HTMLButtonElement>>(new Map());
  const api = useRef<{ positionOf: (sid: string) => THREE.Vector3 | null; fly: (p: THREE.Vector3) => void } | null>(null);
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [status, setStatus] = useState('Loading the 3D city…');

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const sky = new THREE.Color('#1a2230');
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 3000, 8500);
    scene.add(new THREE.HemisphereLight('#ffffff', '#3a3a3a', 2.2));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    sun.position.set(1, 2, 1);
    scene.add(sun);

    // A short far plane keeps the streamer from fetching the whole metro; fog hides the edge.
    const camera = new THREE.PerspectiveCamera(55, el.clientWidth / el.clientHeight, 2, 9000);
    camera.position.set(0, 900, 1300);
    camera.lookAt(0, 0, 0);

    const draco = new DRACOLoader().setDecoderPath('/decoders/draco/');
    const ktx = new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(renderer);
    const tiles = new TilesRenderer(TILESET);
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx }));
    // Put the chosen spot at the origin with +Y up, so the city reads like a normal scene.
    tiles.registerPlugin(new ReorientationPlugin({ lat: center.lat * D2R, lon: center.lon * D2R, height: GROUND_H, up: '+y', recenter: true }));
    // Vexcel nests a tileset per level with large textures; a coarser target and a bigger byte
    // budget stop the cache filling with distant tiles, and active tiles stay on screen while
    // their children stream in.
    tiles.errorTarget = 20;
    tiles.displayActiveTiles = true;
    tiles.lruCache.maxBytesSize = 1.2e9;
    tiles.lruCache.minBytesSize = 0.9e9;
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
    controls.enableFlight = true;
    controls.flightSpeed = 40;
    controls.minAltitude = 0.05;
    controls.maxAltitude = 0.48 * Math.PI;
    controls.maxDistance = 9000;

    // Listing positions in scene space (ellipsoid → reoriented group frame).
    const stems = new THREE.Group();
    scene.add(stems);
    const stemMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
    const top = new Map<string, THREE.Vector3>();
    function rebuildPins() {
      stems.clear();
      top.clear();
      tiles.group.updateMatrixWorld(true);
      for (const p of pinsRef.current) {
        const base = tiles.ellipsoid.getCartographicToPosition(p.lat * D2R, p.lon * D2R, GROUND_H, new THREE.Vector3()).applyMatrix4(tiles.group.matrixWorld);
        const head = tiles.ellipsoid.getCartographicToPosition(p.lat * D2R, p.lon * D2R, GROUND_H + PIN_H, new THREE.Vector3()).applyMatrix4(tiles.group.matrixWorld);
        top.set(p.sid, head);
        stems.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([base, head]), stemMat));
      }
    }
    let pinsKey = '';

    let flight: Flight | null = null;
    const look = new THREE.Vector3();
    api.current = {
      positionOf: (sid) => top.get(sid) ?? null,
      fly: (p) => {
        camera.getWorldDirection(look);
        const lookFrom = camera.position.clone().add(look.multiplyScalar(600));
        const to = p.clone().add(new THREE.Vector3(0, 380, 520));
        flight = { from: camera.position.clone(), to, lookFrom, lookTo: p.clone(), t: 0 };
        controls.enabled = false;
      },
    };

    const v = new THREE.Vector3();
    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      if (flight) {
        flight.t = Math.min(1, flight.t + dt / 1.6);
        const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
        camera.position.lerpVectors(flight.from, flight.to, e);
        camera.lookAt(look.lerpVectors(flight.lookFrom, flight.lookTo, e));
        if (flight.t === 1) {
          flight = null;
          controls.enabled = true;
        }
      } else {
        controls.update(dt);
      }
      camera.updateMatrixWorld();
      tiles.update();

      const key = pinsRef.current.map((p) => p.sid).join();
      if (key !== pinsKey && tiles.root) {
        pinsKey = key;
        rebuildPins();
      }
      renderer.render(scene, camera);

      // Keep the HTML pins over their 3D anchors.
      const w = el.clientWidth;
      const h = el.clientHeight;
      for (const [sid, node] of labels.current) {
        const p = top.get(sid);
        if (!p) {
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
  }, [center.lat, center.lon]);

  useEffect(() => {
    if (!flyToSid) return;
    const p = api.current?.positionOf(flyToSid);
    if (p) api.current!.fly(p);
  }, [flyToSid]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" />
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
            <span className={`fn-pin${p.sid === activeSid ? ' is-active' : ''}`}>
              <span>{p.label}</span>
            </span>
          </button>
        ))}
      </div>
      {status && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper/85 px-4 py-2 text-sm text-muted">{status}</div>
      )}
      <div className="pointer-events-none absolute right-4 top-4 rounded-xl bg-paper/80 px-3 py-2 text-[11px] leading-relaxed text-muted backdrop-blur">
        Drag to pan · right-drag to tilt · scroll to zoom
        <br />
        Fly with W A S D, Q/E down/up, Shift for speed
      </div>
    </div>
  );
}
