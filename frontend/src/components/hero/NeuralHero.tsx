"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { useInView, useReducedMotion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TextSprite } from "@/components/ui/TextSprite";
import { mulberry32 } from "@/lib/utils";

const MODULE_NODES = [
  { label: "Literature Retrieval", color: "#2563ff" },
  { label: "Metadata Extraction", color: "#00cfff" },
  { label: "Knowledge Graph", color: "#8b5cf6" },
  { label: "Novelty Analysis", color: "#2dd4bf" },
  { label: "ML Experimentation", color: "#60a5fa" },
  { label: "Model Validation", color: "#a78bfa" },
  { label: "Publication Planning", color: "#67e8f9" },
] as const;

type V3 = [number, number, number];

function fibonacciSphere(i: number, n: number, r: number): V3 {
  const y = 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(1 - y * y);
  const theta = Math.PI * (3 - Math.sqrt(5)) * i + 0.6;
  return [Math.cos(theta) * rad * r, y * r * 0.85, Math.sin(theta) * rad * r];
}

const POSITIONS: V3[] = MODULE_NODES.map((_, i) => fibonacciSphere(i, MODULE_NODES.length, 2.7));

/** Writes particle positions for time t. Particles travel core <-> module along each edge. */
function placeParticles(
  out: Float32Array,
  seeds: { edge: number; offset: number; speed: number; outward: boolean }[],
  t: number,
) {
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    let u = (s.offset + t * s.speed) % 1;
    if (!s.outward) u = 1 - u;
    const p = POSITIONS[s.edge];
    out[i * 3] = p[0] * u;
    out[i * 3 + 1] = p[1] * u;
    out[i * 3 + 2] = p[2] * u;
  }
}

/** Soft round sprite so points render as glowing dots instead of squares. */
function useDotTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);
}

function Flow({ count, animate }: { count: number; animate: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const dot = useDotTexture();
  const { seeds, positions, colors } = useMemo(() => {
    const rnd = mulberry32(7);
    const seeds = Array.from({ length: count }, (_, i) => ({
      edge: i % POSITIONS.length,
      offset: rnd(),
      speed: 0.1 + rnd() * 0.14,
      outward: i % 3 !== 0,
    }));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();
    seeds.forEach((s, i) => {
      c.set(MODULE_NODES[s.edge].color).lerp(new THREE.Color("#ffffff"), 0.35);
      colors.set([c.r, c.g, c.b], i * 3);
    });
    placeParticles(positions, seeds, 0);
    return { seeds, positions, colors };
  }, [count]);

  useFrame(({ clock }) => {
    if (!animate || !ref.current) return;
    const attr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    placeParticles(attr.array as Float32Array, seeds, clock.elapsedTime);
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.14}
        map={dot}
        alphaTest={0.01}
        vertexColors
        transparent
        opacity={0.95}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function Dust({ count, animate }: { count: number; animate: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const dot = useDotTexture();
  const positions = useMemo(() => {
    const rnd = mulberry32(21);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 4 + rnd() * 5;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      arr[i * 3] = r * Math.sin(ph) * Math.cos(th);
      arr[i * 3 + 1] = r * Math.cos(ph) * 0.7;
      arr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    return arr;
  }, [count]);

  useFrame((_, dt) => {
    if (animate && ref.current) ref.current.rotation.y += dt * 0.012;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} map={dot} alphaTest={0.01} color="#8fb4ff" transparent opacity={0.45} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function Core({ animate }: { animate: boolean }) {
  const shell = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, dt) => {
    if (!animate) return;
    if (shell.current) {
      shell.current.rotation.y += dt * 0.15;
      shell.current.rotation.x += dt * 0.07;
    }
    if (core.current) core.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.6) * 0.045);
  });
  return (
    <group>
      <mesh ref={core}>
        <sphereGeometry args={[0.36, 32, 32]} />
        <meshStandardMaterial color="#9fd0ff" emissive="#2563ff" emissiveIntensity={1.6} roughness={0.35} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.62, 32, 32]} />
        <meshBasicMaterial color="#2563ff" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide} />
      </mesh>
      <mesh ref={shell}>
        <icosahedronGeometry args={[0.78, 1]} />
        <meshBasicMaterial color="#00cfff" wireframe transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

function ModuleNode({
  position,
  color,
  label,
  active,
  compact,
  onHover,
  animate,
}: {
  position: V3;
  color: string;
  label: string;
  active: boolean;
  compact: boolean;
  onHover: (on: boolean) => void;
  animate: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (!mesh.current) return;
    const target = active ? 1.55 : 1;
    const s = mesh.current.scale.x;
    mesh.current.scale.setScalar(animate ? s + (target - s) * Math.min(1, dt * 9) : target);
  });
  return (
    <group position={position}>
      <mesh ref={mesh} onPointerOver={() => onHover(true)} onPointerOut={() => onHover(false)}>
        <sphereGeometry args={[0.15, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 2.2 : 1.1} roughness={0.4} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.24, 0.255, 40]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.9 : 0.35} side={THREE.DoubleSide} />
      </mesh>
      <TextSprite position={[0, 0.46, 0]} text={label.toUpperCase()} color={color} active={active} px={compact ? 18 : 22} />
    </group>
  );
}

function Scene({ animate, compact }: { animate: boolean; compact: boolean }) {
  const group = useRef<THREE.Group>(null);
  const size = useThree((s) => s.size);
  const [hovered, setHovered] = useState<number | null>(null);
  const wide = size.width >= 1024;

  useFrame(({ pointer }) => {
    const g = group.current;
    if (!g || !animate) return;
    const targetY = pointer.x * 0.5 + g.userData.spin;
    g.userData.spin += 0.0012;
    g.rotation.y += (targetY - g.rotation.y) * 0.04;
    g.rotation.x += (-pointer.y * 0.28 - g.rotation.x) * 0.04;
  });

  const edges = useMemo(() => {
    const ring: [V3, V3][] = POSITIONS.map((p, i) => [p, POSITIONS[(i + 1) % POSITIONS.length]]);
    return ring;
  }, []);

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={18} color="#2563ff" distance={9} />
      <group
        ref={(g) => {
          if (g && g.userData.spin === undefined) g.userData.spin = 0;
          group.current = g;
        }}
        position={[wide ? 2.2 : 0, 0, 0]}
        scale={compact ? 0.82 : wide ? 0.94 : 1}
      >
        <Core animate={animate} />
        {POSITIONS.map((p, i) => (
          <Line
            key={`spoke-${i}`}
            points={[[0, 0, 0], p]}
            color={MODULE_NODES[i].color}
            transparent
            opacity={hovered === i ? 0.8 : 0.32}
            lineWidth={hovered === i ? 1.6 : 1}
          />
        ))}
        {edges.map(([a, b], i) => (
          <Line key={`ring-${i}`} points={[a, b]} color="#6b7ea8" transparent opacity={0.13} lineWidth={1} />
        ))}
        {POSITIONS.map((p, i) => (
          <ModuleNode
            key={MODULE_NODES[i].label}
            position={p}
            color={MODULE_NODES[i].color}
            label={MODULE_NODES[i].label}
            active={hovered === i}
            compact={compact}
            animate={animate}
            onHover={(on) => setHovered(on ? i : null)}
          />
        ))}
        <Flow count={compact ? 24 : 56} animate={animate} />
        <Dust count={compact ? 90 : 320} animate={animate} />
      </group>
    </>
  );
}

export default function NeuralHero() {
  const wrapper = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(wrapper);
  // This component is client-only (loaded with ssr:false), so reading window here is safe.
  const [compact] = useState(() => window.innerWidth < 768);
  const animate = !reduce && inView;

  return (
    <div ref={wrapper} className="absolute inset-0">
      <Canvas
        dpr={[1, compact ? 1.5 : 2]}
        camera={{ position: [0, 0, 8.2], fov: 45 }}
        gl={{ antialias: !compact, alpha: true, powerPreference: "high-performance" }}
        frameloop={animate ? "always" : "demand"}
        aria-label="Interactive 3D network connecting ResearchForge's seven research modules"
      >
        <Scene animate={animate} compact={compact} />
      </Canvas>
    </div>
  );
}
