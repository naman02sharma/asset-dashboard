import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MapPin, Package, Boxes, Search, Loader2, Hash, PackageSearch, Building2, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../api/api.js';
import { ApprovalPanel, CreatorApproverLine } from './ApprovalStatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Badge } from './ui/badge.jsx';
import { AnimatedNumber } from './ui/animated-number.jsx';
import LocationFormModal from './LocationFormModal.jsx';
import { ASSET_STATUS_STYLES } from './AssetStatusBadge.jsx';

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
export default function LocationPosPage({ onBack, showToast, initialPoQuery = '', onSummaryChange, onGoToAsset }) {
  const { canApprove, canEdit } = useAuth();
  const [overview, setOverview] = useState([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // { location, purchases, assets }
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null); // location object | null

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
  async function refreshOverview() {
    const fresh = await api.getLocationsOverview().catch(() => null);
    if (fresh) setOverview(fresh);
  }

  // Left rail (overview) and the detail banner both show the
  // location's name/code independently, and PO search results carry
  // their own location fields too via delivery_location_code -- but
  // that last one is a snapshot per PO, not worth live-patching here.
  // Refreshing both overview and the currently-open detail after a
  // save keeps what's actually on screen in sync without a full page
  // reload.
  async function handleUpdateLocation(id, form) {
    await api.updateLocation(id, form);
    showToast?.('Location updated.');
    await Promise.all([refreshOverview(), refreshDetail()]);
  }

  async function handleApprovePurchase(id) {
    try {
      await api.approvePurchase(id, true);
      showToast?.('Purchase approved.');
      // Approving can backfill a deferred Inventory asset for an
      // already-delivered purchase (see assetController), which moves
      // the needle on Total Asset Purchase Value — same as
      // App.jsx's own handleApprovePurchase, this page needs to
      // refresh the shared KPI summary too, or the Purchases page
      // keeps showing stale numbers until something else happens to
      // refetch them.
      onSummaryChange?.();
      await Promise.all([refreshDetail(), refreshPoSearch()]);
    } catch (err) {
      showToast?.(err.message || 'Could not approve.', 'error');
    }
  }
  async function handleRejectPurchase(id, reason) {
    try {
      await api.approvePurchase(id, false, reason);
      showToast?.('Purchase rejected.');
      onSummaryChange?.();
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

  // Bulk orders (e.g. "10x Dell Laptop" on one purchase) create one
  // asset row PER UNIT (see assetController.ensureAssetFromPurchase),
  // so a flat list here would show ten near-identical rows for what
  // is really one order. Group units that share a purchase_id into
  // one collapsible batch, same grouping InventoryPage uses — anything
  // without a shared purchase_id (a batch of exactly one) renders as
  // a normal row.
  const groupedAssets = useMemo(() => {
    const map = new Map();
    const order = [];
    for (const a of activeAssets || []) {
      const key = a.purchase_id || `single-${a.id}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(a);
    }
    return order.map((key) => map.get(key));
  }, [activeAssets]);

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
              const isSelected = selectedId === loc.id && !showingPoSearch;
              return (
                <button
                  key={loc.id}
                  onClick={() => { setSelectedId(loc.id); setPoQuery(''); }}
                  title={`${loc.purchase_count + loc.asset_count} total, ${pending} pending`}
                  className={`group flex w-full items-center justify-between gap-2 border-b border-slate-50 px-4 py-3 text-left transition-all last:border-0 ${
                    isSelected ? 'bg-gradient-to-r from-brand-50 to-brand-50/40 border-l-2 border-l-brand-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                      isSelected ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                    }`}>
                      <MapPin size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${isSelected ? 'text-brand-700' : 'text-slate-800'}`}>{loc.name}</p>
                      <p className="font-mono text-[11px] text-slate-400">{loc.code}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {pending > 0 && <Badge variant="amber">{pending} pending</Badge>}
                    <Badge variant="slate">{loc.purchase_count + loc.asset_count}</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* --- Detail: purchases + assets for the selected location, or PO search results --- */}
        <div className="space-y-4">
          {!showingPoSearch && !selectedId && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
              <PackageSearch size={22} className="text-slate-300" />
              Pick a location on the left, or search a PO number above.
            </div>
          )}

          {(loadingDetail || (poSearching && !poResults)) && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}

          {!loadingDetail && showingPoSearch && poResults && (poResults.purchases.length + poResults.assets.length === 0) && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
              <Hash size={22} className="text-slate-300" />
              No PO numbers match "{poQuery.trim()}".
            </div>
          )}

          {/* Location context banner -- who/where you're looking at,
              persistent above the results so switching locations
              doesn't leave you scrolling back to the left rail to
              remember which one is selected. Counts use the same
              AnimatedNumber count-up as the dashboard KPI cards for a
              bit of consistency/life when you switch locations. */}
          {!loadingDetail && !showingPoSearch && selectedId && detail?.location && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-br from-brand-50/60 to-white px-5 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-sm">
                  <Building2 size={17} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold text-slate-900">{detail.location.name}</p>
                    <Badge variant="brand">{detail.location.code}</Badge>
                    {canEdit && (
                      <button onClick={() => setEditingLocation(detail.location)} title="Edit location"
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-all hover:scale-105 hover:bg-white hover:text-brand-600">
                        <Pencil size={15} strokeWidth={2.3} />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{detail.location.address || 'No address on file'}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-center">
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-slate-800">
                    <AnimatedNumber value={activePurchases.length} format={(n) => Math.round(n)} />
                  </p>
                  <p className="text-[11px] text-slate-400">purchases</p>
                </div>
                <div>
                  <p className="font-mono text-lg font-semibold tabular-nums text-slate-800">
                    <AnimatedNumber value={activeAssets.length} format={(n) => Math.round(n)} />
                  </p>
                  <p className="text-[11px] text-slate-400">assets</p>
                </div>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={showingPoSearch ? `po:${poQuery}` : `loc:${selectedId}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="space-y-4"
            >
              {activePurchases?.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                      <Package size={12} /> Purchases ({activePurchases.length})
                    </p>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {activePurchases.map((p) => (
                      <div key={p.id} className="px-4 py-3 transition-colors hover:bg-slate-50">
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
                            <span className="font-mono text-sm tabular-nums text-slate-700">{currency(p.total_cost_with_tax ?? p.total_cost)}</span>
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
                    {groupedAssets.map((group) => (
                      group.length > 1 ? (
                        <LocationAssetBatchGroup key={group[0].purchase_id} group={group}
                          canApprove={canApprove} onApproveAsset={handleApproveAsset} onRejectAsset={handleRejectAsset}
                          onGoToAsset={onGoToAsset} />
                      ) : (
                        <LocationAssetRow key={group[0].id} asset={group[0]}
                          canApprove={canApprove} onApproveAsset={handleApproveAsset} onRejectAsset={handleRejectAsset}
                          onGoToAsset={onGoToAsset} />
                      )
                    ))}
                  </div>
                </div>
              )}

              {!loadingDetail && !showingPoSearch && selectedId && detail && activePurchases?.length === 0 && activeAssets?.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
                  <Boxes size={22} className="text-slate-300" />
                  Nothing recorded for {detail.location?.name} yet.
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {editingLocation && (
        <LocationFormModal
          mode="edit"
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSubmit={(form) => handleUpdateLocation(editingLocation.id, form)}
        />
      )}
    </main>
  );
}

// One asset, standalone (not part of a multi-unit batch) — the same
// row markup this page always used. The asset name is now a button
// that jumps straight to this exact asset in Inventory Management
// (same handleGoToAsset flow the global search bar uses) — searches
// by asset_tag when this unit has one (unique per physical item),
// falling back to the asset name otherwise.
function LocationAssetRow({ asset: a, canApprove, onApproveAsset, onRejectAsset, nested = false, onGoToAsset }) {
  return (
    <div className={`px-4 py-3 transition-colors hover:bg-slate-50 ${nested ? 'bg-slate-50/50 pl-10' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {onGoToAsset ? (
            <button type="button" onClick={() => onGoToAsset(a.asset_tag || a.asset_name)}
              title="Open in Inventory Management"
              className="text-left font-medium text-slate-800 hover:text-brand-600 hover:underline">
              {a.asset_name}
            </button>
          ) : (
            <p className="font-medium text-slate-800">{a.asset_name}</p>
          )}
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
      <ApprovalPanel item={a} canApprove={canApprove} onApprove={onApproveAsset} onReject={onRejectAsset} />
    </div>
  );
}

/**
 * One collapsed row standing in for a whole bulk-order batch (e.g.
 * "10x Dell Laptop" from a single purchase) at this location —
 * expands into the individual LocationAssetRow for each unit. Mirrors
 * InventoryPage's BatchGroupRow so a bulk order looks the same neat,
 * collapsible dropdown wherever it shows up in the app, instead of a
 * long run of near-identical rows.
 */
function LocationAssetBatchGroup({ group, canApprove, onApproveAsset, onRejectAsset, onGoToAsset }) {
  const [expanded, setExpanded] = useState(false);
  const first = group[0];

  const counts = group.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(counts)
    .map(([status, n]) => `${n} ${(ASSET_STATUS_STYLES[status]?.label || status).toLowerCase()}`)
    .join(' · ');

  return (
    <div className="bg-brand-50/30 transition-colors hover:bg-brand-50/50">
      <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left">
        {expanded ? <ChevronDown size={14} className="shrink-0 text-brand-600" /> : <ChevronRight size={14} className="shrink-0 text-brand-600" />}
        <Boxes size={15} className="shrink-0 text-brand-600" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{first.asset_name}</span>
            <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">×{group.length}</span>
            {first.po_number && (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600" title="PO number">
                <Hash size={10} /> {first.po_number}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-slate-500">{statusSummary}</p>
        </div>
        <span className="ml-auto shrink-0 font-mono text-sm text-slate-600">{currency(first.cost)} each</span>
      </button>
      {expanded && group.map((a) => (
        <LocationAssetRow key={a.id} asset={a} nested
          canApprove={canApprove} onApproveAsset={onApproveAsset} onRejectAsset={onRejectAsset}
          onGoToAsset={onGoToAsset} />
      ))}
    </div>
  );
}
