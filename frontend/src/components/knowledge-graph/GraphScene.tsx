"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import * as THREE from "three";
import { TextSprite } from "@/components/ui/TextSprite";
import { NODE_STYLE, type GEdge, type GNode, type GraphData, type NodeType, type Shape, type V3 } from "@/lib/graph";

export interface GraphSceneProps {
  data: GraphData;
  positions: Record<string, V3>;
  visibleTypes: Set<NodeType>;
  query: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  reduced: boolean;
  compact: boolean;
}

function Geometry({ shape }: { shape: Shape }) {
  switch (shape) {
    case "octahedron": return <octahedronGeometry args={[1]} />;
    case "icosahedron": return <icosahedronGeometry args={[1, 0]} />;
    case "box": return <boxGeometry args={[1.5, 1.5, 1.5]} />;
    case "tetrahedron": return <tetrahedronGeometry args={[1.1]} />;
    case "dodecahedron": return <dodecahedronGeometry args={[1]} />;
    case "cone": return <coneGeometry args={[0.9, 1.7, 5]} />;
    case "torus": return <torusGeometry args={[0.8, 0.3, 12, 24]} />;
    default: return <sphereGeometry args={[1, 24, 24]} />;
  }
}

/** Flags a three.js attribute for GPU re-upload (kept outside the component for the React compiler lint). */
function touch(a: THREE.BufferAttribute) {
  a.needsUpdate = true;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const BG = new THREE.Color("#050b18");

/** Light travelling along the selected node's connections, so relationships read as live links. */
function Pulses({ edges, positions, selectedId, reduced }: { edges: GEdge[]; positions: Record<string, V3>; selectedId: string | null; reduced: boolean }) {
  const ref = useRef<THREE.Points>(null);
  const touching = useMemo(
    () => (selectedId ? edges.filter((e) => e.source === selectedId || e.target === selectedId).slice(0, 48) : []),
    [edges, selectedId],
  );
  const buf = useMemo(() => new Float32Array(Math.max(1, touching.length) * 3), [touching]);
  useFrame(({ clock }) => {
    if (!ref.current || reduced) return;
    touching.forEach((e, i) => {
      const from = e.source === selectedId ? positions[e.source] : positions[e.target];
      const to = e.source === selectedId ? positions[e.target] : positions[e.source];
      const u = (clock.elapsedTime * 0.45 + i * 0.37) % 1;
      buf[i * 3] = from[0] + (to[0] - from[0]) * u;
      buf[i * 3 + 1] = from[1] + (to[1] - from[1]) * u;
      buf[i * 3 + 2] = from[2] + (to[2] - from[2]) * u;
    });
    (ref.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });
  if (!touching.length || reduced) return null;
  return (
    <points ref={ref} key={`${selectedId}-${touching.length}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buf, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.2} color="#a9d9ff" sizeAttenuation transparent opacity={0.95} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Scene({ data, positions, visibleTypes, query, selectedId, onSelect, reduced, compact }: GraphSceneProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const bodies = useRef(new Map<string, THREE.Group>());
  const progress = useRef(0);
  const lineRef = useRef<THREE.LineSegments>(null);
  const lastEdges = useRef<GEdge[] | null>(null);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const focus = useRef(new THREE.Vector3());

  const visible = useMemo(() => data.nodes.filter((n) => visibleTypes.has(n.type)), [data, visibleTypes]);
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const edges = useMemo(() => data.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)), [data, visibleIds]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [edges]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? new Set(visible.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)) : null),
    [visible, q],
  );
  const focusSet = useMemo(
    () => (selectedId && visibleIds.has(selectedId) ? new Set([selectedId, ...(adjacency.get(selectedId) ?? [])]) : null),
    [selectedId, visibleIds, adjacency],
  );
  const isDim = (id: string) => (focusSet ? !focusSet.has(id) : false) || (matches ? !matches.has(id) : false);

  // restart the "expansion" animation whenever a different graph is shown
  useEffect(() => {
    progress.current = reduced ? 1 : 0;
    lastEdges.current = null;
  }, [data, reduced]);

  // fly the orbit target toward the selected node
  useEffect(() => {
    const p = selectedId ? positions[selectedId] : undefined;
    focus.current.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0);
  }, [selectedId, positions]);

  // edge colours reflect selection / search state
  useEffect(() => {
    const geom = lineRef.current?.geometry;
    const attr = geom?.attributes.color as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const c1 = new THREE.Color(), c2 = new THREE.Color();
    edges.forEach((e, i) => {
      const a = data.nodes.find((n) => n.id === e.source)!, b = data.nodes.find((n) => n.id === e.target)!;
      c1.set(NODE_STYLE[a.type].color);
      c2.set(NODE_STYLE[b.type].color);
      const touching = selectedId !== null && (e.source === selectedId || e.target === selectedId);
      const dim = (focusSet ? !touching : false) || (matches ? !(matches.has(e.source) && matches.has(e.target)) : false);
      const f = touching ? 1 : dim ? 0.07 : 0.6;
      c1.lerpColors(BG, c1.clone(), f);
      c2.lerpColors(BG, c2.clone(), f);
      arr.set([c1.r, c1.g, c1.b, c2.r, c2.g, c2.b], i * 6);
    });
    attr.needsUpdate = true;
  }, [edges, data, selectedId, focusSet, matches]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  useFrame((_, dt) => {
    if (progress.current < 1) progress.current = Math.min(1, progress.current + dt / 1.4);
    const e = ease(progress.current);

    for (const n of visible) {
      const g = groups.current.get(n.id);
      const p = positions[n.id];
      if (!g || !p) continue;
      g.position.set(p[0] * e, p[1] * e, p[2] * e);
      const body = bodies.current.get(n.id);
      if (!body) continue;
      const base = NODE_STYLE[n.type].size;
      const target = base * e * (n.id === selectedId ? 1.5 : n.id === hovered ? 1.25 : 1);
      body.scale.setScalar(body.scale.x + (target - body.scale.x) * Math.min(1, dt * 10) || target);
    }

    const geom = lineRef.current?.geometry;
    const pos = geom?.attributes.position as THREE.BufferAttribute | undefined;
    if (pos && (progress.current < 1 || lastEdges.current !== edges)) {
      const arr = pos.array as Float32Array;
      edges.forEach((ed, i) => {
        const a = positions[ed.source], b = positions[ed.target];
        arr.set([a[0] * e, a[1] * e, a[2] * e, b[0] * e, b[1] * e, b[2] * e], i * 6);
      });
      touch(pos);
      lastEdges.current = edges;
    }

    const c = controls.current;
    if (c && !reduced) c.target.lerp(focus.current, Math.min(1, dt * 4));
    else if (c) c.target.copy(focus.current);
  });

  const edgeCount = edges.length;
  const edgePositions = useMemo(() => new Float32Array(edgeCount * 6), [edgeCount]);
  const edgeColors = useMemo(() => new Float32Array(edgeCount * 6), [edgeCount]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <pointLight position={[10, 10, 10]} intensity={140} />
      <pointLight position={[-10, -6, -8]} intensity={70} color="#00cfff" />

      <lineSegments ref={lineRef} key={`edges-${edgeCount}`}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[edgePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[edgeColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors />
      </lineSegments>

      <Pulses edges={edges} positions={positions} selectedId={selectedId} reduced={reduced} />

      {visible.map((n: GNode) => {
        const s = NODE_STYLE[n.type];
        const dim = isDim(n.id);
        const selected = n.id === selectedId;
        const showLabel = selected || n.id === hovered || (focusSet?.has(n.id) ?? false) || (matches?.has(n.id) ?? false);
        return (
          <group key={n.id} ref={(g) => { if (g) groups.current.set(n.id, g); else groups.current.delete(n.id); }}>
            <group ref={(b) => { if (b) bodies.current.set(n.id, b); else bodies.current.delete(n.id); }}>
            <mesh
              onClick={(ev) => { ev.stopPropagation(); onSelect(n.id); }}
              onPointerOver={(ev) => { ev.stopPropagation(); setHovered(n.id); }}
              onPointerOut={() => setHovered((h) => (h === n.id ? null : h))}
            >
              <Geometry shape={s.shape} />
              <meshStandardMaterial
                color={s.color}
                emissive={s.color}
                emissiveIntensity={selected ? 1.3 : 0.45}
                roughness={0.35}
                metalness={0.2}
                transparent
                opacity={dim ? 0.12 : 1}
              />
            </mesh>
            </group>
            {showLabel && (
              <TextSprite position={[0, NODE_STYLE[n.type].size * 2.3, 0]} text={n.label} color={s.color} active={selected} px={compact ? 18 : 24} />
            )}
          </group>
        );
      })}

      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={36}
        autoRotate={!reduced && !selectedId}
        autoRotateSpeed={0.45}
      />
    </>
  );
}

export default function GraphScene(props: GraphSceneProps) {
  return (
    <Canvas
      dpr={[1, props.compact ? 1.5 : 2]}
      camera={{ position: [0, 1.5, props.compact ? 25 : 15], fov: 50 }}
      gl={{ antialias: !props.compact, alpha: true }}
      onPointerMissed={() => props.onSelect(null)}
      aria-label="Interactive 3D knowledge graph. Drag to rotate, scroll to zoom, click a node to inspect it."
    >
      <Scene {...props} />
    </Canvas>
  );
}
