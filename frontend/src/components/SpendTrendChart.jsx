import { useEffect, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';
import MonthPurchasesModal from './MonthPurchasesModal.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(n);

const RANGES = [3, 6, 12];

/**
 * Monthly spend bar chart for Order History — hand-rolled SVG rather
 * than pulling in a charting library, since these are the only charts
 * in the app (a dependency for a couple of small charts isn't worth
 * it). Range toggle (3/6/12 months) re-fetches getSpendTrend with a
 * different `months` param rather than slicing client-side, so a
 * 12-month view is always the real aggregated total, not an
 * approximation.
 *
 * Hover a bar to see the exact amount spent that month (shown right
 * above the bar, not a slow native tooltip). Click a bar to open the
 * list of everything actually purchased that month — see
 * MonthPurchasesModal, which queries the same month-filtered data
 * this bar's total came from, so the numbers always match.
 */
export default function SpendTrendChart() {
  const [range, setRange] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [openMonth, setOpenMonth] = useState(null); // { month, label } | null

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSpendTrend(range)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  const max = data && data.length ? Math.max(1, ...data.map((d) => Number(d.total_spend))) : 1;
  const width = 340;
  const height = 88;
  const barGap = 6;
  const barWidth = data && data.length ? (width - barGap * (data.length - 1)) / data.length : 0;

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/10">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <TrendingUp size={13} className="text-brand-600" /> Spend trend
        </p>
        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {RANGES.map((m) => (
            <button key={m} onClick={() => setRange(m)}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                range === m ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}>
              {m}mo
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex h-24 items-center justify-center text-slate-300">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}

      {!loading && data && data.length === 0 && (
        <p className="py-6 text-center text-xs text-slate-400">No purchase history yet.</p>
      )}

      {!loading && data && data.length > 0 && (
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
                  style={{ transition: 'fill 0.15s ease, height 0.2s ease' }} />
                {(range <= 6 || i % 2 === 0) && (
                  <text x={x + barWidth / 2} y={height + 20} textAnchor="middle" className="fill-slate-400 text-[9px]">
                    {d.label.split(' ')[0]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {openMonth && (
        <MonthPurchasesModal month={openMonth.month} label={openMonth.label} onClose={() => setOpenMonth(null)} />
      )}
    </div>
  );
}
