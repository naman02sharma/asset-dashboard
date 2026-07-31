import { useEffect, useState } from 'react';
import { ArrowLeft, MapPin, Package, Boxes, Search, Loader2, Hash } from 'lucide-react';
import { api } from '../api/api.js';
import { ApprovalPanel, CreatorApproverLine } from './ApprovalStatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * "Location POs" — browse every purchase AND standalone asset tied to
 * a location, each carrying its own PO number (see
 * 019_po_number_generator.sql). Two ways in: pick a location from the
 * left rail (GET /locations/overview), or search a PO number directly
 * (GET /purchases/search-po) — same search the global search bar's
 * "PO Numbers" group uses, kept here too since a location-first
 * browsing page is exactly where someone hunting a specific PO number
 * would look first.
 */
export default function LocationPosPage({ onBack, showToast, initialPoQuery = '' }) {
  const { canApprove } = useAuth();
  const [overview, setOverview] = useState([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { location, purchases, assets }
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [poQuery, setPoQuery] = useState(initialPoQuery);
  const [poResults, setPoResults] = useState(null); // { purchases, assets } | null
  const [poSearching, setPoSearching] = useState(false);

  useEffect(() => {
    api.getLocationsOverview()
      .then(setOverview)
      .catch(() => setOverview([]))
      .finally(() => setLoadingOverview(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setLoadingDetail(true);
    setPoResults(null);
    api.getLocationItems(selectedId)
      .then(setDetail)
      .catch((err) => showToast?.(err.message || 'Could not load this location.', 'error'))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  useEffect(() => {
    const trimmed = poQuery.trim();
    if (trimmed.length < 2) { setPoResults(null); return; }
    setPoSearching(true);
    const t = setTimeout(async () => {
      try {
        const result = await api.searchByPoNumber(trimmed);
        setPoResults(result);
        setSelectedId(null); // PO search takes over from the location picker while active
      } catch {
        setPoResults({ purchases: [], assets: [] });
      } finally {
        setPoSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [poQuery]);

  async function refreshDetail() {
    if (!selectedId) return;
    const fresh = await api.getLocationItems(selectedId).catch(() => null);
    if (fresh) setDetail(fresh);
  }
  async function refreshPoSearch() {
    if (!poQuery.trim()) return;
    const fresh = await api.searchByPoNumber(poQuery.trim()).catch(() => null);
    if (fresh) setPoResults(fresh);
  }

  async function handleApprovePurchase(id) {
    try {
      await api.approvePurchase(id, true);
      showToast?.('Purchase approved.');
      await Promise.all([refreshDetail(), refreshPoSearch()]);
    } catch (err) {
      showToast?.(err.message || 'Could not approve.', 'error');
    }
  }
  async function handleRejectPurchase(id, reason) {
    try {
      await api.approvePurchase(id, false, reason);
      showToast?.('Purchase rejected.');
      await Promise.all([refreshDetail(), refreshPoSearch()]);
    } catch (err) {
      showToast?.(err.message || 'Could not reject.', 'error');
    }
  }
  async function handleApproveAsset(id) {
    try {
      await api.approveAsset(id, true);
      showToast?.('Asset approved.');
      await Promise.all([refreshDetail(), refreshPoSearch()]);
    } catch (err) {
      showToast?.(err.message || 'Could not approve.', 'error');
    }
  }
  async function handleRejectAsset(id, reason) {
    try {
      await api.approveAsset(id, false, reason);
      showToast?.('Asset rejected.');
      await Promise.all([refreshDetail(), refreshPoSearch()]);
    } catch (err) {
      showToast?.(err.message || 'Could not reject.', 'error');
    }
  }

  const showingPoSearch = poQuery.trim().length >= 2;
  const rawPurchases = showingPoSearch ? poResults?.purchases : detail?.purchases;
  const activeAssets = showingPoSearch ? poResults?.assets : detail?.assets;
  // A purchase that's already been delivered and approved auto-links
  // into Inventory as its own asset row (see ensureAssetFromPurchase),
  // inheriting the SAME po_number -- without this filter it shows up
  // twice here (once as the purchase, once as the linked asset) for
  // the exact same PO. The asset is the more current/complete record
  // (it's what's actually being tracked going forward -- assignment,
  // AMC, depreciation, etc.), so once a PO number has a linked asset,
  // suppress its purchase-side entry and let the asset represent it.
  const linkedPoNumbers = new Set((activeAssets || []).map((a) => a.po_number).filter(Boolean));
  const activePurchases = (rawPurchases || []).filter((p) => !p.po_number || !linkedPoNumbers.has(p.po_number));

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} title="Back to dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 transition-all">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Location POs</h2>
          <p className="text-xs text-slate-500">Browse purchases and assets by location, or search a PO number directly.</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={poQuery}
          onChange={(e) => setPoQuery(e.target.value)}
          placeholder="Search a PO number, e.g. po_kol_01"
          title="Search by PO number — matches purchases and assets"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {poSearching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>

      <div className="grid grid-cols-[260px_1fr] gap-5">
        {/* --- Location picker --- */}
        <div className="h-fit overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              <MapPin size={12} /> Locations
            </p>
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            {loadingOverview && <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>}
            {!loadingOverview && overview.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No locations yet.</p>
            )}
            {!loadingOverview && overview.map((loc) => {
              const pending = (loc.pending_purchase_count || 0) + (loc.pending_asset_count || 0);
              return (
                <button
                  key={loc.id}
                  onClick={() => { setSelectedId(loc.id); setPoQuery(''); }}
                  title={`${loc.purchase_count + loc.asset_count} total, ${pending} pending`}
                  className={`flex w-full items-center justify-between gap-2 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50 ${
                    selectedId === loc.id && !showingPoSearch ? 'bg-brand-50' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{loc.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">{loc.code}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {pending > 0 && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{pending} pending</span>
                    )}
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      {loc.purchase_count + loc.asset_count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* --- Detail: purchases + assets for the selected location, or PO search results --- */}
        <div className="space-y-4">
          {!showingPoSearch && !selectedId && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
              Pick a location on the left, or search a PO number above.
            </div>
          )}

          {(loadingDetail || (poSearching && !poResults)) && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}

          {!loadingDetail && showingPoSearch && poResults && (poResults.purchases.length + poResults.assets.length === 0) && (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
              No PO numbers match "{poQuery.trim()}".
            </div>
          )}

          {activePurchases?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <Package size={12} /> Purchases ({activePurchases.length})
                </p>
              </div>
              <div className="divide-y divide-slate-50">
                {activePurchases.map((p) => (
                  <div key={p.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-800">{p.item_name}</p>
                        <p className="text-xs text-slate-400">{p.vendor_name} · {dateFmt(p.order_date)}</p>
                        <CreatorApproverLine item={p} />
                      </div>
                      <div className="flex items-center gap-2">
                        {p.po_number && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600" title="PO number">
                            <Hash size={10} /> {p.po_number}
                          </span>
                        )}
                        <span className="font-mono text-sm tabular-nums text-slate-700">{currency(p.total_cost)}</span>
                      </div>
                    </div>
                    <ApprovalPanel item={p} canApprove={canApprove} onApprove={handleApprovePurchase} onReject={handleRejectPurchase} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeAssets?.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <Boxes size={12} /> Inventory assets ({activeAssets.length})
                </p>
              </div>
              <div className="divide-y divide-slate-50">
                {activeAssets.map((a) => (
                  <div key={a.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-800">{a.asset_name}</p>
                        <p className="text-xs text-slate-400">{a.category || '—'} · {dateFmt(a.purchase_date)}</p>
                        <CreatorApproverLine item={a} />
                      </div>
                      <div className="flex items-center gap-2">
                        {a.po_number && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600" title="PO number">
                            <Hash size={10} /> {a.po_number}
                          </span>
                        )}
                        <span className="font-mono text-sm tabular-nums text-slate-700">{currency(a.cost)}</span>
                      </div>
                    </div>
                    <ApprovalPanel item={a} canApprove={canApprove} onApprove={handleApproveAsset} onReject={handleRejectAsset} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loadingDetail && !showingPoSearch && selectedId && detail && activePurchases?.length === 0 && activeAssets?.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
              Nothing recorded for {detail.location?.name} yet.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
