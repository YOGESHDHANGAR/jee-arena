import { useState } from 'react';

/**
 * Small single-series bar chart for day-by-day counts (Admin → Growth).
 * One colour, thin bars with a 2px gap and rounded tops, a recessive baseline and max gridline,
 * and a hover tooltip per bar. Single series, so no legend: the title names it.
 */
export function BarChart({ title, data, valueKey, color = 'var(--accent)', fmt = (v) => v.toLocaleString('en-IN'), height = 120, totalLabel = 'total', maxLabel = (v) => `max ${v}/day` }) {
  const [hover, setHover] = useState(null);
  const W = 600;
  const H = height;
  const PAD_T = 14;
  const PAD_B = 18;
  const values = data.map((d) => d[valueKey] || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const slot = W / Math.max(1, data.length);
  const gap = Math.min(2, slot * 0.2);
  const bw = Math.max(1, slot - gap);
  const y = (v) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / max);
  const label = (day) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const bar = (x, top, w, bottom) => {
    const r = Math.min(4, w / 2, bottom - top);
    return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`;
  };
  const base = H - PAD_B;
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="card chart-card">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="muted small">{fmt(total)} {totalLabel}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={`${title}: ${fmt(total)} over ${data.length} days`} onMouseLeave={() => setHover(null)}>
          <line x1="0" x2={W} y1={y(max)} y2={y(max)} stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2={W} y1={base} y2={base} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const v = d[valueKey] || 0;
            const x = i * slot + gap / 2;
            return (
              <g key={d.day}>
                {v > 0 && <path d={bar(x, y(v), bw, base)} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />}
                {/* bigger-than-the-bar hit area */}
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        <div className="spread muted small" style={{ marginTop: 2 }}>
          <span>{label(data[0]?.day)}</span>
          <span>{maxLabel(fmt(max))}</span>
          <span>{label(data[data.length - 1]?.day)}</span>
        </div>
        {h && (
          <div className="chart-tip" style={{ left: `${Math.min(85, Math.max(5, ((hover + 0.5) / data.length) * 100))}%` }}>
            <b>{fmt(h[valueKey] || 0)}</b> <span className="muted">{label(h.day)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
