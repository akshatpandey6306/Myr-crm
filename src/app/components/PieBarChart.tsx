import type { DistributionDatum } from './chart-types';

function slicePath(start: number, end: number) {
  const point = (angle: number) => [80 + 67 * Math.cos((angle * Math.PI) / 180), 80 + 67 * Math.sin((angle * Math.PI) / 180)];
  if (end - start >= 359.99) return 'M 80 13 A 67 67 0 1 1 79.99 13 Z';
  const [x1, y1] = point(start); const [x2, y2] = point(end);
  return `M 80 80 L ${x1} ${y1} A 67 67 0 ${end - start > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

export default function PieBarChart({ title, items, unit = 'records' }: { title: string; items: DistributionDatum[]; unit?: string }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maximum = Math.max(...items.map((item) => item.value), 0);
  let angle = -90;
  return <section className="pie-bar-chart panel" aria-label={`${title} pie and bar charts`}>
    <header><div><span className="chart-kind-label">WORKSPACE ANALYTICS</span><h2>{title}</h2><p>Compare category mix and volume.</p></div><strong>{total.toLocaleString()}<small> {unit}</small></strong></header>
    <div className="pie-bar-chart-grid">
      <div className="pie-bar-visual"><h3>Share</h3><div className="pie-bar-pie-wrap"><svg viewBox="0 0 160 160" role="img" aria-label={`${title} distribution: ${items.map((item) => `${item.label} ${item.value}`).join(', ') || 'No data'}`}>
        {items.filter((item) => item.value > 0).map((item) => { const sweep = total ? (item.value / total) * 360 : 0; const path = slicePath(angle, angle + sweep); angle += sweep; return <path key={item.label} d={path} fill={item.color} stroke="white" strokeWidth="2" />; })}
        {total === 0 && <circle cx="80" cy="80" r="67" fill="#eef0f3" />}
        <circle cx="80" cy="80" r="39" fill="white" /><text x="80" y="77" textAnchor="middle" className="pie-bar-total">{total}</text><text x="80" y="94" textAnchor="middle" className="pie-bar-unit">{unit}</text>
      </svg></div></div>
      <div className="pie-bar-visual"><h3>Count by category</h3><div className="pie-bar-rows" role="img" aria-label={`${title} bar chart: ${items.map((item) => `${item.label} ${item.value}`).join(', ') || 'No data'}`}>
        {items.map((item) => <div className="pie-bar-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${maximum ? Math.max(item.value ? 3 : 0, (item.value / maximum) * 100) : 0}%`, background: item.color }} /></div><b>{item.value}</b></div>)}
        {!items.length && <p className="pie-bar-empty">No records to chart yet.</p>}
      </div></div>
    </div>
    <div className="pie-bar-legend">{items.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>
  </section>;
}
