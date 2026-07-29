import { useEffect, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { api } from '../api/api.js';
import OrderCalendar from './OrderCalendar.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, notation: 'compact' }).format(n || 0);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

const STATUS_DOT = {
  delivered: 'bg-green-500',
  partially_delivered: 'bg-amber-500',
  ordered: 'bg-slate-400',
  cancelled: 'bg-red-400',
};

/**
 * Compact card companion to the full OrderCalendar grid — same
 * footprint/pattern as MaintenanceCalendarCard (small "recent
 * activity" list + a "Full calendar" button that opens the real
 * month grid in a modal), but sourced from purchase order dates
 * rather than asset maintenance/AMC/warranty events. Deliberately a
 * DIFFERENT lens on the data than SpendTrendChart next to it: that
 * one aggregates total ₹ per month, this one is about WHEN orders
 * were actually placed, day by day, colored by delivery status.
 */
export default function OrderCalendarCard({ showToast }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const thisMonth = new Date().toISOString().slice(0, 10);
    api.getPurchasesByMonth(thisMonth)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) showToast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, []);

  const [showFull, setShowFull] = useState(false);
  const recent = (rows || []).slice().sort((a, b) => (a.order_date < b.order_date ? 1 : -1)).slice(0, 5);
  const monthTotal = (rows || []).reduce((sum, p) => sum + Number(p.total_cost || 0), 0);

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <CalendarClock size={13} className="text-brand-600" /> Orders this month
        </p>
        <button onClick={() => setShowFull(true)} className="text-[11px] font-medium text-brand-600 hover:underline">
          Full calendar
        </button>
      </div>

      {rows === null && <div className="py-3 text-center text-xs text-slate-300">Loading…</div>}

      {rows && rows.length === 0 && (
        <p className="py-3 text-xs text-slate-400">Nothing ordered yet this month.</p>
      )}

      {rows && rows.length > 0 && (
        <>
          <p className="mb-1.5 text-[11px] text-slate-400">{rows.length} order{rows.length === 1 ? '' : 's'} · {currency(monthTotal)} so far</p>
          <ul className="space-y-1.5">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[p.order_status] || 'bg-slate-400'}`} />
                <span className="w-10 shrink-0 text-slate-400">{dateFmt(p.order_date)}</span>
                <span className="truncate text-slate-600" title={p.item_name}>{p.item_name}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {showFull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
          onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setShowFull(false); }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl animate-[scaleIn_0.15s_ease-out]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Order Calendar</h2>
              <button onClick={() => setShowFull(false)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <OrderCalendar showToast={showToast} />
          </div>
        </div>
      )}
    </div>
  );
}
