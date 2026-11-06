"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

/**
 * A label drawn into a canvas texture and shown as a three.js sprite.
 * Used instead of drei's <Html>, which mounts a separate React root and
 * throws "Attempted to synchronously unmount a root" under React 19 in dev.
 * Client-only (it touches `document`), like the scenes that use it.
 */
export function TextSprite({
  text,
  color,
  active = false,
  px = 22,
  position,
}: {
  text: string;
  color: string;
  active?: boolean;
  /** On-screen label height in CSS pixels (constant regardless of depth). */
  px?: number;
  position: [number, number, number];
}) {
  const viewH = useThree((st) => st.size.height);
  const fov = useThree((st) => (st.camera as THREE.PerspectiveCamera).fov);
  const p11 = 1 / Math.tan((fov * Math.PI) / 360);
  const height = (2 * px) / (p11 * viewH);

  const { texture, aspect } = useMemo(() => {
    const k = 2; // render at 2x for crisp text
    const fontPx = 26 * k;
    const padX = 14 * k;
    const padY = 8 * k;
    const font = `500 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    const c = document.createElement("canvas");
    const g = c.getContext("2d")!;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + padX * 2;
    c.width = w;
    c.height = fontPx + padY * 2;
    g.font = font; // resizing a canvas resets its context state
    g.fillStyle = "rgba(5, 8, 16, 0.85)";
    g.strokeStyle = active ? color : `${color}77`;
    g.lineWidth = 2 * k;
    g.beginPath();
    g.roundRect(k, k, c.width - 2 * k, c.height - 2 * k, 6 * k);
    g.fill();
    g.stroke();
    g.fillStyle = active ? "#ffffff" : "#c3cde2";
    g.textBaseline = "middle";
    g.fillText(text, padX, c.height / 2 + k);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: c.width / c.height };
  }, [text, color, active]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite position={position} scale={[height * aspect, height, 1]} renderOrder={10} raycast={() => undefined}>
      <spriteMaterial map={texture} sizeAttenuation={false} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
