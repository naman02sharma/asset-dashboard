import { useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Wrench, Trash2, ArrowLeft, Loader2, ShieldCheck, Download, History, Pencil } from 'lucide-react';
import { api } from '../api/api.js';
import PurchaseHistoryModal from './PurchaseHistoryModal.jsx';
import { SkeletonCardRows } from './Skeleton.jsx';
import AdvancePaymentEditor from './AdvancePaymentEditor.jsx';
import SpendTrendChart from './SpendTrendChart.jsx';
import CombinedCalendarCard from './CombinedCalendarCard.jsx';
import LocationBreakdownChart from './LocationBreakdownChart.jsx';
import RecordDeliveryModal from './RecordDeliveryModal.jsx';
import EditPurchaseModal from './EditPurchaseModal.jsx';
import FilesCell from './FilesCell.jsx';
import { ApprovalPanel, CreatorApproverLine } from './ApprovalStatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PAGE_SIZE = 20;

/**
 * "Successful Order History" — every delivered purchase, permanently
 * (no 3-month expiry, unlike the Deleted Items view). Paginated
 * server-side so this stays fast even with hundreds of rows and
 * attached images — nothing beyond the current page is ever fetched.
 */
export default function CompletedOrdersPage({ vendors, locations, onBack, showToast, embedded = false, initialQuery = '', onModifyAdvancePayment, onRecordDelivery, onEditPurchase, onSummaryChange }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [vendorFilter, setVendorFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { setPage(1); }, [debouncedQuery, vendorFilter, dateFrom, dateTo]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await api.getCompleted({
          q: debouncedQuery, vendor: vendorFilter, dateFrom, dateTo, page, pageSize: PAGE_SIZE,
        });
        if (!cancelled) { setRows(data.rows); setTotal(data.total); }
      } catch (err) {
        if (!cancelled) showToast(err.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [debouncedQuery, vendorFilter, dateFrom, dateTo, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleRowUpdated(updated) {
    setRows((r) => r.map((row) => (row.id === updated.id ? updated : row)));
  }

  // A pending purchase can land here too (e.g. marked "Already
  // Delivered" at creation, before a senior/admin has reviewed it —
  // see 018_asset_approval_workflow.sql) — Order History is the only
  // place it's visible once order_status is 'delivered', so approval
  // has to be reachable from here, not just the active dashboard.
  async function handleApprovePurchase(id) {
    try {
      const updated = await api.approvePurchase(id, true);
      handleRowUpdated(updated);
      showToast('Purchase approved.');
      onSummaryChange?.();
    } catch (err) {
      showToast(err.message || 'Could not approve this purchase.', 'error');
    }
  }
  async function handleRejectPurchase(id, reason) {
    try {
      const updated = await api.approvePurchase(id, false, reason);
      handleRowUpdated(updated);
      showToast('Purchase rejected.');
      onSummaryChange?.();
    } catch (err) {
      showToast(err.message || 'Could not reject this purchase.', 'error');
    }
  }

  // These mirror the equivalent handlers in App.jsx's Dashboard — this
  // page keeps its own `rows` state (delivered purchases only, loaded
  // separately from the active-purchases list), so it needs its own
  // copies rather than sharing state, but the API calls are identical.
  async function handleUploadPhotos(id, files, onProgress) {
    const result = await api.uploadInsurancePhotos(id, files, onProgress);
    handleRowUpdated(result.purchase);
    const failed = result.results.filter((r) => !r.success);
    if (failed.length) showToast(`${failed.length} photo(s) failed to upload.`, 'error');
    return result;
  }
  async function handleUploadInvoices(id, files, onProgress) {
    const result = await api.uploadInvoices(id, files, onProgress);
    handleRowUpdated(result.purchase);
    const failed = result.results.filter((r) => !r.success);
    if (failed.length) showToast(`${failed.length} file(s) failed to upload.`, 'error');
    return result;
  }
  async function handleInsuranceToggle(id, done) {
    try {
      const updated = await api.updateInsurance(id, done);
      handleRowUpdated(updated);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
  async function handleDeleteFile(purchaseId, fileId) {
    const updated = await api.deleteFile(purchaseId, fileId);
    handleRowUpdated(updated);
  }

  async function handleDelete(id) {
    try {
      await api.deletePurchase(id, 'permanent');
      setRows((r) => r.filter((row) => row.id !== id));
      setTotal((t) => t - 1);
      showToast('Purchase permanently deleted.');
      // This purchase (and, per purchaseController.deletePurchase, every
      // Inventory asset it created) is gone — the Home Dashboard's KPI
      // cards (total spend, pending-deliveries amount, etc.) were computed
      // including it, so they need refreshing too, not just this page's
      // own row list. Same reasoning applies to scheduling/editing
      // maintenance in ExpandedDetails below — both call this. Optional
      // because this page can also be used standalone in tests/
      // storybook-style contexts without App.jsx's wiring — harmless to
      // skip there.
      onSummaryChange?.();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Exports every matching row, not just the current page — see
      // exportCompletedOrders in the backend controller.
      await api.exportCompleted({ q: debouncedQuery, vendor: vendorFilter, dateFrom, dateTo });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-7xl space-y-6 px-6 py-6'}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {!embedded && (
            <button onClick={onBack} title="Back to dashboard"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 transition-all">
              <ArrowLeft size={16} />
            </button>
          )}
          <div>
            {!embedded && <h2 className="text-lg font-semibold text-slate-900">Successful Order History</h2>}
            <p className="text-sm text-slate-500">{total} delivered purchase{total === 1 ? '' : 's'}</p>
          </div>
        </div>
        <button onClick={handleExport} disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60">
          {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <SpendTrendChart />
        {/* Spans 2 of 4 columns -- this card carries what used to be
            two separate calendars' worth of information (orders +
            maintenance/AMC/warranty events combined, see
            CombinedCalendarCard.jsx), so it gets more room than a
            single 1/4-width slot would give it. */}
        <div className="lg:col-span-2">
          <CombinedCalendarCard showToast={showToast} />
        </div>
        <LocationBreakdownChart />
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search asset or vendor…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </div>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
          <option value="">All vendors</option>
          {vendors?.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-2 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          <span>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-2 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {loading && <SkeletonCardRows rows={4} />}

        {!loading && rows.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-slate-400">
            No completed orders match your filters.
          </div>
        )}

        {!loading && rows.map((p) => (
          <CompletedOrderRow
            key={p.id}
            purchase={p}
            expanded={expandedId === p.id}
            onToggleExpand={() => setExpandedId(expandedId === p.id ? null : p.id)}
            onUpdated={handleRowUpdated}
            onDelete={handleDelete}
            showToast={showToast}
            onModifyAdvancePayment={onModifyAdvancePayment ? async (id, amt) => handleRowUpdated(await onModifyAdvancePayment(id, amt)) : null}
            onRecordDelivery={onRecordDelivery ? async (id, data) => handleRowUpdated(await onRecordDelivery(id, data)) : null}
            onEditPurchase={onEditPurchase ? async (id, form) => handleRowUpdated(await onEditPurchase(id, form)) : null}
            onApprovePurchase={handleApprovePurchase}
            onRejectPurchase={handleRejectPurchase}
            vendors={vendors}
            locations={locations}
            onUploadPhotos={handleUploadPhotos}
            onUploadInvoices={handleUploadInvoices}
            onInsuranceToggle={handleInsuranceToggle}
            onDeleteFile={handleDeleteFile}
            onSummaryChange={onSummaryChange}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 transition-all">
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 transition-all">
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function CompletedOrderRow({ purchase: p, expanded, onToggleExpand, onUpdated, onDelete, showToast, onModifyAdvancePayment, onRecordDelivery, onEditPurchase, onApprovePurchase, onRejectPurchase, vendors, locations, onUploadPhotos, onUploadInvoices, onInsuranceToggle, onDeleteFile, onSummaryChange }) {
  const { canEdit, isAdmin, canApprove } = useAuth();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const isPartial = p.order_status === 'partially_delivered';

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 3000); // auto-cancel the confirm state
      return;
    }
    onDelete(p.id);
  }

  return (
    <div className="group rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/10">
      <div className="flex items-center gap-4 px-4 py-3">
        <button onClick={onToggleExpand} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="font-medium text-slate-800">{p.item_name}</p>
            {p.insurance_done && <ShieldCheck size={13} className="text-green-600" title="Insured" />}
            {isPartial && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                {p.delivered_quantity} of {p.quantity} delivered
              </span>
            )}
            {p.is_maintenance_due && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Wrench size={9} /> Maintenance due
              </span>
            )}
            {p.amount_remaining > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                {currency(p.amount_remaining)} due
              </span>
            )}
            {p.amount_remaining < 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                Overpaid {currency(Math.abs(p.amount_remaining))}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {p.vendor_name} · {isPartial ? `Started ${dateFmt(p.order_date)}` : `Delivered ${dateFmt(p.actual_delivery_date)}`} · {p.delivery_location || 'No location'}{p.po_number ? ` · PO ${p.po_number}` : ''}
          </p>
        </button>
        <div className="relative flex items-center gap-1">
          <p className="font-mono text-sm tabular-nums text-slate-700">{currency(p.total_cost_with_tax ?? p.total_cost)}</p>
          {/* Delivered but not fully paid — the same "Modify" control
              used on the Home Dashboard, so payment corrections don't
              require reopening a delivered purchase's status. Saving
              here also refreshes the KPI cards up top (see
              onModifyAdvancePayment plumbing in App.jsx). Admin-only,
              same as the backend endpoint it calls.
              Shown whenever the balance isn't exactly settled — that
              includes overpaid (amount_remaining < 0), not just money
              still due — otherwise an overpaid delivered order has no
              way to be corrected: delivered purchases live only here,
              not on the active dashboard, so this is the only place
              the control could ever be reached from. */}
          {canEdit && p.amount_remaining !== 0 && onModifyAdvancePayment && (
            <AdvancePaymentEditor purchase={p} onSave={onModifyAdvancePayment} />
          )}
        </div>
        {isPartial && onRecordDelivery && (
          <button onClick={() => setShowDelivery(true)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors">
            Record delivery
          </button>
        )}
        <button onClick={onToggleExpand}
          className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 transition-colors">
          {expanded ? 'Hide' : 'Manage'}
        </button>
        {canEdit && onEditPurchase && (
          <button onClick={() => setShowEdit(true)}
            title="Edit purchase"
            className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-slate-100 hover:text-brand-600">
            <Pencil size={15} />
          </button>
        )}
        <button onClick={() => setShowHistory(true)}
          title="View history"
          className="rounded-lg p-2 text-slate-300 transition-colors hover:bg-slate-100 hover:text-brand-600">
          <History size={15} />
        </button>
        {isAdmin && (
          <button onClick={handleDeleteClick}
            title="Delete permanently — this cannot be undone"
            className={`rounded-lg p-2 transition-colors ${confirmingDelete ? 'bg-red-600 text-white' : 'text-slate-300 hover:bg-red-50 hover:text-red-600'}`}>
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="px-4 pb-3">
        <CreatorApproverLine item={p} />
        <ApprovalPanel item={p} canApprove={canApprove} onApprove={onApprovePurchase} onReject={onRejectPurchase} />
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          <ExpandedDetails purchase={p} onUpdated={onUpdated} showToast={showToast}
            onUploadPhotos={onUploadPhotos} onUploadInvoices={onUploadInvoices}
            onInsuranceToggle={onInsuranceToggle} onDeleteFile={onDeleteFile} onSummaryChange={onSummaryChange} />
        </div>
      )}

      {showHistory && (
        <PurchaseHistoryModal purchaseId={p.id} itemName={p.item_name} onClose={() => setShowHistory(false)} />
      )}

      {showDelivery && (
        <RecordDeliveryModal purchase={p} onClose={() => setShowDelivery(false)} onSubmit={onRecordDelivery} />
      )}

      {showEdit && (
        <EditPurchaseModal
          purchase={p}
          vendors={vendors}
          locations={locations}
          onClose={() => setShowEdit(false)}
          onSubmit={(form) => onEditPurchase(p.id, form)}
        />
      )}
    </div>
  );
}

function ExpandedDetails({ purchase: p, onUpdated, showToast, onUploadPhotos, onUploadInvoices, onInsuranceToggle, onDeleteFile, onSummaryChange }) {
  const [maintDate, setMaintDate] = useState(p.maintenance_date || '');
  const [maintCost, setMaintCost] = useState(p.maintenance_cost ?? '');
  const [recurring, setRecurring] = useState(!!p.maintenance_recurring);
  const [periodMonths, setPeriodMonths] = useState(p.maintenance_period_months || 6);
  const [saving, setSaving] = useState(false);

  async function handleSaveMaintenance() {
    setSaving(true);
    try {
      const updated = await api.scheduleMaintenance(p.id, {
        maintenance_date: maintDate || null,
        maintenance_recurring: recurring,
        maintenance_period_months: recurring ? periodMonths : null,
        maintenance_cost: maintCost === '' ? null : maintCost,
      });
      onUpdated(updated);
      // Scheduling/editing this changes upcoming_maintenance_cost —
      // the Home Dashboard's "Upcoming Maintenance Cost" KPI card was
      // computed before this save, so it needs refreshing too. Same
      // reasoning as onSummaryChange in handleDelete above.
      onSummaryChange?.();
      showToast('Maintenance schedule saved.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = 'rounded-lg border border-slate-200 bg-white py-1.5 px-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-1 text-xs text-slate-500">
        <p><span className="font-medium text-slate-600">Description:</span> {p.description || '—'}</p>
        <p><span className="font-medium text-slate-600">Vendor GST:</span> {p.vendor_gst_number || '—'}</p>
        <p><span className="font-medium text-slate-600">Vendor address:</span> {p.vendor_address || '—'}</p>
        <p><span className="font-medium text-slate-600">Vendor phone:</span> {p.vendor_phone || '—'}</p>
        <p><span className="font-medium text-slate-600">Location GST:</span> {p.delivery_location_gst_number || '—'}</p>
        <p><span className="font-medium text-slate-600">Paid:</span> {currency(p.amount_paid)} of {currency(p.total_cost_with_tax ?? p.total_cost)}</p>
        <div className="pt-1.5">
          <p className="mb-1 font-medium text-slate-600">Insurance &amp; invoice files:</p>
          <FilesCell purchase={p} onToggleInsurance={onInsuranceToggle}
            onUploadPhotos={onUploadPhotos} onUploadInvoices={onUploadInvoices} onDeleteFile={onDeleteFile} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Maintenance schedule</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Next maintenance date</label>
            <input type="date" value={maintDate} onChange={(e) => setMaintDate(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Est. cost (₹)</label>
            <input type="number" min="0" step="0.01" value={maintCost} onChange={(e) => setMaintCost(e.target.value)}
              className={`${fieldClass} w-24`} placeholder="Optional" />
          </div>
          <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Recurring
          </label>
          {recurring && (
            <div>
              <label className="mb-0.5 block text-[11px] text-slate-400">Every (months)</label>
              <input type="number" min="1" value={periodMonths} onChange={(e) => setPeriodMonths(Number(e.target.value))}
                className={`${fieldClass} w-16`} />
            </div>
          )}
        </div>
        <button onClick={handleSaveMaintenance} disabled={saving}
          className="mt-3 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:from-brand-600 hover:to-brand-700 disabled:opacity-60 transition-all active:scale-95">
          {saving ? 'Saving…' : 'Save maintenance schedule'}
        </button>
        <p className="mt-1 text-[11px] text-slate-400">
          A "Maintenance" alert appears on the Home Dashboard 7 days before the date above.
        </p>
      </div>
    </div>
  );
}
