import type { DistributionDatum } from './chart-types';

function polar(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return [90 + radius * Math.cos(radians), 90 + radius * Math.sin(radians)] as const;
}

function arcBand(inner: number, outer: number, start: number, end: number) {
  const a = polar(outer, start);
  const b = polar(outer, end);
  const c = polar(inner, end);
  const d = polar(inner, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${a[0]} ${a[1]} A ${outer} ${outer} 0 ${large} 1 ${b[0]} ${b[1]} L ${c[0]} ${c[1]} A ${inner} ${inner} 0 ${large} 0 ${d[0]} ${d[1]} Z`;
}

export default function RadialBarChart({ title, items }: { title: string; items: DistributionDatum[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maximum = Math.max(...items.map((item) => item.value), 0);
  const step = items.length ? 360 / items.length : 360;
  const gap = Math.min(10, step * 0.12);
  return <section className="module-chart-card" aria-label={title}><header><div><h2>{title}</h2><p>Lead volume grouped by source</p></div><span className="chart-kind-label">RADIAL BARS</span></header><div className="module-chart-body"><div className="radial-chart-wrap"><svg viewBox="0 0 180 180" role="img" aria-label={`${title}: ${items.map((item) => `${item.label}, ${item.value}`).join('; ')}`}>
    {items.map((item, index) => { const start = -90 + index * step + gap / 2; const end = start + step - gap; return <g key={item.label}><path d={arcBand(45, 69, start, end)} fill="#eff0f7" /><path d={arcBand(45, maximum ? 45 + (item.value / maximum) * 24 : 45, start, end)} fill={item.color} /></g>; })}
  </svg><div className="radial-chart-center"><strong>{total}</strong><span>leads</span></div></div><div className="module-chart-legend">{items.map((item) => <div className="module-chart-legend-row" key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.value}</b><small>{total ? `${((item.value / total) * 100).toFixed(0)}%` : '0%'}</small></div>)}</div></div></section>;
}
