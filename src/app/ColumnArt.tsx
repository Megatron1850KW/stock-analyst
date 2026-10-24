/** Ilustraciones pequeñas de cada columna de la portada. Decorativas: no representan datos. */
export function ColumnArt({ index }: { index: number }) {
  const common = { viewBox: "0 0 160 64", className: "h-16 w-full", "aria-hidden": true, fill: "none" } as const;
  switch (index) {
    case 0:
      return (
        <svg {...common}>
          <path d="M4 50 C24 46 30 30 48 34 S72 52 88 38 S116 14 132 20 S150 12 156 8" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M4 50 C24 46 30 30 48 34 S72 52 88 38 S116 14 132 20 S150 12 156 8 V64 H4 Z" fill="var(--accent)" opacity=".1" />
        </svg>
      );
    case 1:
      return (
        <svg {...common}>
          <circle cx="32" cy="32" r="22" stroke="var(--sand)" strokeWidth="10" />
          <circle cx="32" cy="32" r="22" stroke="var(--accent)" strokeWidth="10" strokeDasharray="62 200" transform="rotate(-90 32 32)" />
          <circle cx="32" cy="32" r="22" stroke="var(--accent-soft)" strokeWidth="10" strokeDasharray="38 200" strokeDashoffset="-64" transform="rotate(-90 32 32)" />
          <rect x="70" y="18" width="80" height="6" rx="3" fill="var(--sand)" />
          <rect x="70" y="18" width="52" height="6" rx="3" fill="var(--accent)" />
          <rect x="70" y="30" width="80" height="6" rx="3" fill="var(--sand)" />
          <rect x="70" y="30" width="30" height="6" rx="3" fill="var(--accent-soft)" />
          <rect x="70" y="42" width="80" height="6" rx="3" fill="var(--sand)" />
          <rect x="70" y="42" width="64" height="6" rx="3" fill="var(--accent)" opacity=".6" />
        </svg>
      );
    case 2:
      return (
        <svg {...common} strokeLinecap="round">
          {[
            [12, 40, 52, 30, 58],
            [32, 34, 46, 26, 52],
            [52, 38, 48, 30, 56, true],
            [72, 26, 40, 18, 46],
            [92, 22, 34, 14, 40],
            [112, 28, 38, 20, 44, true],
            [132, 14, 28, 6, 34],
          ].map(([x, top, bottom, hi, lo, down]) => (
            <g key={x as number} stroke={down ? "var(--negative)" : "var(--positive)"} strokeWidth="2">
              <line x1={(x as number) + 5} y1={hi as number} x2={(x as number) + 5} y2={lo as number} />
              <rect x={x as number} y={top as number} width="10" height={(bottom as number) - (top as number)} rx="2" fill={down ? "none" : "var(--positive)"} />
            </g>
          ))}
          <path d="M8 48 C40 44 80 34 152 16" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          {[
            [28, 34, 7, 0.35],
            [80, 30, 13, 1],
            [130, 36, 7, 0.35],
          ].map(([cx, cy, r, o]) => (
            <path
              key={cx}
              opacity={o}
              fill="var(--accent)"
              d={starPath(cx!, cy!, r!)}
            />
          ))}
        </svg>
      );
  }
}

function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r * 1.8 : r * 0.75;
    pts.push(`${(cx + rr * Math.cos(rad)).toFixed(1)} ${(cy + rr * Math.sin(rad)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}
