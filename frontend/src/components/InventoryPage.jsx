import { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Search, Plus, UserPlus, RotateCcw, Wrench, Archive, RefreshCw, Download, Loader2, Link2, ChevronDown, ChevronRight, Boxes, UploadCloud, QrCode, Trash2 } from 'lucide-react';
import { api } from '../api/api.js';
import AssetStatusBadge, { ASSET_STATUS_STYLES } from './AssetStatusBadge.jsx';
import AssetFormModal from './AssetFormModal.jsx';
import AssignEmployeeModal from './AssignEmployeeModal.jsx';
import MaintenanceDispatchModal from './MaintenanceDispatchModal.jsx';
import ReturnAssetModal from './ReturnAssetModal.jsx';
import AssetDetailDrawer from './AssetDetailDrawer.jsx';
import AssetModifyEditor from './AssetModifyEditor.jsx';
import { SkeletonTableRows } from './Skeleton.jsx';
import ImportAssetsModal from './ImportAssetsModal.jsx';
import BulkAssignModal from './BulkAssignModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function InventoryPage({ vendors, onBack, showToast, embedded = false, initialQuery = '' }) {
  const { isAdmin } = useAuth();

  const [assets, setAssets] = useState([]);

  // Bulk orders (e.g. "10x Dell Laptop" on one purchase) create one
  // asset row PER UNIT on the backend (see assetController.
  // ensureAssetFromPurchase) so each physical item can be assigned/
  // tracked individually — but showing ten flat, identical-looking
  // rows would be unreadable. Group units that share a purchase_id
  // into one batch; anything without a shared purchase_id (manually
  // added assets, or a batch of exactly one) renders as a normal row.
  const groupedAssets = useMemo(() => {
    const map = new Map();
    const order = [];
    for (const a of assets) {
      const key = a.purchase_id || `single-${a.id}`;
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key).push(a);
    }
    return order.map((key) => map.get(key));
  }, [assets]);
  const [summary, setSummary] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [statusFilter, setStatusFilter] = useState('');

  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectedAssets = useMemo(() => assets.filter((a) => selectedIds.has(a.id)), [assets, selectedIds]);
  // Bulk-assign only makes sense for units that are currently
  // Available — selecting a whole batch (e.g. via the group checkbox)
  // naturally includes units already in use/under repair too, so the
  // action stays enabled and just quietly targets the eligible subset
  // rather than being blocked outright by one ineligible unit.
  const assignableSelectedAssets = useMemo(() => selectedAssets.filter((a) => a.status === 'available'), [selectedAssets]);
  const [bulkRetiring, setBulkRetiring] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkQrLoading, setBulkQrLoading] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [maintenanceTarget, setMaintenanceTarget] = useState(null);
  const [returnTarget, setReturnTarget] = useState(null);
  const [detailAssetId, setDetailAssetId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  async function loadAssets() {
    setLoading(true);
    try {
      const data = await api.getAssets({ q: debouncedQuery, status: statusFilter });
      setAssets(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary() {
    try { setSummary(await api.getAssetSummary()); } catch { /* stat strip is non-critical */ }
  }

  async function loadEmployees() {
    api.getEmployees().then(setEmployees).catch(() => setEmployees([]));
  }

  useEffect(() => { loadSummary(); loadEmployees(); }, []);
  useEffect(() => { loadAssets(); }, [debouncedQuery, statusFilter]);

  function applyAssetUpdate(updated) {
    setAssets((rows) => rows.map((a) => (a.id === updated.id ? updated : a)));
    loadSummary();
  }

  async function handleCreateAsset(form) {
    const created = await api.createAsset(form);
    setAssets((rows) => [created, ...rows]);
    loadSummary();
    showToast('Asset created.');
  }

  async function handleEditAsset(form) {
    const updated = await api.updateAsset(editingAsset.id, form);
    applyAssetUpdate(updated);
    showToast('Asset updated.');
  }

  // Backs the inline "Modify" toggle in the table — a lighter-weight
  // partial PATCH (just cost / warranty_expiry) than the full Edit
  // Asset modal above, using the same endpoint since updateAsset only
  // touches whichever fields are actually present in the body.
  async function handleQuickModify(assetId, patch) {
    const updated = await api.updateAsset(assetId, patch);
    applyAssetUpdate(updated);
    showToast('Asset updated.');
  }

  async function handleAssign(assetId, data) {
    const updated = await api.assignAsset(assetId, data);
    applyAssetUpdate(updated);
    loadEmployees();
    showToast('Asset assigned.');
  }

  async function handleDispatch(assetId, data) {
    const updated = await api.dispatchAssetToMaintenance(assetId, data);
    applyAssetUpdate(updated);
    showToast('Asset sent for maintenance.');
  }

  async function handleReturn(assetId, data) {
    const updated = await api.returnAsset(assetId, data);
    applyAssetUpdate(updated);
    showToast('Asset returned.');
  }

  async function handleRetire(asset) {
    try {
      const updated = await api.setAssetStatus(asset.id, 'retired');
      applyAssetUpdate(updated);
      showToast('Asset retired.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleRestore(asset) {
    try {
      const updated = await api.setAssetStatus(asset.id, 'available');
      applyAssetUpdate(updated);
      showToast('Asset restored to Available.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Permanent, unlike Retire (a soft status change) — the row and its
  // full history disappear. Row-level click-to-confirm UX lives in
  // AssetRow, matching the same pattern used for deleting a purchase
  // on the Order History tab.
  async function handleDeleteAsset(asset) {
    try {
      await api.deleteAsset(asset.id);
      setAssets((rows) => rows.filter((a) => a.id !== asset.id));
      setSelectedIds((prev) => {
        if (!prev.has(asset.id)) return prev;
        const next = new Set(prev);
        next.delete(asset.id);
        return next;
      });
      loadSummary();
      showToast('Asset deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await api.exportAssets({ q: debouncedQuery, status: statusFilter });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  // --- Bulk selection & actions ---
  function toggleAsset(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleGroup(group) {
    const ids = group.map((a) => a.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === assets.length ? new Set() : new Set(assets.map((a) => a.id))));
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const BULK_CSV_COLUMNS = [
    ['Asset Name', 'asset_name'], ['Category', 'category'], ['Serial Number', 'serial_number'],
    ['Asset Tag', 'asset_tag'], ['Location', 'location'], ['Vendor', 'vendor_name'],
    ['Cost', 'cost'], ['Status', 'status'],
  ];
  function escapeCsvField(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function handleBulkExport() {
    const rows = assets.filter((a) => selectedIds.has(a.id));
    const header = BULK_CSV_COLUMNS.map(([label]) => escapeCsvField(label)).join(',');
    const lines = rows.map((r) => BULK_CSV_COLUMNS.map(([, key]) => escapeCsvField(r[key])).join(','));
    const csv = '\uFEFF' + [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-assets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function handleBulkRetire() {
    if (!window.confirm(`Retire ${selectedIds.size} selected asset(s)? Any active assignment/repair will be closed out, same as retiring one at a time.`)) return;
    setBulkRetiring(true);
    const ids = Array.from(selectedIds);
    const outcomes = await Promise.allSettled(ids.map((id) => api.setAssetStatus(id, 'retired')));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    setBulkRetiring(false);
    clearSelection();
    await loadAssets();
    loadSummary();
    if (failed) showToast(`${ids.length - failed} retired, ${failed} failed.`, 'error');
    else showToast(`${ids.length} asset(s) retired.`);
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Permanently delete ${selectedIds.size} selected asset(s)? This cannot be undone.`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const outcomes = await Promise.allSettled(ids.map((id) => api.deleteAsset(id)));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    setBulkDeleting(false);
    clearSelection();
    await loadAssets();
    loadSummary();
    if (failed) showToast(`${ids.length - failed} deleted, ${failed} failed.`, 'error');
    else showToast(`${ids.length} asset(s) deleted.`);
  }

  // Assigns the SAME employee/holder to every selected asset in one
  // go — e.g. handing out 5 laptops from one batch to the same new
  // hire without repeating "Assign" 5 times. Each asset is assigned
  // independently server-side (no partial-batch transaction), so one
  // asset that's no longer Available fails without blocking the rest.
  async function handleBulkAssign(ids, data) {
    const outcomes = await Promise.allSettled(ids.map((id) => api.assignAsset(id, data)));
    const succeeded = outcomes.filter((o) => o.status === 'fulfilled').length;
    const failed = outcomes.length - succeeded;
    clearSelection();
    await loadAssets();
    loadSummary();
    loadEmployees();
    if (failed) showToast(`${succeeded} assigned, ${failed} failed.`, failed === outcomes.length ? 'error' : 'success');
    else showToast(`${succeeded} asset(s) assigned.`);
    return { succeeded, failed };
  }

  // Downloads every selected asset's QR code as one printable page
  // (browser's own "Print > Save as PDF" gives a combined PDF with no
  // extra library needed) rather than triggering N separate PNG
  // downloads, which most browsers block/clutter for more than a
  // couple of files anyway.
  async function handleBulkDownloadQr() {
    setBulkQrLoading(true);
    try {
      const targets = assets.filter((a) => selectedIds.has(a.id));
      const withImages = await Promise.all(targets.map(async (a) => {
        const blob = await api.getAssetQrCode(a.id);
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        return { asset: a, dataUrl };
      }));

      const win = window.open('', '_blank');
      win.document.write(`<!DOCTYPE html><html><head><title>Asset QR Codes</title><style>
        body { font-family: -apple-system, sans-serif; margin: 24px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px; }
        .card { text-align: center; page-break-inside: avoid; }
        .card img { width: 160px; height: 160px; }
        .card p { font-size: 12px; margin: 6px 0 0; }
      </style></head><body>
        <div class="grid">
          ${withImages.map(({ asset, dataUrl }) => `
            <div class="card">
              <img src="${dataUrl}" alt="QR" />
              <p><strong>${asset.asset_name}</strong></p>
              <p>${asset.asset_tag || ''}</p>
            </div>
          `).join('')}
        </div>
        <script>window.onload = () => window.print();</script>
      </body></html>`);
      win.document.close();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBulkQrLoading(false);
    }
  }

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-7xl space-y-6 px-6 py-6'}>
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={onBack} title="Back to dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Inventory Management</h2>
            <p className="text-sm text-slate-500">Hardware, AMC contracts, and employee assignment lifecycles.</p>
          </div>
        </div>
      )}

      {/* Stat strip */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <StatCard label="Total assets" value={summary.total} />
          <StatCard label="Available" value={summary.available_count} accent="text-green-700" />
          <StatCard label="In Use" value={summary.in_use_count} accent="text-blue-700" />
          <StatCard label="Under Repair" value={summary.under_repair_count} accent="text-amber-700" />
          <StatCard label="AMC expiring soon" value={summary.amc_expiring_count} accent="text-purple-700" alert={summary.amc_expiring_count > 0} />
          <StatCard label="Maintenance & AMC Spend"
            value={currency(Number(summary.total_repair_spend || 0) + Number(summary.total_amc_spend || 0))}
            accent="text-slate-900" />
        </div>
      )}

      <>
          {/* Search + filter + add */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset, vendor, or serial…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                <option value="">All statuses</option>
                {Object.entries(ASSET_STATUS_STYLES).map(([value, { label }]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExport} disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60">
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV
              </button>
              {isAdmin && (
                <button onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  <UploadCloud size={16} /> Import CSV
                </button>
              )}
              <button onClick={() => setShowAssetForm(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
                <Plus size={16} /> New Asset
              </button>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5">
              <span className="text-sm font-medium text-brand-700">{selectedIds.size} selected</span>
              <button onClick={() => setShowBulkAssign(true)}
                title={assignableSelectedAssets.length > 0 ? undefined : 'None of the selected assets are currently Available'}
                disabled={assignableSelectedAssets.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                <UserPlus size={13} /> Assign selected
              </button>
              <button onClick={handleBulkDownloadQr} disabled={bulkQrLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-60">
                {bulkQrLoading ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />} Download QR codes
              </button>
              <button onClick={handleBulkExport}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors">
                <Download size={13} /> Export selected
              </button>
              {isAdmin && (
                <button onClick={handleBulkRetire} disabled={bulkRetiring}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm hover:bg-red-50 transition-colors disabled:opacity-60">
                  {bulkRetiring ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />} Retire selected
                </button>
              )}
              {isAdmin && (
                <button onClick={handleBulkDelete} disabled={bulkDeleting}
                  title="Permanently delete — this cannot be undone"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm hover:bg-red-50 transition-colors disabled:opacity-60">
                  {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete selected
                </button>
              )}
              <button onClick={clearSelection} className="ml-auto text-xs font-medium text-brand-600 hover:underline">
                Clear
              </button>
            </div>
          )}

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" checked={assets.length > 0 && selectedIds.size === assets.length}
                        onChange={toggleSelectAll} disabled={assets.length === 0}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    </th>
                    {['Asset', 'Vendor', 'Location', 'Purchase Date', 'Cost', 'AMC', 'Status', 'Holder', ''].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && <SkeletonTableRows columns={10} rows={5} />}
                  {!loading && assets.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                        <p>No assets match your filters.</p>
                        {!query && !statusFilter && (
                          <button onClick={() => setShowAssetForm(true)}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 transition-colors">
                            <Plus size={13} /> Add your first asset
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  {!loading && groupedAssets.map((group) => (
                    group.length > 1 ? (
                      <BatchGroupRow key={group[0].purchase_id} group={group}
                        onOpenDetail={(a) => setDetailAssetId(a.id)}
                        onAssign={(a) => setAssignTarget(a)}
                        onDispatch={(a) => setMaintenanceTarget(a)}
                        onReturn={(a) => setReturnTarget(a)}
                        onRetire={(a) => handleRetire(a)}
                        onRestore={(a) => handleRestore(a)}
                        onDelete={(a) => handleDeleteAsset(a)}
                        onModify={handleQuickModify}
                        selectedIds={selectedIds}
                        onToggleAsset={toggleAsset}
                        onToggleGroup={toggleGroup}
                      />
                    ) : (
                      <AssetRow key={group[0].id} asset={group[0]}
                        onOpenDetail={() => setDetailAssetId(group[0].id)}
                        onAssign={() => setAssignTarget(group[0])}
                        onDispatch={() => setMaintenanceTarget(group[0])}
                        onReturn={() => setReturnTarget(group[0])}
                        onRetire={() => handleRetire(group[0])}
                        onRestore={() => handleRestore(group[0])}
                        onDelete={() => handleDeleteAsset(group[0])}
                        onModify={handleQuickModify}
                        selected={selectedIds.has(group[0].id)}
                        onToggleSelect={() => toggleAsset(group[0].id)}
                      />
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      </>

      {showAssetForm && (
        <AssetFormModal mode="create" vendors={vendors} onClose={() => setShowAssetForm(false)} onSubmit={handleCreateAsset} />
      )}
      {showImportModal && (
        <ImportAssetsModal
          onClose={() => setShowImportModal(false)}
          onImported={() => { loadAssets(); loadSummary(); }}
        />
      )}
      {editingAsset && (
        <AssetFormModal mode="edit" asset={editingAsset} vendors={vendors}
          onClose={() => setEditingAsset(null)} onSubmit={handleEditAsset} />
      )}
      {assignTarget && (
        <AssignEmployeeModal asset={assignTarget} employees={employees} onClose={() => setAssignTarget(null)} onSubmit={handleAssign} />
      )}
      {showBulkAssign && (
        <BulkAssignModal assets={assignableSelectedAssets} skippedCount={selectedAssets.length - assignableSelectedAssets.length}
          employees={employees} onClose={() => setShowBulkAssign(false)} onSubmit={handleBulkAssign} />
      )}
      {maintenanceTarget && (
        <MaintenanceDispatchModal asset={maintenanceTarget} onClose={() => setMaintenanceTarget(null)} onSubmit={handleDispatch} />
      )}
      {returnTarget && (
        <ReturnAssetModal asset={returnTarget} onClose={() => setReturnTarget(null)} onSubmit={handleReturn} />
      )}
      {detailAssetId && (
        <AssetDetailDrawer
          assetId={detailAssetId}
          onClose={() => setDetailAssetId(null)}
          onEdit={(asset) => { setDetailAssetId(null); setEditingAsset(asset); }}
          onAssetChanged={applyAssetUpdate}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent = 'text-slate-900', alert = false }) {
  return (
    <div className={`rounded-xl border p-3 ${alert ? 'border-purple-200 bg-purple-50/40' : 'border-slate-200 bg-white'}`}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`font-mono text-lg font-semibold tabular-nums ${accent}`}>{value ?? '—'}</p>
    </div>
  );
}

/**
 * One collapsed row standing in for a whole bulk-order batch (e.g.
 * "10x Dell Laptop" from a single purchase) — expands into the real,
 * individually-assignable AssetRow for each unit. See InventoryPage's
 * groupedAssets for how units get grouped here, and
 * assetController.ensureAssetFromPurchase for why each unit already
 * exists as its own asset row on the backend (so assigning "just one
 * of the ten" to an employee is simply expanding and picking that
 * row — no special-cased partial-assignment logic needed anywhere).
 */
function BatchGroupRow({ group, onOpenDetail, onAssign, onDispatch, onReturn, onRetire, onRestore, onDelete, onModify, selectedIds, onToggleAsset, onToggleGroup }) {
  const [expanded, setExpanded] = useState(false);
  const first = group[0];
  const allSelected = group.every((a) => selectedIds.has(a.id));
  const someSelected = !allSelected && group.some((a) => selectedIds.has(a.id));

  const counts = group.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(counts)
    .map(([status, n]) => `${n} ${(ASSET_STATUS_STYLES[status]?.label || status).toLowerCase()}`)
    .join(' · ');

  return (
    <>
      <tr className="border-b border-slate-100 bg-brand-50/30 transition-colors hover:bg-brand-50/50">
        <td className="px-4 py-3">
          <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected; }}
            onChange={() => onToggleGroup(group)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
        </td>
        <td colSpan={9} className="px-4 py-3">
          <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center gap-2.5 text-left">
            {expanded ? <ChevronDown size={14} className="shrink-0 text-brand-600" /> : <ChevronRight size={14} className="shrink-0 text-brand-600" />}
            <Boxes size={15} className="shrink-0 text-brand-600" />
            <span className="font-medium text-slate-800">{first.asset_name}</span>
            <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">×{group.length}</span>
            <span className="truncate text-sm text-slate-500">{statusSummary}</span>
            <span className="ml-auto shrink-0 font-mono text-sm text-slate-600">{currency(first.cost)} each</span>
          </button>
        </td>
      </tr>
      {expanded && group.map((a) => (
        <AssetRow key={a.id} asset={a} nested
          onOpenDetail={() => onOpenDetail(a)}
          onAssign={() => onAssign(a)}
          onDispatch={() => onDispatch(a)}
          onReturn={() => onReturn(a)}
          onRetire={() => onRetire(a)}
          onRestore={() => onRestore(a)}
          onDelete={() => onDelete(a)}
          onModify={onModify}
          selected={selectedIds.has(a.id)}
          onToggleSelect={() => onToggleAsset(a.id)}
        />
      ))}
    </>
  );
}

/**
 * Makes AMC (Annual Maintenance Contract) status legible at a glance
 * in the table — previously this column showed raw Warranty Expiry,
 * which is a different, less operationally-relevant date (warranty is
 * still shown in the asset detail drawer, just not fighting for space
 * here). Color-coded the same way "AMC expiring" already was on the
 * asset name badge, just spelled out properly with the provider name.
 */
function AmcStatusCell({ asset: a }) {
  if (!a.amc_provider && !a.amc_end_date) {
    return <span className="text-xs text-slate-400">No AMC</span>;
  }
  const isExpired = a.amc_end_date && new Date(a.amc_end_date) < new Date();
  const tone = isExpired ? 'bg-red-50 text-red-700' : a.is_amc_expiring_soon ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700';
  const label = isExpired ? 'Expired' : a.is_amc_expiring_soon ? 'Expiring soon' : 'Active';
  return (
    <div>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
      {a.amc_provider && <p className="mt-0.5 truncate text-xs text-slate-500" title={a.amc_provider}>{a.amc_provider}</p>}
      {a.amc_end_date && <p className="text-[11px] text-slate-400">until {dateFmt(a.amc_end_date)}</p>}
    </div>
  );
}

function AssetRow({ asset: a, onOpenDetail, onAssign, onDispatch, onReturn, onRetire, onRestore, onDelete, onModify, nested = false, selected = false, onToggleSelect }) {
  const { isAdmin } = useAuth();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const holderLabel = a.status === 'in_use' ? a.current_employee_name
    : a.status === 'under_repair' ? a.current_repair_vendor
    : '—';

  // Click-to-confirm, same pattern as the delete button on the Order
  // History tab (CompletedOrderRow) — a second click within 3s
  // actually deletes, otherwise the confirm state quietly resets.
  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    onDelete();
  }

  return (
    <tr className={`group border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50 ${a.is_amc_expiring_soon ? 'bg-purple-50/40' : nested ? 'bg-slate-50/50' : ''}`}>
      <td className="px-4 py-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect}
          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
      </td>
      <td className={`px-4 py-3 ${nested ? 'pl-10' : ''}`}>
        <button onClick={onOpenDetail} className="text-left font-medium text-slate-800 hover:text-brand-600 hover:underline">
          {a.asset_name}
        </button>
        {a.asset_tag && (
          <span title="Asset tag" className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {a.asset_tag}
          </span>
        )}
        {a.purchase_id && (
          <span title="Automatically added from a delivered purchase"
            className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            <Link2 size={9} /> From purchase
          </span>
        )}
        {a.is_amc_expiring_soon && (
          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
            AMC expiring
          </span>
        )}
        {a.category && <p className="text-xs text-slate-400">{a.category}</p>}
      </td>
      <td className="px-4 py-3 text-slate-600">{a.vendor_name || '—'}</td>
      <td className="px-4 py-3 text-slate-600">{a.location || '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{dateFmt(a.purchase_date)}</td>
      <td className="relative px-4 py-3 font-mono tabular-nums text-slate-800">
        <div className="flex items-center gap-1">
          {currency(a.cost)}
          {isAdmin && <AssetModifyEditor asset={a} onSave={onModify} />}
        </div>
      </td>
      <td className="px-4 py-3"><AmcStatusCell asset={a} /></td>
      <td className="px-4 py-3"><AssetStatusBadge status={a.status} /></td>
      <td className="px-4 py-3 text-slate-600">{holderLabel || '—'}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5 whitespace-nowrap">
          {a.status === 'available' && (
            <>
              <IconAction icon={UserPlus} label="Assign" onClick={onAssign} />
              <IconAction icon={Wrench} label="Send for Repair" onClick={onDispatch} />
              {isAdmin && <IconAction icon={Archive} label="Retire" onClick={onRetire} />}
            </>
          )}
          {a.status === 'in_use' && (
            <>
              <IconAction icon={RotateCcw} label="Return Asset" onClick={onReturn} />
              <IconAction icon={Wrench} label="Send for Repair" onClick={onDispatch} />
            </>
          )}
          {a.status === 'under_repair' && (
            <IconAction icon={RotateCcw} label="Return from Repair" onClick={onReturn} />
          )}
          {a.status === 'retired' && isAdmin && (
            <IconAction icon={RefreshCw} label="Restore to Available" onClick={onRestore} />
          )}
          {isAdmin && (
            <button onClick={handleDeleteClick}
              title={confirmingDelete ? 'Click again to confirm — this cannot be undone' : 'Delete permanently'}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                confirmingDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
              }`}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function IconAction({ icon: Icon, label, onClick }) {
  return (
    <button onClick={onClick} title={label}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-600">
      <Icon size={14} />
    </button>
  );
}
