"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { PIPELINE } from "@/lib/modules";
import { cn, dayKey } from "@/lib/utils";
import type { Project } from "@/types/project";

/** Projects created per day over the last 14 days (local time). Real data only. */
export function ActivityChart({ projects, today }: { projects: Project[]; today: Date }) {
  const [hover, setHover] = useState<number | null>(null);
  const DAYS = 14;
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d;
  });
  const counts = new Map<string, number>();
  for (const p of projects) {
    const k = dayKey(new Date(p.created_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const values = days.map((d) => counts.get(dayKey(d)) ?? 0);
  const max = Math.max(1, ...values);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.ceil(max / 2), max];
  const W = 640, H = 220, L = 30, B = 28, T = 14;
  const plotW = W - L - 8, plotH = H - B - T;
  const slot = plotW / DAYS;
  const total = values.reduce((a, b) => a + b, 0);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div>
      <p className="mb-3 text-xs text-muted" aria-live="polite">
        {hover !== null ? (
          <>
            <span className="text-white">{fmt(days[hover])}</span> — {values[hover]} project{values[hover] === 1 ? "" : "s"} created
          </>
        ) : (
          `${total} project${total === 1 ? "" : "s"} created in the last 14 days`
        )}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Projects created per day, last 14 days. Total ${total}.`}>
        <defs>
          <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#00cfff" />
            <stop offset="1" stopColor="#2563ff" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = T + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={L} x2={W - 8} y1={y} y2={y} stroke="var(--line)" />
              <text x={L - 8} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="monospace">{t}</text>
            </g>
          );
        })}
        {days.map((d, i) => {
          const h = (values[i] / max) * plotH;
          const x = L + i * slot + slot * 0.2;
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={L + i * slot} y={T} width={slot} height={plotH} fill="transparent" />
              {values[i] > 0 ? (
                <motion.rect
                  x={x}
                  width={slot * 0.6}
                  y={T + plotH - h}
                  height={h}
                  rx="3"
                  fill="url(#bar)"
                  opacity={hover === null || hover === i ? 1 : 0.4}
                  style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                />
              ) : (
                <rect x={x} y={T + plotH - 2} width={slot * 0.6} height="2" rx="1" fill="var(--line-strong)" />
              )}
              {(i % 2 === (DAYS - 1) % 2 || i === DAYS - 1) && (
                <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize="9.5" fill="var(--muted)" fontFamily="monospace">
                  {fmt(d)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function BarList({ title, entries }: { title: string; entries: [string, number][] }) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div>
      <h3 className="mb-4 text-sm font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted">No data yet.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map(([label, n]) => (
            <li key={label}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-300">{label}</span>
                <span className="font-mono text-muted">{n}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-azure to-cyan"
                  initial={{ width: 0 }}
                  animate={{ width: `${(n / max) * 100}%` }}
                  transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Where projects sit in the lifecycle. Today every project stops at stage 1 because later modules are not built. */
export function PipelineProgress({ count }: { count: number }) {
  return (
    <div>
      <ol className="grid grid-cols-7 gap-1.5">
        {PIPELINE.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", s.live ? "bg-gradient-to-r from-azure to-cyan" : "bg-white/[0.06]")} />
            <p className="mt-2 truncate text-[10px] text-muted" title={s.label}>{s.label}</p>
            <p className={cn("font-mono text-sm", i === 0 && count > 0 ? "text-white" : "text-slate-600")}>{i === 0 ? count : 0}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted">
        Projects per stage. Stages after “Research Idea” unlock as their modules are built.
      </p>
    </div>
  );
}
