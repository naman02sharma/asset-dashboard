import { Printer, X, Camera, FileText, ExternalLink } from 'lucide-react';
import { STATUS_STYLES } from './StatusBadge.jsx';
import { APPROVAL_STYLES } from './ApprovalStatusBadge.jsx';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n || 0);
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const dateTimeFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

function Field({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  );
}

function DocumentThumb({ file }) {
  const isImage = IMAGE_EXT.test(file.name || file.url || '');
  if (isImage) {
    return (
      <div className="break-inside-avoid rounded-lg border border-slate-200 p-2">
        <img src={file.url} alt={file.name} className="mx-auto max-h-64 max-w-full object-contain" />
        <p className="mt-1 truncate text-center text-[10px] text-slate-500">{file.name}</p>
      </div>
    );
  }
  // Non-image (PDF, etc.) — printing an embedded PDF reliably isn't
  // possible without a heavier dependency, so it's referenced by name
  // instead of embedded. The link still works when viewing this sheet
  // on screen before printing.
  return (
    <div className="break-inside-avoid flex items-center gap-2 rounded-lg border border-slate-200 p-3">
      <FileText size={18} className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-700">{file.name}</p>
        <p className="text-[10px] text-slate-400">Document attached — open on screen to view/print separately</p>
      </div>
      <a href={file.url} target="_blank" rel="noreferrer" className="print:hidden shrink-0 text-slate-400 hover:text-brand-600">
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

/**
 * Printable purchase order sheet -- shared by PurchaseTable (home
 * dashboard) and CompletedOrdersPage (Order History), since both
 * already carry the same purchase_summary shape. Available regardless
 * of approval_status on purpose (per request: printing should work
 * both before and after a purchase is approved) -- it's a read-only
 * export of what's already on screen, not an action gated by role.
 *
 * Print isolation uses the standard "hide everything except this
 * element" @media print trick (see #purchase-print-sheet in
 * index.css) rather than a new tab/window or a PDF library -- keeps
 * this at zero new dependencies. Everything with a print:hidden class
 * (the backdrop, this modal's own header bar, the external-link
 * icons) disappears from the printed output; only the sheet itself
 * prints.
 */
export default function PurchasePrintView({ purchase: p, onClose }) {
  const orderStyle = STATUS_STYLES[p.order_status] || { label: p.order_status, text: 'text-slate-600', bg: 'bg-slate-100' };
  const approvalStyle = APPROVAL_STYLES[p.approval_status] || APPROVAL_STYLES.pending;
  const subtotal = Number(p.quantity || 0) * Number(p.unit_cost || 0);
  const taxAmount = Number(p.total_cost_with_tax ?? p.total_cost ?? subtotal) - Number(p.total_cost ?? subtotal);
  const displayTotal = p.total_cost_with_tax ?? p.total_cost;
  const photos = p.insurance_photos || [];
  const invoices = p.invoices || [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 print:static print:bg-white print:p-0 animate-[fadeIn_0.15s_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl print:max-h-none print:w-full print:max-w-none print:rounded-none print:shadow-none animate-[scaleIn_0.15s_ease-out]">
        <div className="print:hidden flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Print Purchase Order</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 active:scale-95 transition-all">
              <Printer size={15} /> Print
            </button>
            <button onClick={onClose} title="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>

        <div id="purchase-print-sheet" className="flex-1 overflow-y-auto px-8 py-6 print:overflow-visible">
          <div className="flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Purchase Order</p>
              <h1 className="text-xl font-bold text-slate-900">{p.item_name}</h1>
              {p.po_number && <p className="mt-0.5 font-mono text-sm text-slate-500">PO {p.po_number}</p>}
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${orderStyle.bg} ${orderStyle.text}`}>{orderStyle.label}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${approvalStyle.bg} ${approvalStyle.text}`}>{approvalStyle.label}</span>
            </div>
          </div>

          {p.description && (
            <p className="mt-3 text-sm text-slate-600">{p.description}</p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-6">
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor</p>
              <Field label="Name" value={p.vendor_name} />
              <Field label="GST Number" value={p.vendor_gst_number} />
              <Field label="Phone" value={p.vendor_phone} />
              <Field label="Website" value={p.vendor_website} />
              <Field label="Address" value={p.vendor_address} />
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery</p>
              <Field label="Location" value={p.delivery_location} />
              <Field label="Location GST" value={p.delivery_location_gst_number} />
              <Field label="Address" value={p.delivery_location_address} />
              <Field label="Order Date" value={dateFmt(p.order_date)} />
              <Field label="Expected Delivery" value={dateFmt(p.expected_delivery_date)} />
              <Field label="Actual Delivery" value={dateFmt(p.actual_delivery_date)} />
              <Field label="Courier" value={p.courier_name} />
              <Field label="Tracking Number" value={p.tracking_number} />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost Breakdown</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-1.5 text-slate-500">Quantity</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{p.quantity}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-500">Unit Cost</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{currency(p.unit_cost)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-500">Subtotal</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{currency(subtotal)}</td>
                </tr>
                {Number(p.tax_percent) > 0 && (
                  <tr>
                    <td className="py-1.5 text-slate-500">Tax ({Number(p.tax_percent)}%)</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{currency(taxAmount)}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1.5 font-semibold text-slate-700">Total</td>
                  <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-slate-900">{currency(displayTotal)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-500">Amount Paid</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{currency(p.amount_paid)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-500">Amount Remaining</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{currency(p.amount_remaining)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-6">
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval Trail</p>
              <Field label="Requested By" value={p.requested_by_name} />
              <Field label="Requested Phone" value={p.requested_by_phone} />
              <Field label="Account" value={p.created_by_name} />
              <Field label={p.approval_status === 'rejected' ? 'Rejected By' : 'Approved By'} value={p.approved_by_name} />
              <Field label={p.approval_status === 'rejected' ? 'Rejected At' : 'Approved At'} value={p.approved_at ? dateTimeFmt(p.approved_at) : null} />
              {p.rejection_reason && <Field label="Rejection Reason" value={p.rejection_reason} />}
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Insurance</p>
              <Field label="Status" value={p.insurance_done ? 'Insured' : 'Not insured'} />
            </div>
          </div>

          {(photos.length > 0 || invoices.length > 0) && (
            <div className="mt-5 space-y-4">
              {photos.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <Camera size={12} /> Insurance Photos ({photos.length})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {photos.map((f) => <DocumentThumb key={f.id} file={f} />)}
                  </div>
                </div>
              )}
              {invoices.length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <FileText size={12} /> Invoices ({invoices.length})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {invoices.map((f) => <DocumentThumb key={f.id} file={f} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="mt-6 border-t border-slate-100 pt-3 text-center text-[10px] text-slate-400">
            Printed {new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </div>
  );
}
