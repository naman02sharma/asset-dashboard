import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';

const EVENT_STYLES = {
  amc_end: { label: 'AMC ends', dot: 'bg-purple-500', text: 'text-purple-700', bg: 'bg-purple-50' },
  warranty_expiry: { label: 'Warranty expires', dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50' },
  maintenance_return: { label: 'Expected back from repair', dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50' },
};

const toISO = (d) => d.toISOString().slice(0, 10);
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/**
 * Custom-built month/week calendar (no external calendar library) —
 * events are fetched once and grouped client-side by ISO date, which
 * is a reasonable tradeoff for a company's own asset inventory (not a
 * dataset large enough to need server-side windowing here, unlike
 * Successful Order History's pagination).
 */
export default function MaintenanceCalendar({ showToast }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week'
  const [anchor, setAnchor] = useState(new Date());

  useEffect(() => {
    let cancelled = false;
    api.getCalendarEvents()
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of events) {
      const key = e.date; // already 'YYYY-MM-DD' — see config/db.js's DATE type-parser fix
      (map[key] ||= []).push(e);
    }
    return map;
  }, [events]);

  function shift(amount) {
    setAnchor((prev) => {
      const next = new Date(prev);
      if (viewMode === 'month') next.setMonth(next.getMonth() + amount);
      else next.setDate(next.getDate() + amount * 7);
      return next;
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} /> Loading calendar…</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ChevronLeft size={15} />
          </button>
          <p className="w-40 text-center text-sm font-medium text-slate-700">
            {viewMode === 'month'
              ? anchor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
              : `Week of ${startOfWeek(anchor).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
          </p>
          <button onClick={() => shift(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ChevronRight size={15} />
          </button>
          <button onClick={() => setAnchor(new Date())} className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
            Today
          </button>
        </div>

        <div className="flex rounded-lg border border-slate-200 p-0.5">
          {['month', 'week'].map((mode) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                viewMode === mode ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}>
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {Object.entries(EVENT_STYLES).map(([key, s]) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-slate-500">
            <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
          </span>
        ))}
      </div>

      {viewMode === 'month' ? (
        <MonthGrid anchor={anchor} eventsByDate={eventsByDate} />
      ) : (
        <WeekRow anchor={anchor} eventsByDate={eventsByDate} />
      )}
    </div>
  );
}

function MonthGrid({ anchor, eventsByDate }) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const today = toISO(new Date());

  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60 text-center text-xs font-medium text-slate-500">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toISO(day);
          const inMonth = day.getMonth() === anchor.getMonth();
          const dayEvents = eventsByDate[iso] || [];
          return (
            <div key={iso} className={`min-h-[88px] border-b border-r border-slate-100 p-1.5 last:border-r-0 ${inMonth ? '' : 'bg-slate-50/40'}`}>
              <p className={`text-xs ${iso === today ? 'flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white' : inMonth ? 'text-slate-600' : 'text-slate-300'}`}>
                {day.getDate()}
              </p>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((e, i) => (
                  <p key={i} title={`${e.asset_name} — ${EVENT_STYLES[e.event_type].label}`}
                    className={`truncate rounded px-1 py-0.5 text-[10px] ${EVENT_STYLES[e.event_type].bg} ${EVENT_STYLES[e.event_type].text}`}>
                    {e.asset_name}
                  </p>
                ))}
                {dayEvents.length > 3 && <p className="text-[10px] text-slate-400">+{dayEvents.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekRow({ anchor, eventsByDate }) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = toISO(new Date());

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((day) => {
        const iso = toISO(day);
        const dayEvents = eventsByDate[iso] || [];
        return (
          <div key={iso} className={`min-h-[160px] rounded-xl border p-2 ${iso === today ? 'border-brand-400 bg-brand-50/30' : 'border-slate-200 bg-white'}`}>
            <p className="text-xs font-medium text-slate-600">{day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}</p>
            <div className="mt-2 space-y-1">
              {dayEvents.map((e, i) => (
                <div key={i} className={`rounded px-1.5 py-1 text-[11px] ${EVENT_STYLES[e.event_type].bg} ${EVENT_STYLES[e.event_type].text}`}>
                  <p className="truncate font-medium">{e.asset_name}</p>
                  <p className="truncate opacity-80">{EVENT_STYLES[e.event_type].label}</p>
                </div>
              ))}
              {dayEvents.length === 0 && <p className="text-[11px] text-slate-300">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
