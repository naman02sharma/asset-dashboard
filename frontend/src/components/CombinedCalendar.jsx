import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const ORDER_STYLES = {
  delivered: { label: 'Delivered', dot: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50' },
  partially_delivered: { label: 'Partially delivered', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
  ordered: { label: 'Ordered', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100' },
  cancelled: { label: 'Cancelled', dot: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-50' },
};
const orderFallback = { label: 'Order', dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-100' };

const EVENT_STYLES = {
  amc_end: { label: 'AMC ends', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50' },
  warranty_expiry: { label: 'Warranty expires', dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' },
  maintenance_return: { label: 'Expected back from repair', dot: 'bg-amber-600', text: 'text-amber-800', bg: 'bg-amber-100' },
};

const toISO = (d) => d.toISOString().slice(0, 10);
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * Combined calendar — one month grid instead of two ("Order Calendar"
 * and "Maintenance Calendar" used to be entirely separate components
 * with their own cards, per request). Each day cell can now carry
 * BOTH kinds of events: purchase orders placed that day (colored by
 * order_status, same palette PurchaseTable uses) and asset lifecycle
 * events -- AMC ending, warranty expiring, an item due back from
 * repair (colored by event_type). A single combined legend covers
 * both.
 *
 * Purchases are re-fetched per displayed month (getPurchasesByMonth),
 * same as the old OrderCalendar -- a company's order history can grow
 * indefinitely. Maintenance/AMC/warranty events are fetched once
 * (getCalendarEvents), same as the old MaintenanceCalendar -- a much
 * smaller, bounded set that doesn't need month-by-month windowing.
 */
export default function CombinedCalendar({ showToast }) {
  const [anchor, setAnchor] = useState(new Date());
  const [orders, setOrders] = useState(null);
  const [events, setEvents] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setOrders(null);
    setSelectedDay(null);
    api.getPurchasesByMonth(toISO(anchor))
      .then((data) => { if (!cancelled) setOrders(data); })
      .catch((err) => { if (!cancelled) showToast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, [anchor.getFullYear(), anchor.getMonth()]);

  useEffect(() => {
    let cancelled = false;
    api.getCalendarEvents()
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch((err) => { if (!cancelled) showToast(err.message, 'error'); });
    return () => { cancelled = true; };
  }, []);

  const ordersByDate = useMemo(() => {
    const map = {};
    for (const p of orders || []) {
      const key = (p.order_date || '').slice(0, 10);
      if (!key) continue;
      (map[key] ||= []).push(p);
    }
    return map;
  }, [orders]);

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events || []) {
      (map[e.date] ||= []).push(e);
    }
    return map;
  }, [events]);

  function shift(amount) {
    setAnchor((prev) => {
      const next = new Date(prev);
      next.setMonth(next.getMonth() + amount);
      return next;
    });
  }

  const loading = orders === null || events === null;
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = toISO(new Date());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const selectedOrders = selectedDay ? (ordersByDate[selectedDay] || []) : [];
  const selectedEvents = selectedDay ? (eventsByDate[selectedDay] || []) : [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-all hover:scale-105 hover:bg-slate-50">
            <ChevronLeft size={15} />
          </button>
          <p className="w-40 text-center text-sm font-medium text-slate-700">
            {anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </p>
          <button onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-all hover:scale-105 hover:bg-slate-50">
            <ChevronRight size={15} />
          </button>
          <button onClick={() => setAnchor(new Date())} className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-50">
            Today
          </button>
        </div>
        {orders && (
          <p className="text-xs text-slate-400">
            {orders.length} order{orders.length === 1 ? '' : 's'} · {currency(orders.reduce((s, p) => s + Number(p.total_cost_with_tax ?? p.total_cost ?? 0), 0))}
          </p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
        {Object.entries(ORDER_STYLES).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-slate-500">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
          </span>
        ))}
        <span className="text-slate-200">|</span>
        {Object.entries(EVENT_STYLES).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-slate-500">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
          </span>
        ))}
      </div>

      {loading ? (
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
              const dayOrders = ordersByDate[iso] || [];
              const dayEvents = eventsByDate[iso] || [];
              const hasAny = dayOrders.length > 0 || dayEvents.length > 0;
              const combined = [
                ...dayOrders.map((p) => ({ kind: 'order', key: p.id, label: p.item_name, style: ORDER_STYLES[p.order_status] || orderFallback })),
                ...dayEvents.map((e, i) => ({ kind: 'event', key: `${e.event_type}-${i}`, label: e.asset_name, style: EVENT_STYLES[e.event_type] })),
              ];
              return (
                <button key={iso} type="button" onClick={() => hasAny && setSelectedDay(iso)}
                  className={`min-h-[96px] border-b border-r border-slate-100 p-1.5 text-left last:border-r-0 transition-colors ${
                    inMonth ? 'hover:bg-slate-50' : 'bg-slate-50/40'
                  } ${hasAny ? 'cursor-pointer' : 'cursor-default'}`}>
                  <p className={`text-xs ${iso === today ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
                    {day.getDate()}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {combined.slice(0, 3).map((item) => (
                      <p key={item.key} title={`${item.label} — ${item.style.label}`}
                        className={`truncate rounded px-1 py-0.5 text-[10px] ${item.style.bg} ${item.style.text}`}>
                        {item.label}
                      </p>
                    ))}
                    {combined.length > 3 && <p className="text-[10px] text-slate-400">+{combined.length - 3} more</p>}
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
              <button onClick={() => setSelectedDay(null)} title="Close" className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {selectedOrders.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Orders</p>
                  <ul className="space-y-1.5">
                    {selectedOrders.map((p) => {
                      const s = ORDER_STYLES[p.order_status] || orderFallback;
                      return (
                        <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-700">{p.item_name}</p>
                            <p className="text-xs text-slate-400">{p.vendor_name}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm tabular-nums text-slate-600">{currency(p.total_cost_with_tax ?? p.total_cost)}</p>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {selectedEvents.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Asset events</p>
                  <ul className="space-y-1.5">
                    {selectedEvents.map((e, i) => {
                      const s = EVENT_STYLES[e.event_type];
                      return (
                        <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                          <p className="truncate text-sm font-medium text-slate-700">{e.asset_name}</p>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
