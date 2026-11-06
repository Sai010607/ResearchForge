/** One distinct line-art motif per module (decorative, hence aria-hidden). */
export function ModuleArt({ id, color }: { id: string; color: string }) {
  const svg = {
    viewBox: "0 0 240 120",
    fill: "none",
    stroke: color,
    strokeWidth: 1.2,
    className: "h-full w-full",
    "aria-hidden": true,
    preserveAspectRatio: "xMidYMid meet",
  } as const;

  switch (id) {
    case "literature":
      return (
        <svg {...svg}>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <rect key={i} x="12" y={12 + i * 15} width={[150, 120, 160, 100, 140, 90, 130][i]} height="4" rx="2" fill={color} stroke="none" opacity={i === 2 ? 0.75 : 0.18} />
          ))}
          <circle cx="188" cy="50" r="24" />
          <path d="M205 67l16 16" strokeLinecap="round" strokeWidth="2" />
          <rect className="scan" x="0" y="0" width="240" height="2" fill={color} stroke="none" opacity=".45" />
        </svg>
      );
    case "metadata":
      return (
        <svg {...svg}>
          <rect x="14" y="10" width="96" height="100" rx="5" />
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x="24" y={22 + i * 17} width={[60, 72, 48, 66, 54][i]} height="4" rx="2" fill={color} stroke="none" opacity=".25" />
          ))}
          {["AUTHORS", "DATASET", "METHOD"].map((t, i) => (
            <g key={t}>
              <path d={`M110 ${30 + i * 28}C128 ${30 + i * 28} 126 ${24 + i * 28} 140 ${24 + i * 28}`} opacity=".5" />
              <rect x="140" y={14 + i * 28} width="86" height="20" rx="10" />
              <text x="183" y={28 + i * 28} textAnchor="middle" fontSize="8" fill={color} stroke="none" fontFamily="monospace" letterSpacing="1">
                {t}
              </text>
            </g>
          ))}
        </svg>
      );
    case "graph":
      return (
        <svg {...svg}>
          {[[40, 70, 100, 30], [100, 30, 170, 60], [100, 30, 120, 95], [170, 60, 120, 95], [40, 70, 120, 95], [170, 60, 215, 25], [170, 60, 210, 98]].map(([a, b, c, d], i) => (
            <line key={i} x1={a} y1={b} x2={c} y2={d} opacity=".4" />
          ))}
          {[[40, 70, 6], [100, 30, 9], [170, 60, 7], [120, 95, 5], [215, 25, 4], [210, 98, 5]].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill={color} fillOpacity={i === 1 ? 0.9 : 0.35} />
          ))}
        </svg>
      );
    case "novelty":
      return (
        <svg {...svg}>
          <circle cx="92" cy="60" r="42" fill={color} fillOpacity=".06" />
          <circle cx="146" cy="60" r="42" fill={color} fillOpacity=".06" />
          <path d="M119 24a42 42 0 010 72 42 42 0 010-72z" fill={color} fillOpacity=".22" stroke="none" />
          <circle cx="188" cy="60" r="9" strokeDasharray="3 3" />
          <text x="188" y="64" textAnchor="middle" fontSize="11" fill={color} stroke="none">?</text>
        </svg>
      );
    case "mri":
      return (
        <svg {...svg}>
          {[52, 40, 28, 16].map((r, i) => (
            <ellipse key={r} cx="120" cy="60" rx={r * 1.35} ry={r} opacity={0.22 + i * 0.16} />
          ))}
          <path d="M120 10v100M70 60h100" opacity=".18" strokeDasharray="2 4" />
          <rect className="scan" x="40" y="0" width="160" height="2" fill={color} stroke="none" opacity=".5" />
        </svg>
      );
    case "experiments":
      return (
        <svg {...svg}>
          <path d="M14 104h212M14 104V12" opacity=".3" />
          <path d="M14 96C60 86 80 40 226 28" opacity=".9" />
          <path d="M14 98C60 92 90 60 226 46" opacity=".55" strokeDasharray="4 3" />
          <path d="M14 100C70 98 100 80 226 64" opacity=".35" />
        </svg>
      );
    case "validation":
      return (
        <svg {...svg}>
          <path d="M30 104h180M30 104V14" opacity=".3" />
          <path d="M30 104L210 14" strokeDasharray="3 4" opacity=".35" />
          <path d="M30 104C38 50 66 26 210 16V104z" fill={color} fillOpacity=".1" stroke="none" />
          <path d="M30 104C38 50 66 26 210 16" strokeWidth="1.8" />
        </svg>
      );
    default: // publication
      return (
        <svg {...svg}>
          <rect x="16" y="8" width="84" height="104" rx="4" />
          <rect x="26" y="20" width="64" height="6" rx="2" fill={color} stroke="none" opacity=".6" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <rect key={i} x="26" y={36 + i * 11} width={i % 3 === 2 ? 40 : 64} height="3" rx="1.5" fill={color} stroke="none" opacity=".2" />
          ))}
          {["Abstract", "Methods", "Results", "References"].map((t, i) => (
            <g key={t}>
              <rect x="124" y={18 + i * 24} width="12" height="12" rx="3" />
              {i < 2 && <path d={`M127 ${24 + i * 24}l3 3 5-6`} strokeWidth="1.6" strokeLinecap="round" />}
              <text x="146" y={28 + i * 24} fontSize="10" fill={color} stroke="none" fontFamily="monospace" opacity=".8">{t}</text>
            </g>
          ))}
        </svg>
      );
  }
}
