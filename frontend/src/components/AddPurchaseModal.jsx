import { useState, useMemo } from 'react';
import { X, ChevronDown, ChevronRight, Camera, FileText, ShieldCheck } from 'lucide-react';
import FileDropZone from './FileDropZone.jsx';

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

/**
 * "New Purchase" form.
 *  - Vendor AND delivery location are both free text with autocomplete
 *    suggestions (via <datalist>) — the backend looks up a match by
 *    name or creates a new record, so nothing has to be pre-registered.
 *  - "Amount already paid" is optional; total cost and the remaining
 *    balance are calculated live as you type.
 *  - Insurance photos/invoices are OPTIONAL at creation time and,
 *    deliberately, uploaded as a SEPARATE follow-up call (onUploadFiles)
 *    AFTER the purchase itself is created (onSubmit) — never bundled
 *    into one request. This means a failed/rejected file (wrong type,
 *    over 10MB) can never block the purchase from being saved; the
 *    purchase creation success and the file upload outcome are
 *    reported to the user independently.
 *  - Invoices and insurance are separate entities: the invoice
 *    uploader is ALWAYS visible and usable regardless of whether
 *    "This asset is insured" is checked. Only the insurance PHOTOS
 *    picker is gated behind that toggle.
 */
export default function AddPurchaseModal({ vendors, locations, onClose, onSubmit, onUploadFiles }) {
  const [form, setForm] = useState({
    item_name: '',
    po_number: '',
    description: '',
    vendor_name: '',
    vendor_gst_number: '',
    vendor_address: '',
    vendor_phone: '',
    quantity: 1,
    unit_cost: '',
    amount_paid: '',
    order_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: '',
    location_name: '',
    location_address: '',
    location_gst_number: '',
    is_delivered: false,
  });
  const [showVendorDetails, setShowVendorDetails] = useState(false);
  const [showLocationDetails, setShowLocationDetails] = useState(false);
  const [insured, setInsured] = useState(false);
  const [photoFiles, setPhotoFiles] = useState([]);
  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const totalCost = useMemo(
    () => (Number(form.quantity) || 0) * (Number(form.unit_cost) || 0),
    [form.quantity, form.unit_cost]
  );
  const remaining = Math.max(0, totalCost - (Number(form.amount_paid) || 0));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    let created;
    try {
      created = await onSubmit(form); // throws + stays open on failure — nothing uploaded yet
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    // Purchase is saved at this point no matter what happens below —
    // file upload failures are reported by the parent (toast) rather
    // than reopening or blocking this modal. Invoices upload
    // independently of the insurance toggle; only insurance photos are
    // tied to it (there's nothing to upload there if not insured).
    if (created?.id && (photoFiles.length || invoiceFiles.length)) {
      try {
        await onUploadFiles(created.id, insured ? photoFiles : [], invoiceFiles);
      } catch {
        // onUploadFiles already surfaces its own error toast — no
        // further action needed here.
      }
    }

    setSubmitting(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">New Asset Purchase</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form id="new-purchase-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Item name</label>
              <input required className={FIELD_CLASS} value={form.item_name}
                onChange={(e) => update('item_name', e.target.value)} placeholder="e.g. Dell Latitude 5440" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">PO number</label>
              <input className={FIELD_CLASS} value={form.po_number}
                onChange={(e) => update('po_number', e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
            <input className={FIELD_CLASS} value={form.description}
              onChange={(e) => update('description', e.target.value)} placeholder="Optional" />
          </div>

          {/* --- Vendor --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Vendor</label>
            <input
              required
              list="vendor-suggestions"
              className={FIELD_CLASS}
              value={form.vendor_name}
              onChange={(e) => update('vendor_name', e.target.value)}
              placeholder="Type a vendor name — new or existing"
            />
            <datalist id="vendor-suggestions">
              {vendors?.map((v) => <option key={v.id} value={v.name} />)}
            </datalist>

            <button type="button" onClick={() => setShowVendorDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showVendorDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add GST, address &amp; phone
            </button>

            {showVendorDetails && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.vendor_gst_number}
                  onChange={(e) => update('vendor_gst_number', e.target.value)} placeholder="GST number" />
                <input className={FIELD_CLASS} value={form.vendor_address}
                  onChange={(e) => update('vendor_address', e.target.value)} placeholder="Address" />
                <input type="tel" className={FIELD_CLASS} value={form.vendor_phone}
                  onChange={(e) => update('vendor_phone', e.target.value)} placeholder="Phone number" />
              </div>
            )}
          </div>

          {/* --- Delivery location --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Delivery location</label>
            <input
              list="location-suggestions"
              className={FIELD_CLASS}
              value={form.location_name}
              onChange={(e) => update('location_name', e.target.value)}
              placeholder="e.g. Mumbai HQ — new or existing"
            />
            <datalist id="location-suggestions">
              {locations?.map((l) => <option key={l.id} value={l.name} />)}
            </datalist>

            <button type="button" onClick={() => setShowLocationDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showLocationDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add address &amp; GST number
            </button>

            {showLocationDetails && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.location_address}
                  onChange={(e) => update('location_address', e.target.value)} placeholder="Address" />
                <input className={FIELD_CLASS} value={form.location_gst_number}
                  onChange={(e) => update('location_gst_number', e.target.value)} placeholder="GST number" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Quantity</label>
              <input required type="number" min="1" className={FIELD_CLASS} value={form.quantity}
                onChange={(e) => update('quantity', Number(e.target.value))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Unit cost (₹)</label>
              <input required type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.unit_cost}
                onChange={(e) => update('unit_cost', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Amount already paid (₹)</label>
            <input type="number" min="0" step="0.01" max={totalCost || undefined} className={FIELD_CLASS}
              value={form.amount_paid} onChange={(e) => update('amount_paid', e.target.value)} placeholder="0" />
          </div>

          {/* Live calculation — updates as quantity / unit cost / amount paid change */}
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Total cost</span>
              <span className="font-mono tabular-nums text-slate-800">{currency(totalCost)}</span>
            </div>
            <div className="mt-1 flex justify-between text-slate-500">
              <span>Remaining balance</span>
              <span className={`font-mono tabular-nums ${remaining > 0 ? 'text-red-700' : 'text-green-700'}`}>
                {currency(remaining)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Purchase date</label>
              <input type="date" className={FIELD_CLASS} value={form.order_date}
                onChange={(e) => update('order_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Expected delivery date</label>
              <input type="date" className={FIELD_CLASS} value={form.expected_delivery_date}
                onChange={(e) => update('expected_delivery_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Delivery Status</label>
            <div className="mt-1 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="radio" name="delivery_status" checked={!form.is_delivered} onChange={() => update('is_delivered', false)} className="text-brand-600 focus:ring-brand-500" />
                Delivery Pending
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="radio" name="delivery_status" checked={form.is_delivered} onChange={() => update('is_delivered', true)} className="text-brand-600 focus:ring-brand-500" />
                Already Delivered
              </label>
            </div>
          </div>

          {/* --- Insurance (photos only) --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <ShieldCheck size={14} className="text-slate-400" /> This asset is insured
            </label>

            {insured && (
              <div className="mt-3">
                <FileDropZone
                  icon={Camera} label="Insurance photos" accept="image/jpeg,image/png,application/pdf"
                  hint="JPEG, PNG, or PDF, up to 10MB each"
                  files={photoFiles} onChange={setPhotoFiles}
                />
              </div>
            )}
          </div>

          {/* --- Invoices: a separate entity from insurance, so this is
              ALWAYS visible and usable regardless of the toggle above. --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-slate-700">
              <FileText size={14} className="text-slate-400" /> Invoice files
            </p>
            <FileDropZone
              icon={FileText} label="Invoice files" accept="image/jpeg,image/png,application/pdf"
              hint="JPEG, PNG, or PDF, up to 10MB each — uploaded after the purchase is created"
              files={invoiceFiles} onChange={setInvoiceFiles}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button type="submit" form="new-purchase-form" disabled={submitting}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-60">
            {submitting ? 'Saving…' : 'Create Purchase'}
          </button>
        </div>
      </div>
    </div>
  );
}

