'use client';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Component, type ReactNode, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// The generated model on a turntable, lit like a studio; drag to look around. The arrow on the
// floor points where the piece faces when it is placed.

function Studio() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

// Scaled to fit a 1-unit box, standing on the floor, turned by `yaw`.
function Piece({ source, yaw }: { source: THREE.Object3D; yaw: number }) {
  const { holder, depth } = useMemo(() => {
    const copy = source.clone(true);
    copy.rotation.y = yaw;
    const holder = new THREE.Group().add(copy);
    const box = new THREE.Box3().setFromObject(holder, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    copy.position.x -= center.x;
    copy.position.z -= center.z;
    copy.position.y -= box.min.y;
    const k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
    holder.scale.setScalar(k);
    return { holder, depth: size.z * k };
  }, [source, yaw]);
  const arrow = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.06, 0);
    s.lineTo(0.06, 0);
    s.lineTo(0, 0.09);
    s.closePath();
    return new THREE.ShapeGeometry(s);
  }, []);
  return (
    <>
      {/* The model is shared with the room scene, so this view must never dispose it. */}
      <primitive object={holder} dispose={null} />
      <mesh geometry={arrow} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.003, depth / 2 + 0.06]}>
        <meshBasicMaterial color="#ff385c" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

// If the browser won't give the preview a WebGL context (too many 3D views open), say so instead
// of taking the editor down; the piece can still be placed in the room.
class NoGl extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="grid h-full place-items-center p-4 text-center text-[11px] text-muted">The 3D preview can&apos;t start in this browser right now. You can still drag the piece into the room.</div>;
  }
}

export default function ModelPreview(props: { source: THREE.Object3D; yaw: number }) {
  return (
    <NoGl>
      <Preview {...props} />
    </NoGl>
  );
}

function Preview({ source, yaw }: { source: THREE.Object3D; yaw: number }) {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [1.15, 0.95, 2.1], fov: 35 }} gl={{ antialias: true, alpha: true }}>
      <Studio />
      <directionalLight position={[2, 3, 2]} intensity={1.2} />
      <Piece source={source} yaw={yaw} />
      <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={2.4} blur={2.2} far={1.2} />
      {/* No zoom, so scrolling the panel over the preview still scrolls the panel. */}
      <OrbitControls makeDefault target={[0, 0.38, 0]} autoRotate autoRotateSpeed={1.4} enablePan={false} enableZoom={false} />
    </Canvas>
  );
}
