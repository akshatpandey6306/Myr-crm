import type { DistributionDatum } from './chart-types';

function point(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return [100 + radius * Math.cos(radians), 100 + radius * Math.sin(radians)] as const;
}

function petal(radius: number, start: number, end: number) {
  const a = point(radius, start);
  const b = point(radius, end);
  const large = end - start > 180 ? 1 : 0;
  return `M 100 100 L ${a[0]} ${a[1]} A ${radius} ${radius} 0 ${large} 1 ${b[0]} ${b[1]} Z`;
}

export default function NightingaleChart({ title, items }: { title: string; items: DistributionDatum[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maximum = Math.max(...items.map((item) => item.value), 0);
  const step = items.length ? 360 / items.length : 360;
  return <section className="module-chart-card" aria-label={title}><header><div><h2>{title}</h2><p>Each petal’s area reflects the number of activities</p></div><span className="chart-kind-label">NIGHTINGALE</span></header><div className="module-chart-body"><div className="nightingale-chart-wrap"><svg viewBox="0 0 200 200" role="img" aria-label={`${title}: ${items.map((item) => `${item.label}, ${item.value}`).join('; ')}`}>
    <circle cx="100" cy="100" r="75" fill="none" stroke="#ececf3" strokeWidth="1" />{items.map((item, index) => { const start = -90 + index * step + 2; const end = -90 + (index + 1) * step - 2; const radius = maximum ? 34 + Math.sqrt(item.value / maximum) * 39 : 0; return <path key={item.label} d={petal(radius, start, end)} fill={item.color} fillOpacity=".84" stroke="#fff" strokeWidth="2.5" />; })}<circle cx="100" cy="100" r="3" fill="#fff" />
  </svg></div><div className="module-chart-legend">{items.map((item) => <div className="module-chart-legend-row" key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.value}</b><small>{total ? `${((item.value / total) * 100).toFixed(0)}%` : '0%'}</small></div>)}</div></div></section>;
}
