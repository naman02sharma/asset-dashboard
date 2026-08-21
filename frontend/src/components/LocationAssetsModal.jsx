import { useEffect, useState } from 'react';
import { X, Loader2, Boxes } from 'lucide-react';
import { api } from '../api/api.js';
import AssetStatusBadge from './AssetStatusBadge.jsx';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

/**
 * "What's this location holding?" — opened by clicking a bar on
 * LocationBreakdownChart. Pulls from the same GET /locations/:id/items
 * endpoint the Location POs page uses, but shown here as a quick
 * inline preview (assets only, per what was asked) rather than
 * navigating away from Order History.
 *
 * Each row is clickable — jumps straight to that exact asset in
 * Inventory Management (same handleGoToAsset flow the global search
 * bar's "Assets" results already use), closing this modal first.
 * Searches by asset_tag when the unit has one (unique per physical
 * item) so a multi-unit batch lands on the specific unit clicked,
 * falling back to the asset name otherwise.
 */
export default function LocationAssetsModal({ locationId, locationName, onClose, onGoToAsset }) {
  const [assets, setAssets] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getLocationItems(locationId)
      .then((data) => { if (!cancelled) setAssets(data.assets || []); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [locationId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Boxes size={15} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">{locationName}</h2>
              {assets && <p className="text-xs text-slate-400">{assets.length} asset{assets.length === 1 ? '' : 's'}</p>}
            </div>
          </div>
          <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!assets && !error && <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {assets && assets.length === 0 && (
            <p className="text-sm text-slate-400">Nothing recorded at this location yet.</p>
          )}
          {assets && assets.length > 0 && (
            <ul className="space-y-1.5">
              {assets.map((a) => (
                <li key={a.id}>
                  <button type="button"
                    onClick={() => { onGoToAsset?.(a.asset_tag || a.asset_name); onClose(); }}
                    title="Open in Inventory Management"
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{a.asset_name}</p>
                      <p className="text-xs text-slate-400">{a.category || '—'}{a.current_employee_name ? ` · with ${a.current_employee_name}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <p className="font-mono text-sm tabular-nums text-slate-600">{currency(a.cost)}</p>
                      <AssetStatusBadge status={a.status} />
                    </div>
                  </button>
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
