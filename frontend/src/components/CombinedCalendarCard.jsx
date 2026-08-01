import { useEffect, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { api } from '../api/api.js';
import CombinedCalendar from './CombinedCalendar.jsx';

const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

const ORDER_DOT = {
  delivered: 'bg-green-500',
  partially_delivered: 'bg-amber-500',
  ordered: 'bg-slate-400',
  cancelled: 'bg-red-400',
};
const EVENT_DOT = {
  amc_end: 'bg-purple-500',
  warranty_expiry: 'bg-blue-500',
  maintenance_return: 'bg-amber-600',
};
const EVENT_LABEL = {
  amc_end: 'AMC ends',
  warranty_expiry: 'Warranty expires',
  maintenance_return: 'Due back from repair',
};

/**
 * Compact card combining what used to be two separate cards
 * (OrderCalendarCard + MaintenanceCalendarCard) into one -- a short
 * "what's happening soon" list merging orders placed this month with
 * upcoming AMC/warranty/repair-return events, sorted together by
 * date. "Full calendar" opens CombinedCalendar's real month grid,
 * which shows both kinds of events on the same days.
 */
export default function CombinedCalendarCard({ showToast }) {
  const [orders, setOrders] = useState(null);
  const [events, setEvents] = useState(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const thisMonth = new Date().toISOString().slice(0, 10);
    api.getPurchasesByMonth(thisMonth).then(setOrders).catch((err) => showToast(err.message, 'error'));
    api.getCalendarEvents().then(setEvents).catch((err) => showToast(err.message, 'error'));
  }, []);

  const loading = orders === null || events === null;
  const today = new Date().toISOString().slice(0, 10);

  const items = loading ? [] : [
    ...orders.map((p) => ({ date: p.order_date?.slice(0, 10), label: p.item_name, dot: ORDER_DOT[p.order_status] || 'bg-slate-400', kind: 'order' })),
    ...events.filter((e) => e.date >= today).map((e) => ({ date: e.date, label: e.asset_name, dot: EVENT_DOT[e.event_type], kind: 'event', sub: EVENT_LABEL[e.event_type] })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/10">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <CalendarDays size={13} className="text-brand-600" /> Calendar
        </p>
        <button onClick={() => setShowFull(true)} title="Open the full month calendar" className="text-[11px] font-medium text-brand-600 hover:underline">
          Full calendar
        </button>
      </div>

      {loading && <div className="py-3 text-center text-xs text-slate-300">Loading…</div>}

      {!loading && items.length === 0 && (
        <p className="py-3 text-xs text-slate-400">Nothing ordered this month, and nothing coming up.</p>
      )}

      {!loading && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`} />
              <span className="w-10 shrink-0 text-slate-400">{dateFmt(item.date)}</span>
              <span className="truncate text-slate-600" title={item.sub ? `${item.label} — ${item.sub}` : item.label}>{item.label}</span>
              {item.sub && <span className="ml-auto shrink-0 truncate text-[10px] text-slate-400">{item.sub}</span>}
            </li>
          ))}
        </ul>
      )}

      {showFull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
          onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setShowFull(false); }}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl animate-[scaleIn_0.15s_ease-out]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Calendar</h2>
              <button onClick={() => setShowFull(false)} title="Close" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <CombinedCalendar showToast={showToast} />
          </div>
        </div>
      )}
    </div>
  );
}
