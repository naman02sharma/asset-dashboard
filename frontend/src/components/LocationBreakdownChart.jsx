import { useEffect, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { api } from '../api/api.js';
import LocationAssetsModal from './LocationAssetsModal.jsx';

// Same accent-color cycling convention as DepartmentBreakdownChart.
const BAR_COLORS = ['bg-brand-600', 'bg-amber-500', 'bg-indigo-500', 'bg-green-500', 'bg-pink-500', 'bg-violet-500', 'bg-rose-500'];

/**
 * Horizontal bar chart of assets held per location (GET
 * /locations/overview -- the same endpoint the Location POs page's
 * left rail uses). Click a bar to see exactly what that location is
 * holding (LocationAssetsModal), same click-to-drill-down pattern as
 * SpendTrendChart's bars opening MonthPurchasesModal.
 */
export default function LocationBreakdownChart() {
  const [overview, setOverview] = useState(null);
  const [openLocation, setOpenLocation] = useState(null); // { id, name } | null

  useEffect(() => {
    let cancelled = false;
    api.getLocationsOverview()
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch(() => { if (!cancelled) setOverview([]); });
    return () => { cancelled = true; };
  }, []);

  const loading = overview === null;
  const sorted = (overview || []).slice().sort((a, b) => b.asset_count - a.asset_count);
  const maxCount = Math.max(1, ...sorted.map((l) => l.asset_count));

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <MapPin size={13} className="text-brand-600" /> Assets by location
      </div>

      {loading && <div className="flex items-center justify-center py-6 text-slate-300"><Loader2 size={16} className="animate-spin" /></div>}

      {!loading && sorted.length === 0 && (
        <p className="py-3 text-xs text-slate-400">No locations recorded yet.</p>
      )}

      {!loading && sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.slice(0, 6).map((loc, i) => (
            <li key={loc.id}>
              <button
                type="button"
                onClick={() => setOpenLocation({ id: loc.id, name: loc.name })}
                title={`See what ${loc.name} is holding`}
                className="group flex w-full items-center gap-2 text-left"
              >
                <span className="w-20 shrink-0 truncate text-xs text-slate-600 group-hover:text-brand-600 transition-colors" title={loc.name}>
                  {loc.name}
                </span>
                <span className="h-3.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className={`block h-full rounded-full transition-all duration-300 ${BAR_COLORS[i % BAR_COLORS.length]} group-hover:brightness-110`}
                    style={{ width: `${Math.max(4, (loc.asset_count / maxCount) * 100)}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right text-xs font-medium text-slate-700">{loc.asset_count}</span>
              </button>
            </li>
          ))}
          {sorted.length > 6 && (
            <li className="text-[11px] text-slate-400">+{sorted.length - 6} more locations</li>
          )}
        </ul>
      )}

      {openLocation && (
        <LocationAssetsModal
          locationId={openLocation.id}
          locationName={openLocation.name}
          onClose={() => setOpenLocation(null)}
        />
      )}
    </div>
  );
}
