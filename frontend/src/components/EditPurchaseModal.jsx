import { useState, useMemo } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';

const currency = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white py-2 px-3 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

/**
 * Admin-only "Edit" modal for a purchase's own fields — item name,
 * PO number, description, vendor, quantity, unit cost, dates, courier/
 * tracking. This is the general editor (PATCH /api/purchases/:id);
 * Advance Money Paid keeps its own separate "Modify" control
 * (AdvancePaymentEditor) since that path also writes to
 * financial_audit_log specifically. Every changed field here gets
 * logged to purchase_change_log automatically by the backend — this
 * form doesn't need to know or do anything special about that.
 *
 * Used from PurchaseTable (Home Dashboard) and CompletedOrdersPage
 * (Successful Order History) — same modal either way.
 */
export default function EditPurchaseModal({ purchase, vendors, locations, onClose, onSubmit }) {
  const [form, setForm] = useState({
    item_name: purchase.item_name || '',
    po_number: purchase.po_number || '',
    description: purchase.description || '',
    vendor_name: purchase.vendor_name || '',
    vendor_gst_number: '',
    vendor_address: '',
    vendor_phone: '',
    quantity: purchase.quantity || 1,
    unit_cost: purchase.unit_cost ?? '',
    tax_percent: purchase.tax_percent ?? '',
    order_date: purchase.order_date ? purchase.order_date.slice(0, 10) : '',
    expected_delivery_date: purchase.expected_delivery_date ? purchase.expected_delivery_date.slice(0, 10) : '',
    location_name: purchase.delivery_location || '',
    location_address: '',
    location_gst_number: '',
    courier_name: purchase.courier_name || '',
    tracking_number: purchase.tracking_number || '',
  });
  const [showVendorDetails, setShowVendorDetails] = useState(false);
  const [showLocationDetails, setShowLocationDetails] = useState(false);
  const [showTracking, setShowTracking] = useState(!!(purchase.courier_name || purchase.tracking_number));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [matchedVendor, setMatchedVendor] = useState(null);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const livePreview = useMemo(() => {
    const qty = Number(form.quantity) || 0;
    const unitCost = Number(form.unit_cost) || 0;
    const taxPct = Number(form.tax_percent) || 0;
    const subtotal = qty * unitCost;
    return { subtotal, total: subtotal * (1 + taxPct / 100) };
  }, [form.quantity, form.unit_cost, form.tax_percent]);

  // Uniformity fix: AddPurchaseModal auto-fills vendor details the
  // moment a typed name matches an existing vendor; this editor never
  // did the same lookup at all, so retyping an existing vendor's name
  // here surfaced no feedback and no convenience. Kept consistent with
  // THIS form's own documented behavior though (the note below the
  // detail fields: "only fills in gaps, won't overwrite") — this only
  // fills fields that are still blank, never clobbers something the
  // admin already typed or that came pre-filled from the purchase.
  function handleVendorNameBlur() {
    const typed = form.vendor_name.trim();
    if (!typed) { setMatchedVendor(null); return; }
    const match = vendors?.find((v) => v.name.trim().toLowerCase() === typed.toLowerCase());
    setMatchedVendor(match || null);
    if (match) {
      setForm((f) => ({
        ...f,
        vendor_gst_number: f.vendor_gst_number || match.gst_number || '',
        vendor_address: f.vendor_address || match.address || '',
        vendor_phone: f.vendor_phone || match.contact_phone || '',
      }));
      if (match.gst_number || match.address || match.contact_phone) setShowVendorDetails(true);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.item_name.trim()) {
      setError('Item name cannot be empty.');
      return;
    }
    if (!form.vendor_name.trim()) {
      setError('Vendor name cannot be empty.');
      return;
    }
    // Client-side mirror of the backend's guard — catches the mistake
    // before a round trip instead of only after.
    if (Number(form.quantity) < (purchase.delivered_quantity || 0)) {
      setError(`Quantity can't be less than the ${purchase.delivered_quantity} unit(s) already delivered.`);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-xl animate-[scaleIn_0.15s_ease-out]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Edit Purchase</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form id="edit-purchase-form" onSubmit={handleSubmit} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Item name</label>
              <input required className={FIELD_CLASS} value={form.item_name}
                onChange={(e) => update('item_name', e.target.value)} />
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
              list="edit-vendor-suggestions"
              className={FIELD_CLASS}
              value={form.vendor_name}
              onChange={(e) => { update('vendor_name', e.target.value); setMatchedVendor(null); }}
              onBlur={handleVendorNameBlur}
              placeholder="Type a vendor name — new or existing"
            />
            <datalist id="edit-vendor-suggestions">
              {vendors?.map((v) => <option key={v.id} value={v.name} />)}
            </datalist>

            {matchedVendor && (
              <p className="mt-1.5 text-xs text-green-700">
                Matched existing vendor — any blank GST/address/phone fields below were filled in from it.
              </p>
            )}

            <button type="button" onClick={() => setShowVendorDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showVendorDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add/update GST, address &amp; phone
            </button>

            {showVendorDetails && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.vendor_gst_number}
                  onChange={(e) => update('vendor_gst_number', e.target.value)} placeholder="GST number" />
                <input className={FIELD_CLASS} value={form.vendor_address}
                  onChange={(e) => update('vendor_address', e.target.value)} placeholder="Address" />
                <input type="tel" className={FIELD_CLASS} value={form.vendor_phone}
                  onChange={(e) => update('vendor_phone', e.target.value)} placeholder="Phone number" />
                <p className="text-[11px] text-slate-400">Only fills in gaps — won't overwrite details the vendor already has on file.</p>
              </div>
            )}
          </div>

          {/* --- Delivery location --- */}
          <div className="rounded-lg border border-slate-200 p-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Delivery location</label>
            <input
              list="edit-location-suggestions"
              className={FIELD_CLASS}
              value={form.location_name}
              onChange={(e) => update('location_name', e.target.value)}
              placeholder="e.g. Mumbai HQ — new or existing"
            />
            <datalist id="edit-location-suggestions">
              {locations?.map((l) => <option key={l.id} value={l.name} />)}
            </datalist>

            <button type="button" onClick={() => setShowLocationDetails((s) => !s)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showLocationDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Add/update address &amp; GST number
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
              <input required type="number" min={purchase.delivered_quantity || 1} className={FIELD_CLASS} value={form.quantity}
                onChange={(e) => update('quantity', Number(e.target.value))} />
              {purchase.delivered_quantity > 0 && (
                <p className="mt-0.5 text-[11px] text-slate-400">{purchase.delivered_quantity} already delivered — can't go below that.</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Unit cost (₹)</label>
              <input required type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.unit_cost}
                onChange={(e) => update('unit_cost', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Tax (%)</label>
              <input type="number" min="0" step="0.01" className={FIELD_CLASS} value={form.tax_percent}
                onChange={(e) => update('tax_percent', e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex flex-col justify-end pb-2 text-right">
              <p className="text-[11px] text-slate-400">
                Total{Number(form.tax_percent) > 0 ? ' (incl. tax)' : ''}: <span className="font-mono text-slate-600">{currency(livePreview.total)}</span>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Purchase date</label>
              <input required type="date" className={FIELD_CLASS} value={form.order_date}
                onChange={(e) => update('order_date', e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Expected delivery date</label>
              <input type="date" className={FIELD_CLASS} value={form.expected_delivery_date}
                onChange={(e) => update('expected_delivery_date', e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <button type="button" onClick={() => setShowTracking((s) => !s)}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              {showTracking ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Courier &amp; tracking
            </button>
            {showTracking && (
              <div className="mt-2 space-y-2">
                <input className={FIELD_CLASS} value={form.courier_name}
                  onChange={(e) => update('courier_name', e.target.value)} placeholder="Courier name" />
                <input className={FIELD_CLASS} value={form.tracking_number}
                  onChange={(e) => update('tracking_number', e.target.value)} placeholder="Tracking number" />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button type="submit" form="edit-purchase-form" disabled={submitting}
            className="rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-700 transition-all disabled:opacity-60 active:scale-95">
            {submitting ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
