import { useState } from 'react';
import { ArrowUpDown, AlertTriangle, Trash2, Wrench, CheckCircle2, Loader2, History, Pencil } from 'lucide-react';
import { StatusSelect } from './StatusBadge.jsx';
import FilesCell from './FilesCell.jsx';
import AdvancePaymentEditor from './AdvancePaymentEditor.jsx';
import PurchaseHistoryModal from './PurchaseHistoryModal.jsx';
import RecordDeliveryModal from './RecordDeliveryModal.jsx';
import EditPurchaseModal from './EditPurchaseModal.jsx';
import { SkeletonTableRows } from './Skeleton.jsx';
import { ApprovalPanel, CreatorApproverLine } from './ApprovalStatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const BASE_COLUMNS = [
  { key: 'item_name', label: 'Asset' },
  { key: 'po_number', label: 'PO Number' },
  { key: 'vendor_name', label: 'Vendor' },
  { key: 'order_date', label: 'Purchase Date' },
  { key: 'quantity', label: 'Qty' },
  { key: 'total_cost', label: 'Total Cost' },
  { key: 'amount_paid', label: 'Paid' },
  { key: 'amount_remaining', label: 'Remaining' },
  { key: 'expected_delivery_date', label: 'Expected Delivery' },
  { key: 'delivery_location', label: 'Location' },
  { key: 'order_status', label: 'Status' },
];
const MAINTENANCE_COLUMN = { key: null, label: 'Maintenance' }; // not sortable — only shown when relevant, see below
const TRAILING_COLUMNS = [
  { key: null, label: 'Insurance' }, // not sortable — has its own upload UI
  { key: null, label: '' },          // actions column — not sortable
];

const SORTABLE_KEYS = new Set([
  'item_name', 'vendor_name', 'quantity', 'total_cost',
  'amount_paid', 'amount_remaining', 'expected_delivery_date', 'order_status',
]);

/**
 * Clicking a column header toggles sort on that column — this is in
 * addition to the sort <select> in FilterBar, so power users can sort
 * inline without leaving the table.
 */
export default function PurchaseTable({
  purchases, sort, onSortChange, loading, vendors, locations,
  onStatusChange, onDeleteClick,
  onInsuranceToggle, onUploadPhotos, onUploadInvoices, onDeleteFile,
  onModifyAdvancePayment, onCompleteMaintenance, onRecordDelivery, onEditPurchase,
  onApprovePurchase, onRejectPurchase,
}) {
  const { canEdit, isAdmin, canApprove } = useAuth();
  const [sortBy, sortDir] = sort.split(':');
  const [updatingId, setUpdatingId] = useState(null);
  const [completingId, setCompletingId] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null); // purchase | null
  const [deliveryTarget, setDeliveryTarget] = useState(null); // purchase | null
  const [editTarget, setEditTarget] = useState(null); // purchase | null

  // Only show the Maintenance column at all if at least one visible
  // purchase actually has something to show there — a plain "not
  // applicable" product shouldn't burn table width on an empty column.
  const showMaintenanceColumn = purchases.some((p) => p.is_maintenance_due);
  const COLUMNS = showMaintenanceColumn
    ? [...BASE_COLUMNS, MAINTENANCE_COLUMN, ...TRAILING_COLUMNS]
    : [...BASE_COLUMNS, ...TRAILING_COLUMNS];

  async function handleStatusChange(id, newStatus) {
    setUpdatingId(id);
    try {
      await onStatusChange(id, newStatus);
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleCompleteMaintenance(id) {
    setCompletingId(id);
    try {
      await onCompleteMaintenance(id);
    } finally {
      setCompletingId(null);
    }
  }

  function handleHeaderClick(key) {
    if (!key || !SORTABLE_KEYS.has(key)) return;
    const nextDir = sortBy === key && sortDir === 'asc' ? 'desc' : 'asc';
    onSortChange(`${key}:${nextDir}`);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1560px] text-left text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
              {COLUMNS.map((col) => (
                <th
                  key={col.label || 'actions'}
                  onClick={() => handleHeaderClick(col.key)}
                  className={`whitespace-nowrap px-5 py-4 font-medium text-slate-500 ${col.key ? 'cursor-pointer select-none hover:text-slate-700 transition-colors' : ''}`}
                >
                  {col.key ? (
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowUpDown size={12} className={sortBy === col.key ? 'text-brand-600' : 'text-slate-300'} />
                    </span>
                  ) : col.label ? (
                    col.label
                  ) : (
                    <span className="sr-only">Actions</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonTableRows columns={COLUMNS.length} rows={5} />}

            {!loading && purchases.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-slate-400">No purchases match your filters.</td></tr>
            )}

            {!loading && purchases.map((p) => {
              const paidPct = p.total_cost > 0 ? Math.min(100, (p.amount_paid / p.total_cost) * 100) : 0;
              return (
                <tr key={p.id}
                  className={`group border-b border-slate-100 last:border-0 transition-colors duration-200 ${
                    p.is_maintenance_due ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <p className="font-medium text-slate-800">{p.item_name}</p>
                      {p.is_maintenance_due && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                          <Wrench size={9} /> Maintenance
                        </span>
                      )}
                    </div>
                    {p.description && <p className="text-xs text-slate-400 line-clamp-1">{p.description}</p>}
                    <CreatorApproverLine item={p} />
                    <ApprovalPanel item={p} canApprove={canApprove} onApprove={onApprovePurchase} onReject={onRejectPurchase} />
                  </td>
                  <td className="px-5 py-4 text-slate-500">{p.po_number || '—'}</td>
                  <td className="px-5 py-4 text-slate-600">{p.vendor_name}</td>
                  <td className="px-5 py-4 whitespace-nowrap text-slate-600">{dateFmt(p.order_date)}</td>
                  <td className="px-5 py-4">
                    <p className="font-mono tabular-nums text-slate-600">
                      {p.quantity > 1 ? `${p.delivered_quantity} / ${p.quantity}` : p.quantity}
                    </p>
                    {p.quantity > 1 && p.delivered_quantity < p.quantity && (
                      <button onClick={() => setDeliveryTarget(p)}
                        className="mt-0.5 text-[11px] font-medium text-brand-600 hover:underline">
                        Record delivery
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-4 font-mono tabular-nums text-slate-800">{currency(p.total_cost)}</td>
                  <td className="relative px-5 py-4 font-mono tabular-nums text-green-700">
                    <div className="flex items-center gap-1">
                      {currency(p.amount_paid)}
                      {canEdit && <AdvancePaymentEditor purchase={p} onSave={onModifyAdvancePayment} />}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    {p.amount_remaining < 0 ? (
                      <p className="font-mono tabular-nums text-amber-600" title="More has been recorded as paid than this order's total cost">
                        Overpaid {currency(Math.abs(p.amount_remaining))}
                      </p>
                    ) : (
                      <p className={`font-mono tabular-nums ${p.amount_remaining > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                        {currency(p.amount_remaining)}
                      </p>
                    )}
                    <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${paidPct}%` }} />
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`whitespace-nowrap ${p.is_overdue ? 'text-red-700 font-medium' : 'text-slate-600'}`}>
                      {dateFmt(p.expected_delivery_date)}
                    </span>
                    {p.is_overdue && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-red-600">
                        <AlertTriangle size={11} /> Overdue
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{p.delivery_location || '—'}</td>
                  <td className="px-5 py-4">
                    <StatusSelect
                      status={p.order_status}
                      disabled={updatingId === p.id}
                      onChange={(newStatus) => handleStatusChange(p.id, newStatus)}
                    />
                  </td>
                  {showMaintenanceColumn && (
                    <td className="px-5 py-4">
                      {p.is_maintenance_due ? (
                        <div>
                          <p className="text-xs text-slate-500">Due {dateFmt(p.maintenance_date)}</p>
                          <button
                            onClick={() => handleCompleteMaintenance(p.id)}
                            disabled={completingId === p.id}
                            className="mt-1 inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-60"
                          >
                            {completingId === p.id ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                            Mark Completed
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  )}
                  <td className="px-5 py-4">
                    <FilesCell
                      purchase={p}
                      onToggleInsurance={onInsuranceToggle}
                      onUploadPhotos={onUploadPhotos}
                      onUploadInvoices={onUploadInvoices}
                      onDeleteFile={onDeleteFile}
                    />
                  </td>
                  <td className="px-2 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setHistoryTarget(p)}
                        title="View history"
                        className="rounded-lg p-2 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-brand-600 group-hover:opacity-100"
                      >
                        <History size={15} />
                      </button>
                      {canEdit && onEditPurchase && (
                        <button
                          onClick={() => setEditTarget(p)}
                          title="Edit purchase"
                          className="rounded-lg p-2 text-slate-300 opacity-0 transition-all hover:bg-slate-100 hover:text-brand-600 group-hover:opacity-100"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => onDeleteClick(p)}
                          title="Delete purchase"
                          className="rounded-lg p-2 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {historyTarget && (
        <PurchaseHistoryModal
          purchaseId={historyTarget.id}
          itemName={historyTarget.item_name}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {deliveryTarget && (
        <RecordDeliveryModal
          purchase={deliveryTarget}
          onClose={() => setDeliveryTarget(null)}
          onSubmit={onRecordDelivery}
        />
      )}

      {editTarget && (
        <EditPurchaseModal
          purchase={editTarget}
          vendors={vendors}
          locations={locations}
          onClose={() => setEditTarget(null)}
          onSubmit={(form) => onEditPurchase(editTarget.id, form)}
        />
      )}
    </div>
  );
}
