import { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Search, UserPlus, RotateCcw, Wrench, Archive, RefreshCw, Download, Loader2, Link2, ChevronDown, ChevronRight, Boxes, UploadCloud, QrCode, Trash2, Pencil, ShieldCheck } from 'lucide-react';
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
import BulkAmcWarrantyModal from './BulkAmcWarrantyModal.jsx';
import { ApprovalPanel, CreatorApproverLine } from './ApprovalStatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import FilesCell from './FilesCell.jsx';

const currency = (n) =>
  n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function InventoryPage({ vendors, locations, onBack, showToast, embedded = false, initialQuery = '', onSummaryChange, onInsuranceToggle, onUploadPhotos, onUploadInvoices, onDeleteFile }) {
  const { canEdit, isAdmin, canApprove } = useAuth();

  const [assets, setAssets] = useState([]);

  /**
   * Patches every asset in a purchase batch with fresh insurance/
   * invoice data after a mutation, so the row(s) update immediately —
   * without a full refetch — the instant a document is uploaded,
   * deleted, or insurance is toggled. purchase_id is shared across a
   * whole bulk order, so one purchase-level change here can affect
   * several rows at once, same as it affects every row on the Order
   * History side that shares that purchase.
   */
  function patchAssetsForPurchase(purchaseId, updatedPurchase) {
    if (!updatedPurchase) return;
    setAssets((rows) => rows.map((a) => (
      a.purchase_id === purchaseId
        ? {
            ...a,
            purchase_insurance_done: updatedPurchase.insurance_done,
            purchase_insurance_photos: updatedPurchase.insurance_photos,
            purchase_invoices: updatedPurchase.invoices,
          }
        : a
    )));
  }

  // These four wrap the handlers passed down from App.jsx (the SAME
  // ones Order History/Purchases use — one purchase record, one set
  // of endpoints) and additionally patch this page's own local
  // `assets` state, since Inventory fetches its rows from a separate
  // endpoint (asset_summary) rather than sharing App.jsx's `purchases`
  // array. Because both pages read/write the exact same underlying
  // purchase + purchase_files rows, a change made here is already
  // true in the database the moment Order History next loads it —
  // this local patch just avoids waiting on a refetch to see it here.
  async function handleInsuranceToggleLocal(purchaseId, done) {
    const updated = await onInsuranceToggle(purchaseId, done);
    patchAssetsForPurchase(purchaseId, updated);
  }
  async function handleUploadPhotosLocal(purchaseId, files, onProgress) {
    const result = await onUploadPhotos(purchaseId, files, onProgress);
    patchAssetsForPurchase(purchaseId, result?.purchase);
    return result;
  }
  async function handleUploadInvoicesLocal(purchaseId, files, onProgress) {
    const result = await onUploadInvoices(purchaseId, files, onProgress);
    patchAssetsForPurchase(purchaseId, result?.purchase);
    return result;
  }
  async function handleDeleteFileLocal(purchaseId, fileId) {
    const updated = await onDeleteFile(purchaseId, fileId);
    patchAssetsForPurchase(purchaseId, updated);
  }

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
  const [showBulkAmcWarranty, setShowBulkAmcWarranty] = useState(false);
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
    // Keep the dashboard's own KPI cards (Total Asset Purchase Value
    // etc.) in sync too — every mutation here that touches this
    // page's own stat strip (create/edit/delete an asset, bulk
    // retire/delete, CSV import) is exactly the same set of events
    // that can change what those cards should show, since Total Asset
    // Purchase Value is now sourced straight from the assets table
    // (see purchaseController.getPurchaseSummary).
    onSummaryChange?.();
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

  // Admin/senior approve or reject a pending asset (see
  // 018_asset_approval_workflow.sql / ApprovalStatusBadge.jsx) —
  // mirrors App.jsx's handleApprovePurchase/handleRejectPurchase for
  // the purchases side.
  async function handleApproveAsset(id) {
    try {
      const updated = await api.approveAsset(id, true);
      applyAssetUpdate(updated);
      showToast('Asset approved.');
    } catch (err) {
      showToast(err.message || 'Could not approve this asset.', 'error');
    }
  }

  async function handleRejectAsset(id, reason) {
    try {
      const updated = await api.approveAsset(id, false, reason);
      applyAssetUpdate(updated);
      showToast('Asset rejected.');
    } catch (err) {
      showToast(err.message || 'Could not reject this asset.', 'error');
    }
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
    ['Asset Name', 'asset_name'], ['Category', 'category'], ['Serial Number', 'serial_number'], ['Model Number', 'model_number'],
    ['Asset Tag', 'asset_tag'], ['Location', 'location'], ['Vendor', 'vendor_name'],
    ['Cost', 'cost'], ['Tax %', 'tax_percent'], ['Cost (incl. Tax)', 'cost_with_tax'], ['Status', 'status'],
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

  // Applies the same AMC/warranty fields to every selected asset —
  // each one is a normal PATCH /assets/:id (same endpoint + change-log
  // behavior as editing one asset by hand), just fired for every
  // selected id. Independent per-asset, same as handleBulkAssign, so
  // one failure doesn't block the rest.
  async function handleBulkAmcWarranty(ids, data) {
    const outcomes = await Promise.allSettled(ids.map((id) => api.updateAsset(id, data)));
    const succeeded = outcomes.filter((o) => o.status === 'fulfilled').length;
    const failed = outcomes.length - succeeded;
    clearSelection();
    await loadAssets();
    loadSummary();
    if (failed) showToast(`${succeeded} updated, ${failed} failed.`, failed === outcomes.length ? 'error' : 'success');
    else showToast(`${succeeded} asset(s) updated.`);
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
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 transition-all">
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
              {canEdit && (
                <button onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  <UploadCloud size={16} /> Import CSV
                </button>
              )}
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
              {canEdit && (
                <button onClick={() => setShowBulkAmcWarranty(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors">
                  <ShieldCheck size={13} /> AMC / Warranty
                </button>
              )}
              {canEdit && (
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
            {/* Both scrollbars (x and y) live on THIS div, bounded to a viewport-relative
                max-height, so they always sit at the edges of a box that's on screen —
                no more scrolling the whole page down/right just to reach a scrollbar. */}
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
                    <th className="w-10 px-4 py-3">
                      <input type="checkbox" checked={assets.length > 0 && selectedIds.size === assets.length}
                        onChange={toggleSelectAll} disabled={assets.length === 0}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    </th>
                    {['Asset', 'Vendor', 'Location', 'Purchase Date', 'Cost', 'Warranty', 'AMC', 'Status', 'Holder', 'Documents', ''].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 font-medium text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && <SkeletonTableRows columns={12} rows={5} />}
                  {!loading && assets.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-10 text-center text-slate-400">
                        <p>No assets match your filters.</p>
                        {!query && !statusFilter && (
                          <p className="mt-1 text-xs text-slate-400">
                            New assets are added from the Purchases page — delivered purchases flow into Inventory automatically.
                          </p>
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
                        onEdit={(a) => setEditingAsset(a)}
                        onModify={handleQuickModify}
                        onApprove={handleApproveAsset}
                        onReject={handleRejectAsset}
                        selectedIds={selectedIds}
                        onToggleAsset={toggleAsset}
                        onToggleGroup={toggleGroup}
                        onToggleInsurance={handleInsuranceToggleLocal}
                        onUploadPhotos={handleUploadPhotosLocal}
                        onUploadInvoices={handleUploadInvoicesLocal}
                        onDeleteFile={handleDeleteFileLocal}
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
                        onEdit={() => setEditingAsset(group[0])}
                        onModify={handleQuickModify}
                        onApprove={handleApproveAsset}
                        onReject={handleRejectAsset}
                        selected={selectedIds.has(group[0].id)}
                        onToggleSelect={() => toggleAsset(group[0].id)}
                        onToggleInsurance={handleInsuranceToggleLocal}
                        onUploadPhotos={handleUploadPhotosLocal}
                        onUploadInvoices={handleUploadInvoicesLocal}
                        onDeleteFile={handleDeleteFileLocal}
                      />
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </div>
      </>

      {showImportModal && (
        <ImportAssetsModal
          onClose={() => setShowImportModal(false)}
          onImported={() => { loadAssets(); loadSummary(); }}
        />
      )}
      {editingAsset && (
        <AssetFormModal mode="edit" asset={editingAsset} vendors={vendors} locations={locations}
          onClose={() => setEditingAsset(null)} onSubmit={handleEditAsset} onAssetChanged={applyAssetUpdate} showToast={showToast} />
      )}
      {assignTarget && (
        <AssignEmployeeModal asset={assignTarget} employees={employees} locations={locations} onClose={() => setAssignTarget(null)} onSubmit={handleAssign} />
      )}
      {showBulkAssign && (
        <BulkAssignModal assets={assignableSelectedAssets} skippedCount={selectedAssets.length - assignableSelectedAssets.length}
          employees={employees} locations={locations} onClose={() => setShowBulkAssign(false)} onSubmit={handleBulkAssign} />
      )}
      {showBulkAmcWarranty && (
        <BulkAmcWarrantyModal assets={selectedAssets} onClose={() => setShowBulkAmcWarranty(false)} onSubmit={handleBulkAmcWarranty} />
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
function BatchGroupRow({ group, onOpenDetail, onAssign, onDispatch, onReturn, onRetire, onRestore, onDelete, onEdit, onModify, onApprove, onReject, selectedIds, onToggleAsset, onToggleGroup, onToggleInsurance, onUploadPhotos, onUploadInvoices, onDeleteFile }) {
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
        <td colSpan={11} className="px-4 py-3">
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
          onEdit={() => onEdit(a)}
          onModify={onModify}
          onApprove={onApprove}
          onReject={onReject}
          selected={selectedIds.has(a.id)}
          onToggleSelect={() => onToggleAsset(a.id)}
          onToggleInsurance={onToggleInsurance}
          onUploadPhotos={onUploadPhotos}
          onUploadInvoices={onUploadInvoices}
          onDeleteFile={onDeleteFile}
        />
      ))}
    </>
  );
}

/**
 * Warranty column — same color-coded "Active / Expiring soon /
 * Expired" pattern as AmcStatusCell right below, just for
 * warranty_expiry instead of amc_end_date. Added alongside the AMC
 * column rather than replacing it — the two dates are genuinely
 * different concepts (manufacturer warranty vs. a paid service
 * contract) and both are now visible at a glance in the table.
 */
function WarrantyStatusCell({ asset: a }) {
  if (!a.warranty_expiry) {
    return <span className="text-xs text-slate-400">No warranty</span>;
  }
  const isExpired = new Date(a.warranty_expiry) < new Date();
  const tone = isExpired ? 'bg-red-50 text-red-700' : a.is_warranty_expiring_soon ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700';
  const label = isExpired ? 'Expired' : a.is_warranty_expiring_soon ? 'Expiring soon' : 'Active';
  return (
    <div>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span>
      <p className="text-[11px] text-slate-400">until {dateFmt(a.warranty_expiry)}</p>
    </div>
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

function AssetRow({ asset: a, onOpenDetail, onAssign, onDispatch, onReturn, onRetire, onRestore, onDelete, onEdit, onModify, onApprove, onReject, nested = false, selected = false, onToggleSelect, onToggleInsurance, onUploadPhotos, onUploadInvoices, onDeleteFile }) {
  const { canEdit, isAdmin, canApprove } = useAuth();
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
        <CreatorApproverLine item={a} />
        <ApprovalPanel item={a} canApprove={canApprove} onApprove={onApprove} onReject={onReject} />
      </td>
      <td className="px-4 py-3 text-slate-600">{a.vendor_name || '—'}</td>
      <td className="px-4 py-3 text-slate-600">{a.location || '—'}</td>
      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{dateFmt(a.purchase_date)}</td>
      <td className="relative px-4 py-3 font-mono tabular-nums text-slate-800">
        <div className="flex items-center gap-1">
          {currency(a.cost)}
          {canEdit && <AssetModifyEditor asset={a} onSave={onModify} />}
        </div>
      </td>
      <td className="px-4 py-3"><WarrantyStatusCell asset={a} /></td>
      <td className="px-4 py-3"><AmcStatusCell asset={a} /></td>
      <td className="px-4 py-3"><AssetStatusBadge status={a.status} /></td>
      <td className="px-4 py-3 text-slate-600">{holderLabel || '—'}</td>
      <td className="px-4 py-3">
        {a.purchase_id ? (
          <FilesCell
            purchase={{
              id: a.purchase_id,
              insurance_done: a.purchase_insurance_done,
              insurance_photos: a.purchase_insurance_photos || [],
              invoices: a.purchase_invoices || [],
            }}
            onToggleInsurance={onToggleInsurance}
            onUploadPhotos={onUploadPhotos}
            onUploadInvoices={onUploadInvoices}
            onDeleteFile={onDeleteFile}
          />
        ) : (
          <span className="text-xs text-slate-400" title="Manually added — not linked to a purchase">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1.5 whitespace-nowrap">
          {a.status === 'available' && (
            <>
              <IconAction icon={UserPlus} label="Assign" onClick={onAssign} />
              <IconAction icon={Wrench} label="Send for Repair" onClick={onDispatch} />
              {canEdit && <IconAction icon={Archive} label="Retire" onClick={onRetire} />}
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
          {a.status === 'retired' && canEdit && (
            <IconAction icon={RefreshCw} label="Restore to Available" onClick={onRestore} />
          )}
          {canEdit && <IconAction icon={Pencil} label="Edit" onClick={onEdit} />}
          {isAdmin && (
            <button onClick={handleDeleteClick}
              title={confirmingDelete ? 'Click again to confirm — this cannot be undone' : 'Delete permanently'}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                confirmingDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
              }`}>
              <Trash2 size={16} strokeWidth={2.3} />
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
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:scale-105 hover:bg-slate-100 hover:text-brand-600">
      <Icon size={16} strokeWidth={2.3} />
    </button>
  );
}