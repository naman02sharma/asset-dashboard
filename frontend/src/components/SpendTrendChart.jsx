import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';
import MonthPurchasesModal from './MonthPurchasesModal.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(n);

/**
 * Small monthly spend bar chart for Order History — hand-rolled SVG
 * rather than pulling in a charting library, since it's the only
 * chart in the app (a dependency for one small bar chart isn't worth
 * it). Deliberately kept compact/card-sized rather than full-width.
 *
 * Hover a bar to see the exact amount spent that month (shown right
 * above the bar, not a slow native tooltip). Click a bar to open the
 * list of everything actually purchased that month — see
 * MonthPurchasesModal, which queries the same month-filtered data
 * this bar's total came from, so the numbers always match.
 */
export default function SpendTrendChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [openMonth, setOpenMonth] = useState(null); // { month, label } | null

  useEffect(() => {
    api.getSpendTrend(4)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-20 w-full max-w-xs items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-300">
        <Loader2 size={14} className="animate-spin" />
      </div>
    );
  }
  if (!data || data.length === 0) return null;

  const max = Math.max(1, ...data.map((d) => Number(d.total_spend)));
  const width = 260;
  const height = 56;
  const barGap = 8;
  const barWidth = (width - barGap * (data.length - 1)) / data.length;

  return (
    <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <TrendingUp size={12} className="text-brand-600" /> Spend trend
      </p>
      <svg viewBox={`0 0 ${width} ${height + 30}`} className="w-full" style={{ height: 'auto' }}>
        {data.map((d, i) => {
          const spend = Number(d.total_spend);
          const barHeight = spend > 0 ? Math.max(3, (spend / max) * height) : 2;
          const x = i * (barWidth + barGap);
          const y = height - barHeight;
          const hovered = hoverIdx === i;
          return (
            <g key={d.label}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              onClick={() => setOpenMonth({ month: d.month_start, label: d.label })}
              className="cursor-pointer"
            >
              {/* Wider invisible hit area so a thin bar is still easy to hover/click */}
              <rect x={x - 2} y={0} width={barWidth + 4} height={height + 14} fill="transparent" />
              {hovered && (
                <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" className="fill-brand-700 text-[10px] font-medium">
                  {currency(spend)}
                </text>
              )}
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={3}
                className={hovered ? 'fill-brand-600' : 'fill-brand-100'}
                style={{ transition: 'fill 0.15s ease' }} />
              <text x={x + barWidth / 2} y={height + 20} textAnchor="middle" className="fill-slate-400 text-[10px]">
                {d.label.split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>

      {openMonth && (
        <MonthPurchasesModal month={openMonth.month} label={openMonth.label} onClose={() => setOpenMonth(null)} />
      )}
    </div>
  );
}
