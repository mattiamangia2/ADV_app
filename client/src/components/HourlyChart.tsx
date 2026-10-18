import { useState } from 'react';
import { hourLabel, nf } from '../lib/format';

/** 24-bar chart of people passing per hour (avg day). Hover a bar for the value. */
export default function HourlyChart({ values, highlight }: { values: number[]; highlight?: [number, number] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 110, padL = 32, padB = 18, padT = 8;
  const max = Math.max(1, ...values);
  const nice = niceMax(max);
  const bw = (W - padL) / 24;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / nice);
  const inRange = (h: number) => !highlight || (highlight[0] <= highlight[1] ? h >= highlight[0] && h <= highlight[1] : h >= highlight[0] || h <= highlight[1]);
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="People passing per hour of day">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 4} y={y(nice * f) + 3} fontSize={9} fill="var(--muted)" textAnchor="end">{compactInt(nice * f)}</text>
          </g>
        ))}
        {values.map((v, h) => {
          const x = padL + h * bw + 1;
          const top = y(v), base = y(0);
          const r = Math.min(2, (base - top) / 2);
          return (
            <g key={h} onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + h * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {v > 0 && (
                <path
                  d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - 2 - r} Q${x + bw - 2},${top} ${x + bw - 2},${top + r} V${base} Z`}
                  fill={inRange(h) ? 'var(--accent)' : 'var(--axis)'}
                  opacity={hover == null || hover === h ? 1 : 0.6}
                />
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke="var(--axis)" />
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={padL + h * bw + bw / 2} y={H - 4} fontSize={9} fill="var(--muted)" textAnchor="middle">{h}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${((padL + hover * bw) / W) * 100}%`, top: -8, transform: 'translate(-50%, -100%)' }}>
          {hourLabel(hover)}–{hourLabel((hover + 1) % 24)}: <b>{nf(values[hover])}</b> people
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((n) => n >= v) ?? v;
}
const compactInt = (v: number) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
