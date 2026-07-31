import { useMemo, useState } from 'react';
import { PieChart } from 'lucide-react';

// A small, fixed palette cycled across departments — kept in the same
// family as the rest of the app's accent colors (brand blue plus a
// few complementary tones already used elsewhere: indigo for
// department tags in the directory table, amber for senior, green for
// active status) so this chart doesn't introduce a clashing palette.
const SLICE_COLORS = [
  { fill: '#1C7E9E', label: 'bg-brand-600' },   // brand-600
  { fill: '#F59E0B', label: 'bg-amber-500' },
  { fill: '#6366F1', label: 'bg-indigo-500' },
  { fill: '#10B981', label: 'bg-green-500' },
  { fill: '#EC4899', label: 'bg-pink-500' },
  { fill: '#8B5CF6', label: 'bg-violet-500' },
  { fill: '#F43F5E', label: 'bg-rose-500' },
];
const UNASSIGNED_COLOR = { fill: '#CECECE', label: 'bg-slate-300' };

/**
 * Small "attractive" donut chart for the Employee Status page —
 * headcount by department, hand-rolled SVG (matching the project's
 * existing convention of avoiding a charting library for one small
 * chart — see SpendTrendChart.jsx). Hover a slice to highlight it and
 * see the exact count; the department with no value set groups into
 * "Unassigned" rather than being silently dropped, since that's
 * itself useful HR signal (who still needs a department set).
 */
export default function DepartmentBreakdownChart({ users }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  const slices = useMemo(() => {
    const counts = new Map();
    for (const u of users) {
      const key = u.department || 'Unassigned';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = users.length || 1;
    let cumulative = 0;
    return entries.map(([name, count], i) => {
      const fraction = count / total;
      const startAngle = cumulative * 360;
      cumulative += fraction;
      const endAngle = cumulative * 360;
      const color = name === 'Unassigned' ? UNASSIGNED_COLOR : SLICE_COLORS[i % SLICE_COLORS.length];
      return { name, count, fraction, startAngle, endAngle, ...color };
    });
  }, [users]);

  const radius = 40;
  const cx = 50;
  const cy = 50;
  const innerRadius = 24;

  function arcPath(startAngle, endAngle) {
    const toRad = (deg) => ((deg - 90) * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(toRad(startAngle));
    const y1 = cy + radius * Math.sin(toRad(startAngle));
    const x2 = cx + radius * Math.cos(toRad(endAngle));
    const y2 = cy + radius * Math.sin(toRad(endAngle));
    const ix1 = cx + innerRadius * Math.cos(toRad(endAngle));
    const iy1 = cy + innerRadius * Math.sin(toRad(endAngle));
    const ix2 = cx + innerRadius * Math.cos(toRad(startAngle));
    const iy2 = cy + innerRadius * Math.sin(toRad(startAngle));
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
  }

  if (!users.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <PieChart size={13} className="text-brand-600" /> Headcount by department
      </div>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0">
          {slices.map((s, i) => (
            <path key={s.name} d={arcPath(s.startAngle, s.endAngle)}
              fill={s.fill}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.35}
              style={{ transition: 'opacity 0.15s ease' }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            />
          ))}
          <text x="50" y="47" textAnchor="middle" className="fill-slate-900 text-[16px] font-bold">
            {hoverIdx !== null ? slices[hoverIdx].count : users.length}
          </text>
          <text x="50" y="60" textAnchor="middle" className="fill-slate-400 text-[7px]">
            {hoverIdx !== null ? slices[hoverIdx].name.slice(0, 12) : 'people'}
          </text>
        </svg>
        <ul className="min-w-0 flex-1 space-y-1">
          {slices.slice(0, 4).map((s, i) => (
            <li key={s.name}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex cursor-default items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.label}`} />
              <span className="truncate text-slate-600">{s.name}</span>
              <span className="ml-auto shrink-0 font-medium text-slate-800">{s.count}</span>
            </li>
          ))}
          {slices.length > 4 && (
            <li className="text-[11px] text-slate-400">+{slices.length - 4} more</li>
          )}
        </ul>
      </div>
    </div>
  );
}
