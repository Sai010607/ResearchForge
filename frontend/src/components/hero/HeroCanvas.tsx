"use client";

import dynamic from "next/dynamic";
import { WebGLBoundary } from "@/components/ui/WebGLBoundary";

/** Cheap static stand-in: shown while the 3D bundle loads, or if WebGL is unavailable. */
function HeroPlaceholder({ note }: { note?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center lg:justify-end lg:pr-[14%]" aria-hidden={!note}>
      <svg viewBox="-120 -120 240 240" className="h-[70%] max-h-[420px] opacity-70">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => {
          const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * 90;
          const y = Math.sin(a) * 90;
          return (
            <g key={i}>
              <line x1="0" y1="0" x2={x} y2={y} stroke="#2563ff" strokeOpacity=".35" />
              <circle cx={x} cy={y} r="5" fill="#00cfff" fillOpacity=".8" />
            </g>
          );
        })}
        <circle r="14" fill="#2563ff" />
      </svg>
      {note && <span className="absolute bottom-4 font-mono text-[10px] text-muted">{note}</span>}
    </div>
  );
}

const NeuralHero = dynamic(() => import("./NeuralHero"), {
  ssr: false,
  loading: () => <HeroPlaceholder />,
});

export function HeroCanvas() {
  return (
    <WebGLBoundary fallback={<HeroPlaceholder note="3D view unavailable (WebGL not supported)" />}>
      <NeuralHero />
    </WebGLBoundary>
  );
}
