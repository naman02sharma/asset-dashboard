import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const STATUS_STYLES = {
  delivered: { label: 'Delivered', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  partially_delivered: { label: 'Partially delivered', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  ordered: { label: 'Ordered', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100' },
  cancelled: { label: 'Cancelled', dot: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-50' },
};
const fallbackStyle = { label: 'Order', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100' };

const toISO = (d) => d.toISOString().slice(0, 10);
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * Full month calendar of purchase orders — a distinct sibling to
 * MaintenanceCalendar (which tracks AMC/warranty/repair-return dates
 * off the inventory side). This one is about the order/financial
 * lifecycle: which day was each purchase placed, and what happened to
 * it since (color-coded by order_status, same palette as
 * PurchaseTable's status badges elsewhere in the app).
 *
 * Re-fetches getPurchasesByMonth every time the displayed month
 * changes (rather than loading everything once, unlike
 * MaintenanceCalendar) since a company's order history can span years
 * and grow indefinitely, while asset maintenance events are a much
 * smaller bounded set.
 */
export default function OrderCalendar({ showToast }) {
  const [anchor, setAnchor] = useState(new Date());
  const [rows, setRows] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null); // ISO date string | null

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setSelectedDay(null);
    api.getPurchasesByMonth(toISO(anchor))
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) showToast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, [anchor.getFullYear(), anchor.getMonth()]);

  const byDate = useMemo(() => {
    const map = {};
    for (const p of rows || []) {
      const key = (p.order_date || '').slice(0, 10);
      if (!key) continue;
      (map[key] ||= []).push(p);
    }
    return map;
  }, [rows]);

  function shift(amount) {
    setAnchor((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + amount);
      return next;
    });
  }

  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = toISO(new Date());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const selectedOrders = selectedDay ? (byDate[selectedDay] || []) : [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50">
            <ChevronLeft size={15} />
          </button>
          <p className="w-40 text-center text-sm font-medium text-slate-700">
            {anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>
          <button onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50">
            <ChevronRight size={15} />
          </button>
          <button onClick={() => setAnchor(new Date())} className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50">
            Today
          </button>
        </div>
        {rows && (
          <p className="text-xs text-slate-400">
            {rows.length} order{rows.length === 1 ? '' : 's'} · {currency(rows.reduce((s, p) => s + Number(p.total_cost || 0), 0))}
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {Object.entries(STATUS_STYLES).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-slate-500">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
          </span>
        ))}
      </div>

      {rows === null ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} /> Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60 text-center text-xs font-medium text-slate-500">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const iso = toISO(day);
              const inMonth = day.getMonth() === anchor.getMonth();
              const dayOrders = byDate[iso] || [];
              return (
                <button key={iso} type="button" onClick={() => dayOrders.length > 0 && setSelectedDay(iso)}
                  className={`min-h-[88px] border-b border-r border-slate-100 p-1.5 text-left last:border-r-0 transition-colors ${
                    inMonth ? 'hover:bg-slate-50' : 'bg-slate-50/40'
                  } ${dayOrders.length > 0 ? 'cursor-pointer' : 'cursor-default'}`}>
                  <p className={`text-xs ${iso === today ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
                    {day.getDate()}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {dayOrders.slice(0, 2).map((p) => {
                      const s = STATUS_STYLES[p.order_status] || fallbackStyle;
                      return (
                        <p key={p.id} title={`${p.item_name} — ${s.label}`}
                          className={`truncate rounded px-1 py-0.5 text-[10px] ${s.bg} ${s.text}`}>
                          {p.item_name}
                        </p>
                      );
                    })}
                    {dayOrders.length > 2 && <p className="text-[10px] text-slate-400">+{dayOrders.length - 2} more</p>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedDay && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedDay(null); }}>
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">
                {new Date(selectedDay).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              <ul className="space-y-1.5">
                {selectedOrders.map((p) => {
                  const s = STATUS_STYLES[p.order_status] || fallbackStyle;
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700">{p.item_name}</p>
                        <p className="text-xs text-slate-400">{p.vendor_name}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm tabular-nums text-slate-600">{currency(p.total_cost)}</p>
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
