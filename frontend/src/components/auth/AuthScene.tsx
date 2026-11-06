"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useInView, useReducedMotion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mulberry32 } from "@/lib/utils";

const CYAN = new THREE.Color("#00cfff");
const BLUE = new THREE.Color("#2563ff");
const ICE = new THREE.Color("#a9d9ff");

/** Deterministic network: one bright core, shells of research nodes, short-range links. */
function useNetwork(count: number) {
  return useMemo(() => {
    const rnd = mulberry32(11);
    const pts: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)];
    for (let i = 1; i < count; i++) {
      const r = 1.3 + rnd() * 2.1;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      pts.push(new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.8, r * Math.sin(ph) * Math.sin(th)));
    }
    const links: [number, number][] = [];
    for (let i = 1; i < count; i++) {
      // each node links to the core or its nearest earlier neighbour, plus a few cross-links
      let best = 0, bd = pts[i].length();
      for (let j = 1; j < i; j++) {
        const d = pts[i].distanceTo(pts[j]);
        if (d < bd) { bd = d; best = j; }
      }
      links.push([best, i]);
      if (i % 4 === 0) links.push([0, i]);
    }
    const linePos = new Float32Array(links.length * 6);
    links.forEach(([a, b], i) => linePos.set([...pts[a].toArray(), ...pts[b].toArray()], i * 6));
    return { pts, links, linePos };
  }, [count]);
}

/** Soft round sprite so points render as glowing dots, not squares. */
function useDot() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.75)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
}

function Network({ count, animate }: { count: number; animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const flow = useRef<THREE.Points>(null);
  const { pts, links, linePos } = useNetwork(count);
  const nodePos = useMemo(() => new Float32Array(pts.flatMap((p) => p.toArray())), [pts]);
  const nodeCol = useMemo(() => {
    const c = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      const col = i === 0 ? ICE : CYAN.clone().lerp(BLUE, Math.min(1, p.length() / 3.4));
      c.set([col.r, col.g, col.b], i * 3);
    });
    return c;
  }, [pts]);
  const seeds = useMemo(() => {
    const rnd = mulberry32(5);
    return Array.from({ length: Math.min(40, links.length) }, (_, i) => ({ l: i % links.length, o: rnd(), s: 0.12 + rnd() * 0.18 }));
  }, [links]);
  const flowPos = useMemo(() => new Float32Array(seeds.length * 3), [seeds]);
  const mouse = useRef({ x: 0, y: 0 });
  const dot = useDot();

  useFrame(({ clock, pointer }, dt) => {
    const g = group.current;
    if (!g) return;
    mouse.current.x += (pointer.x - mouse.current.x) * Math.min(1, dt * 2.5);
    mouse.current.y += (pointer.y - mouse.current.y) * Math.min(1, dt * 2.5);
    g.rotation.y = clock.elapsedTime * 0.12 + mouse.current.x * 0.5;
    g.rotation.x = -mouse.current.y * 0.3;
    if (flow.current) {
      const t = clock.elapsedTime;
      seeds.forEach((s, i) => {
        const [a, b] = links[s.l];
        const u = (s.o + t * s.s) % 1;
        flowPos[i * 3] = pts[a].x + (pts[b].x - pts[a].x) * u;
        flowPos[i * 3 + 1] = pts[a].y + (pts[b].y - pts[a].y) * u;
        flowPos[i * 3 + 2] = pts[a].z + (pts[b].z - pts[a].z) * u;
      });
      (flow.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  });
  void animate;

  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePos, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#00cfff" transparent opacity={0.28} />
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePos, 3]} />
          <bufferAttribute attach="attributes-color" args={[nodeCol, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.3} map={dot} alphaTest={0.01} vertexColors sizeAttenuation transparent opacity={0.95} depthWrite={false} />
      </points>
      <points ref={flow}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[flowPos, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.2} map={dot} alphaTest={0.01} color="#ffffff" sizeAttenuation transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
      <mesh>
        <icosahedronGeometry args={[0.34, 2]} />
        <meshStandardMaterial color="#2563ff" emissive="#00cfff" emissiveIntensity={0.45} roughness={0.3} />
      </mesh>
    </group>
  );
}

export default function AuthScene() {
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap);
  const reduce = useReducedMotion();
  const [compact] = useState(() => window.innerWidth < 1280);
  const animate = !reduce && inView;
  return (
    <div ref={wrap} className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, -0.6, 7.6], fov: 45 }}
        gl={{ antialias: !compact, alpha: true }}
        frameloop={animate ? "always" : "demand"}
        aria-label="Animated 3D neural network"
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[4, 4, 6]} intensity={60} color="#a9d9ff" />
        <Network count={compact ? 34 : 54} animate={animate} />
      </Canvas>
    </div>
  );
}
