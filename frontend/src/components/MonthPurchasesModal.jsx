import { useEffect, useState } from 'react';
import { X, Loader2, Package } from 'lucide-react';
import { api } from '../api/api.js';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

/**
 * "What did we buy this month?" — opened by clicking a bar on the
 * spend trend chart. Pulls from the same month-filtered query the bar
 * itself was aggregated from (getPurchasesByMonth mirrors
 * getSpendTrend's date_trunc('month', order_date) filter), so the
 * list here always matches the total that was clicked.
 */
export default function MonthPurchasesModal({ month, label, onClose }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getPurchasesByMonth(month)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const total = rows?.reduce((sum, p) => sum + Number(p.total_cost_with_tax ?? p.total_cost ?? 0), 0) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Package size={15} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Purchased in {label}</h2>
              {rows && <p className="text-xs text-slate-400">{rows.length} order{rows.length === 1 ? '' : 's'} · {currency(total)} total</p>}
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows?.length === 0 && (
            <p className="text-sm text-slate-400">Nothing was ordered this month.</p>
          )}
          {!loading && !error && rows?.length > 0 && (
            <ul className="space-y-1.5">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{p.item_name}</p>
                    <p className="text-xs text-slate-400">{p.vendor_name} · {dateFmt(p.order_date)}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm tabular-nums text-slate-600">{currency(p.total_cost_with_tax ?? p.total_cost)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button onClick={onClose} title="Close" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
