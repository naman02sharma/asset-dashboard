import { useEffect, useState } from 'react';
import { CalendarDays, X, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';
import MaintenanceCalendar from './MaintenanceCalendar.jsx';

const EVENT_STYLES = {
  amc_end: { label: 'AMC ends', dot: 'bg-purple-500' },
  warranty_expiry: { label: 'Warranty expires', dot: 'bg-blue-500' },
  maintenance_return: { label: 'Expected back from repair', dot: 'bg-amber-500' },
};

const dateFmt = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/**
 * Small card version of MaintenanceCalendar, moved here from Inventory
 * Management per request — same footprint class as SpendTrendChart
 * (max-w-xs), showing just the next handful of upcoming
 * AMC/warranty/repair-return dates rather than a full grid. "Full
 * calendar" opens the complete month/week calendar (unchanged, still
 * built by MaintenanceCalendar.jsx) in a modal for anyone who needs
 * the bigger picture.
 */
export default function MaintenanceCalendarCard({ showToast }) {
  const [events, setEvents] = useState(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    api.getCalendarEvents()
      .then(setEvents)
      .catch((err) => showToast(err.message, 'error'));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (events || [])
    .filter((e) => e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 5);

  return (
    <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <CalendarDays size={12} className="text-brand-600" /> Upcoming
        </p>
        <button onClick={() => setShowFull(true)} className="text-[11px] font-medium text-brand-600 hover:underline">
          Full calendar
        </button>
      </div>

      {!events && <div className="flex justify-center py-3 text-slate-300"><Loader2 size={14} className="animate-spin" /></div>}

      {events && upcoming.length === 0 && (
        <p className="py-1 text-xs text-slate-400">Nothing coming up.</p>
      )}

      {events && upcoming.length > 0 && (
        <ul className="space-y-1.5">
          {upcoming.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${EVENT_STYLES[e.event_type]?.dot || 'bg-slate-400'}`} />
              <span className="w-10 shrink-0 text-slate-400">{dateFmt(e.date)}</span>
              <span className="truncate text-slate-600" title={e.asset_name}>{e.asset_name}</span>
            </li>
          ))}
        </ul>
      )}

      {showFull && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
          onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setShowFull(false); }}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl animate-[scaleIn_0.15s_ease-out]">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Maintenance Calendar</h2>
              <button onClick={() => setShowFull(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <MaintenanceCalendar showToast={showToast} />
          </div>
        </div>
      )}
    </div>
  );
}
