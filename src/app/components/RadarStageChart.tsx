type StageDatum = { label: string; value: number };

function point(centerX: number, centerY: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return [centerX + radius * Math.cos(radians), centerY + radius * Math.sin(radians)] as const;
}

function polygon(values: number[], centerX: number, centerY: number, radius: number, maxValue: number) {
  return values.map((value, index) => {
    const pointValue = point(centerX, centerY, radius * (maxValue ? value / maxValue : 0), -90 + index * (360 / values.length));
    return `${index ? 'L' : 'M'} ${pointValue[0]} ${pointValue[1]}`;
  }).join(' ') + ' Z';
}

export default function RadarStageChart({ items }: { items: StageDatum[] }) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const cx = 150;
  const cy = 112;
  const radius = 72;
  const values = items.map((item) => item.value);
  return <section className="deal-radar-panel"><div className="deal-radar-heading"><div><span className="chart-kind-label">RADAR VIEW</span><h3>Stage value profile</h3><p>Compare each stage against the highest-value stage.</p></div><span className="radar-total">${total.toLocaleString('en-US')}<small>sample pipeline</small></span></div><div className="deal-radar-layout"><svg className="deal-radar-chart" viewBox="0 0 300 230" role="img" aria-label={`Radar chart of deal value by stage: ${items.map((item) => `${item.label}, $${item.value.toLocaleString('en-US')}`).join('; ')}`}>
    <defs><linearGradient id="radar-area-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#8A6BE8" stopOpacity=".28" /><stop offset="100%" stopColor="#397CD8" stopOpacity=".12" /></linearGradient></defs>
    {[0.25, 0.5, 0.75, 1].map((scale) => <path key={scale} d={polygon(items.map(() => maxValue * scale), cx, cy, radius, maxValue)} fill="none" stroke="#e6e5ef" strokeWidth="1" />)}
    {items.map((item, index) => { const p = point(cx, cy, radius, -90 + index * (360 / items.length)); return <line key={item.label} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e6e5ef" strokeWidth="1" />; })}
    <path d={polygon(values, cx, cy, radius, maxValue)} fill="url(#radar-area-fill)" stroke="#7058d5" strokeWidth="2.5" strokeLinejoin="round" />
    {items.map((item, index) => { const p = point(cx, cy, radius * (maxValue ? item.value / maxValue : 0), -90 + index * (360 / items.length)); return <g key={item.label}><circle cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke="#7058d5" strokeWidth="2" /><text x={p[0]} y={p[1] - 8} textAnchor="middle" className="radar-point-value">${(item.value / 1000).toFixed(1)}k</text></g>; })}
    {items.map((item, index) => { const p = point(cx, cy, radius + 18, -90 + index * (360 / items.length)); return <text key={`label-${item.label}`} x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="central" className="radar-axis-label">{item.label}</text>; })}
  </svg><div className="radar-scale"><span><i /> Stage amount</span><span>Ring scale · 25 / 50 / 75 / 100%</span></div></div></section>;
}
