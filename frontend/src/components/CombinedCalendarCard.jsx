import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { api } from '../api/api.js';
import { Card } from './ui/card.jsx';

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
    <Card className="w-full p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <CalendarDays size={13} className="text-brand-600" /> Calendar
        </p>
        <button
          onClick={() => window.open('/?view=calendar', '_blank', 'noopener,noreferrer')}
          title="Open the full month calendar in a new tab"
          className="text-[11px] font-medium text-brand-600 hover:underline"
        >
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
    </Card>
  );
}