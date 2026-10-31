'use client';

import { useState } from 'react';

type PipelineDatum = { label: string; value: number; color: string };

const centerX = 80;
const centerY = 69;
const radiusX = 58;
const radiusY = 34;
const depth = 18;
const rounded = (value: number) => Math.round(value * 1000) / 1000;

function point(angle: number, yOffset = 0) {
  const radians = (angle * Math.PI) / 180;
  return [rounded(centerX + radiusX * Math.cos(radians)), rounded(centerY + radiusY * Math.sin(radians) + yOffset)] as const;
}

function slicePath(start: number, sweep: number) {
  const first = point(start);
  const last = point(start + sweep);
  if (sweep >= 359.9) {
    const halfway = point(start + 180);
    return `M ${centerX} ${centerY} L ${first[0]} ${first[1]} A ${radiusX} ${radiusY} 0 1 1 ${halfway[0]} ${halfway[1]} A ${radiusX} ${radiusY} 0 1 1 ${first[0]} ${first[1]} Z`;
  }
  return `M ${centerX} ${centerY} L ${first[0]} ${first[1]} A ${radiusX} ${radiusY} 0 ${sweep > 180 ? 1 : 0} 1 ${last[0]} ${last[1]} Z`;
}

function darken(hex: string) {
  const channels = hex.match(/[\da-f]{2}/gi)?.map((part) => Math.round(parseInt(part, 16) * 0.66));
  return channels?.length === 3 ? `rgb(${channels[0]} ${channels[1]} ${channels[2]})` : '#5f7366';
}

function lighten(hex: string) {
  const channels = hex.match(/[\da-f]{2}/gi)?.map((part) => Math.round(parseInt(part, 16) + (255 - parseInt(part, 16)) * 0.32));
  return channels?.length === 3 ? `rgb(${channels[0]} ${channels[1]} ${channels[2]})` : '#c4d8ee';
}

function sidePaths(items: PipelineDatum[], total: number) {
  let cumulative = 0;
  const paths: { key: string; d: string; color: string }[] = [];
  items.forEach((item, index) => {
    const start = -90 + (cumulative / total) * 360;
    const end = start + (item.value / total) * 360;
    for (let turn = -1; turn <= 2; turn += 1) {
      const visibleStart = Math.max(start, turn * 360);
      const visibleEnd = Math.min(end, turn * 360 + 180);
      if (visibleEnd - visibleStart < 0.01) continue;
      const a = visibleStart - turn * 360;
      const b = visibleEnd - turn * 360;
      const first = point(a);
      const last = point(b);
      const bottomLast = point(b, depth);
      const bottomFirst = point(a, depth);
      const sweep = b - a;
      paths.push({
        key: `${item.label}-side-${index}-${turn}`,
        d: `M ${first[0]} ${first[1]} A ${radiusX} ${radiusY} 0 ${sweep > 180 ? 1 : 0} 1 ${last[0]} ${last[1]} L ${bottomLast[0]} ${bottomLast[1]} A ${radiusX} ${radiusY} 0 ${sweep > 180 ? 1 : 0} 0 ${bottomFirst[0]} ${bottomFirst[1]} Z`,
        color: darken(item.color),
      });
    }
    cumulative += item.value;
  });
  return paths;
}

export default function PipelineDistributionChart({ items }: { items: PipelineDatum[] }) {
  const [view, setView] = useState<'pie' | 'bars'>('pie');
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maximum = Math.max(...items.map((item) => item.value), 0);
  const sides = total > 0 ? sidePaths(items, total) : [];
  let cumulative = 0;

  return <div className="pipeline-visualization">
    <div className="pipeline-visualization-heading"><span>VALUE BY DEAL STATUS</span><div className="view-toggle" aria-label="Deal value chart style"><button type="button" className={view === 'pie' ? 'active' : ''} aria-pressed={view === 'pie'} onClick={() => setView('pie')}>3D pie</button><button type="button" className={view === 'bars' ? 'active' : ''} aria-pressed={view === 'bars'} onClick={() => setView('bars')}>Bars</button></div></div>
    <div className={`pipeline-visualization-body${view === 'bars' ? ' is-bars' : ''}`}>
      {view === 'pie' ? <div className="pipeline-pie-wrap"><svg className="pipeline-pie-3d" viewBox="0 0 160 132" role="img" aria-label={`3D pie chart showing deal value by status: ${items.map((item) => `${item.label} ${total ? ((item.value / total) * 100).toFixed(1) : 0} percent`).join(', ')}`}>
        <defs>{items.map((item, index) => <linearGradient key={item.label} id={`pipeline-stage-gradient-${index}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={lighten(item.color)} /><stop offset="58%" stopColor={item.color} /><stop offset="100%" stopColor={darken(item.color)} /></linearGradient>)}</defs>
        {sides.map((side) => <path key={side.key} d={side.d} fill={side.color} />)}
        {items.map((item, index) => {
          const sweep = total ? (item.value / total) * 360 : 0;
          const start = -90 + (total ? (cumulative / total) * 360 : 0);
          const middle = start + sweep / 2;
          const lx = rounded(centerX + radiusX * 0.57 * Math.cos((middle * Math.PI) / 180));
          const ly = rounded(centerY + radiusY * 0.58 * Math.sin((middle * Math.PI) / 180) - 1);
          cumulative += item.value;
          return <g key={item.label}><path d={slicePath(start, sweep)} fill={`url(#pipeline-stage-gradient-${index})`} stroke="rgba(255,255,255,.9)" strokeWidth="1.7" /><text x={lx} y={ly} textAnchor="middle" dominantBaseline="central" className="pipeline-pie-percent">{total ? ((item.value / total) * 100).toFixed(0) : 0}%</text></g>;
        })}
      </svg><span className="pie-chart-caption">Share of total deal value</span></div> : <div className="pipeline-bars-view" role="img" aria-label={`Bar chart of deal value by status: ${items.map((item) => `${item.label} ${item.value.toLocaleString()}`).join(', ')}`}>
        <div className="pipeline-bars-axis"><span>STATUS</span><div><i>$0</i><i>{`$${Math.round(maximum / 20000) * 10}k`}</i><i>{`$${Math.round(maximum / 1000)}k`}</i></div><span>VALUE</span></div>
        {items.map((item) => <div className="pipeline-bar-row" key={item.label}><span>{item.label}<small>{total ? ((item.value / total) * 100).toFixed(1) : 0}%</small></span><div className="pipeline-bar-track"><i style={{ width: `${maximum ? (item.value / maximum) * 100 : 0}%`, background: item.color }} /></div><b>{`$${(item.value / 1000).toFixed(1)}k`}</b></div>)}
      </div>}
      <div className="pipeline-pie-legend">{items.map((item) => <div className="pipeline-pie-legend-row" key={item.label}><i style={{ backgroundColor: item.color }} /><span>{item.label}</span><b>{`$${(item.value / 1000).toFixed(1)}k`}</b><small>{total ? ((item.value / total) * 100).toFixed(1) : 0}%</small></div>)}</div>
    </div>
  </div>;
}
